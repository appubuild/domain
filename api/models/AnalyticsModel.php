<?php
/**
 * First-party analytics.
 *
 * Everything returned here is measured: page views and click events come from
 * the `analytics_events` table, leads from `leads`, connected calls from
 * `call_records` (populated only by a verified call-tracking integration) and
 * revenue from `revenue_records`. When there is no data yet the response says
 * so instead of inventing numbers.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class AnalyticsModel extends BaseModel
{
    protected string $table = 'analytics_events';
    protected bool $softDeletes = false;

    public const EVENT_TYPES = ['page_view', 'service_click', 'call_click', 'lead_submit'];
    public const GRANULARITIES = ['day', 'week', 'month'];

    private const SOURCES = ['Organic search', 'Direct', 'Social', 'Referral', 'Paid search', 'Paid social', 'Email'];

    /**
     * Stores a single event. visitor_id / session_id are first-party random
     * identifiers issued by the frontend — never IP addresses.
     *
     * @param array<string,mixed> $event
     */
    public function recordEvent(array $event): void
    {
        $statement = $this->pdo()->prepare(
            'INSERT INTO analytics_events
                (event_type, visitor_id, session_id, path, referrer, source,
                 utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                 service_id, phone_number_id, device_type)
             VALUES
                (:event_type, :visitor_id, :session_id, :path, :referrer, :source,
                 :utm_source, :utm_medium, :utm_campaign, :utm_term, :utm_content,
                 :service_id, :phone_number_id, :device_type)',
        );

        $statement->execute([
            ':event_type' => $event['event_type'],
            ':visitor_id' => $event['visitor_id'] ?? null,
            ':session_id' => $event['session_id'] ?? null,
            ':path' => isset($event['path']) ? substr((string) $event['path'], 0, 255) : null,
            ':referrer' => isset($event['referrer']) ? substr((string) $event['referrer'], 0, 500) : null,
            ':source' => $this->classifySource($event),
            ':utm_source' => $event['utm_source'] ?? null,
            ':utm_medium' => $event['utm_medium'] ?? null,
            ':utm_campaign' => $event['utm_campaign'] ?? null,
            ':utm_term' => $event['utm_term'] ?? null,
            ':utm_content' => $event['utm_content'] ?? null,
            ':service_id' => $event['service_id'] ?? null,
            ':phone_number_id' => $event['phone_number_id'] ?? null,
            ':device_type' => $event['device_type'] ?? 'unknown',
        ]);
    }

    /**
     * Headline metrics for a date range, with the previous period alongside for
     * comparison. Zeroes mean zero — not a placeholder.
     *
     * @return array<string,mixed>
     */
    public function overview(string $from, string $to): array
    {
        [$from, $to] = $this->range($from, $to);
        [$previousFrom, $previousTo] = $this->previousRange($from, $to);

        $current = $this->metrics($from, $to);
        $previous = $this->metrics($previousFrom, $previousTo);

        return [
            'range' => ['from' => $from, 'to' => $to],
            'previous_range' => ['from' => $previousFrom, 'to' => $previousTo],
            'current' => $current,
            'previous' => $previous,
            'change' => [
                'page_views' => $this->percentChange((int) $previous['page_views'], (int) $current['page_views']),
                'unique_visitors' => $this->percentChange((int) $previous['unique_visitors'], (int) $current['unique_visitors']),
                'call_clicks' => $this->percentChange((int) $previous['call_clicks'], (int) $current['call_clicks']),
                'service_clicks' => $this->percentChange((int) $previous['service_clicks'], (int) $current['service_clicks']),
                'leads' => $this->percentChange((int) $previous['leads'], (int) $current['leads']),
                'connected_calls' => $this->percentChange((int) $previous['connected_calls'], (int) $current['connected_calls']),
                'revenue' => $this->percentChange((float) $previous['revenue'], (float) $current['revenue']),
            ],
            'data_available' => $this->hasData(),
            'is_sample' => false,
            'definitions' => [
                'call_clicks' => 'Times a visitor tapped or clicked a published service number.',
                'connected_calls' => 'Calls confirmed connected by the call-tracking network. Only available when an integration is configured.',
                'revenue' => 'Approved or paid revenue recorded from call-tracking or affiliate reports.',
            ],
        ];
    }

    /**
     * Chart-ready series (one entry per bucket, zero-filled).
     *
     * @return array<string,mixed>
     */
    public function timeseries(string $from, string $to, string $granularity = 'day'): array
    {
        if (!in_array($granularity, self::GRANULARITIES, true)) {
            throw ApiException::unprocessable('Unknown granularity.', ['granularity' => 'Use day, week or month.']);
        }

        [$from, $to] = $this->range($from, $to);
        $bucketSql = $this->bucketExpression($granularity, 'created_at');
        $callBucket = $this->bucketExpression($granularity, 'started_at');

        $events = $this->pdo()->prepare(
            "SELECT {$bucketSql} AS bucket,
                    SUM(event_type = 'page_view') AS page_views,
                    SUM(event_type = 'service_click') AS service_clicks,
                    SUM(event_type = 'call_click') AS call_clicks,
                    COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS unique_visitors
               FROM analytics_events
              WHERE created_at BETWEEN :from AND :to
              GROUP BY bucket
              ORDER BY bucket ASC",
        );
        $events->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        $eventRows = $events->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $leads = $this->pdo()->prepare(
            "SELECT {$bucketSql} AS bucket, COUNT(*) AS leads
               FROM leads
              WHERE deleted_at IS NULL AND created_at BETWEEN :from AND :to
              GROUP BY bucket",
        );
        $leads->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        $leadRows = $leads->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $calls = $this->pdo()->prepare(
            "SELECT {$callBucket} AS bucket,
                    SUM(connected = 1) AS connected_calls,
                    COUNT(*) AS tracked_calls
               FROM call_records
              WHERE started_at BETWEEN :from AND :to
              GROUP BY bucket",
        );
        $calls->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        $callRows = $calls->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $revenue = $this->pdo()->prepare(
            "SELECT DATE_FORMAT(period_start, '%Y-%m-%d') AS bucket, SUM(amount) AS revenue
               FROM revenue_records
              WHERE status IN ('approved', 'paid') AND period_start BETWEEN :from AND :to
              GROUP BY bucket",
        );
        $revenue->execute([':from' => $from, ':to' => $to]);
        $revenueRows = $revenue->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $series = [];
        foreach ($this->buckets($from, $to, $granularity) as $bucket) {
            $series[$bucket] = [
                'bucket' => $bucket,
                'page_views' => 0,
                'unique_visitors' => 0,
                'service_clicks' => 0,
                'call_clicks' => 0,
                'leads' => 0,
                'connected_calls' => 0,
                'tracked_calls' => 0,
                'revenue' => 0.0,
            ];
        }

        foreach ($eventRows as $row) {
            $key = (string) $row['bucket'];
            if (!isset($series[$key])) {
                continue;
            }
            $series[$key]['page_views'] = (int) $row['page_views'];
            $series[$key]['service_clicks'] = (int) $row['service_clicks'];
            $series[$key]['call_clicks'] = (int) $row['call_clicks'];
            $series[$key]['unique_visitors'] = (int) $row['unique_visitors'];
        }
        foreach ($leadRows as $row) {
            $key = (string) $row['bucket'];
            if (isset($series[$key])) {
                $series[$key]['leads'] = (int) $row['leads'];
            }
        }
        foreach ($callRows as $row) {
            $key = (string) $row['bucket'];
            if (isset($series[$key])) {
                $series[$key]['connected_calls'] = (int) $row['connected_calls'];
                $series[$key]['tracked_calls'] = (int) $row['tracked_calls'];
            }
        }
        foreach ($revenueRows as $row) {
            $key = (string) $row['bucket'];
            if (isset($series[$key])) {
                $series[$key]['revenue'] = round((float) $row['revenue'], 2);
            }
        }

        return [
            'range' => ['from' => $from, 'to' => $to],
            'granularity' => $granularity,
            'series' => array_values($series),
            'data_available' => $this->hasData(),
            'is_sample' => false,
        ];
    }

    /** @return array<int,array<string,mixed>> */
    public function trafficSources(string $from, string $to, int $limit = 10): array
    {
        [$from, $to] = $this->range($from, $to);

        $statement = $this->pdo()->prepare(
            "SELECT COALESCE(NULLIF(source, ''), 'Direct') AS source,
                    SUM(event_type = 'page_view') AS page_views,
                    COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS visitors,
                    SUM(event_type = 'call_click') AS calls,
                    SUM(event_type = 'service_click') AS service_clicks
               FROM analytics_events
              WHERE created_at BETWEEN :from AND :to
              GROUP BY source
              ORDER BY page_views DESC
              LIMIT " . max(1, min(50, $limit)),
        );
        $statement->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<int,array<string,mixed>> */
    public function referrers(string $from, string $to, int $limit = 10): array
    {
        [$from, $to] = $this->range($from, $to);

        $statement = $this->pdo()->prepare(
            "SELECT referrer, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
               FROM analytics_events
              WHERE event_type = 'page_view'
                AND referrer IS NOT NULL AND referrer <> ''
                AND created_at BETWEEN :from AND :to
              GROUP BY referrer
              ORDER BY views DESC
              LIMIT " . max(1, min(50, $limit)),
        );
        $statement->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<int,array<string,mixed>> */
    public function landingPages(string $from, string $to, int $limit = 10): array
    {
        [$from, $to] = $this->range($from, $to);

        $statement = $this->pdo()->prepare(
            "SELECT path,
                    SUM(event_type = 'page_view') AS views,
                    COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS visitors,
                    SUM(event_type = 'call_click') AS calls
               FROM analytics_events
              WHERE path IS NOT NULL AND created_at BETWEEN :from AND :to
              GROUP BY path
              ORDER BY views DESC
              LIMIT " . max(1, min(50, $limit)),
        );
        $statement->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<int,array<string,mixed>> */
    public function campaigns(string $from, string $to, int $limit = 20): array
    {
        [$from, $to] = $this->range($from, $to);

        $statement = $this->pdo()->prepare(
            "SELECT utm_source, utm_medium, utm_campaign,
                    COUNT(*) AS events,
                    COUNT(DISTINCT visitor_id) AS visitors
               FROM analytics_events
              WHERE utm_campaign IS NOT NULL AND utm_campaign <> ''
                AND created_at BETWEEN :from AND :to
              GROUP BY utm_source, utm_medium, utm_campaign
              ORDER BY events DESC
              LIMIT " . max(1, min(100, $limit)),
        );
        $statement->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<int,array<string,mixed>> */
    public function servicePerformance(string $from, string $to, int $limit = 20): array
    {
        [$from, $to] = $this->range($from, $to);

        $statement = $this->pdo()->prepare(
            "SELECT s.id, s.name, s.slug,
                    SUM(e.event_type = 'service_click') AS service_clicks,
                    SUM(e.event_type = 'call_click') AS call_clicks,
                    (SELECT COUNT(*) FROM leads l
                      WHERE l.deleted_at IS NULL AND l.service = s.name
                        AND l.created_at BETWEEN :from2 AND :to2) AS leads
               FROM analytics_events e
               INNER JOIN services s ON s.id = e.service_id
              WHERE e.created_at BETWEEN :from AND :to
              GROUP BY s.id, s.name, s.slug
              ORDER BY call_clicks DESC, service_clicks DESC
              LIMIT " . max(1, min(100, $limit)),
        );
        $statement->execute([
            ':from' => $from . ' 00:00:00',
            ':to' => $to . ' 23:59:59',
            ':from2' => $from . ' 00:00:00',
            ':to2' => $to . ' 23:59:59',
        ]);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<int,array<string,mixed>> */
    public function numberPerformance(string $from, string $to, int $limit = 40): array
    {
        [$from, $to] = $this->range($from, $to);

        $statement = $this->pdo()->prepare(
            "SELECT p.id, p.external_id, p.number, p.label, p.status, g.name AS group_name,
                    SUM(e.event_type = 'call_click') AS call_clicks,
                    (SELECT COUNT(*) FROM call_records c
                      WHERE c.phone_number_id = p.id AND c.connected = 1
                        AND c.started_at BETWEEN :from2 AND :to2) AS connected_calls
               FROM analytics_events e
               INNER JOIN phone_numbers p ON p.id = e.phone_number_id
               LEFT JOIN phone_groups g ON g.id = p.group_id
              WHERE e.event_type = 'call_click' AND e.created_at BETWEEN :from AND :to
              GROUP BY p.id, p.external_id, p.number, p.label, p.status, g.name
              ORDER BY call_clicks DESC
              LIMIT " . max(1, min(100, $limit)),
        );
        $statement->execute([
            ':from' => $from . ' 00:00:00',
            ':to' => $to . ' 23:59:59',
            ':from2' => $from . ' 00:00:00',
            ':to2' => $to . ' 23:59:59',
        ]);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<int,array<string,mixed>> */
    public function deviceBreakdown(string $from, string $to): array
    {
        [$from, $to] = $this->range($from, $to);

        $statement = $this->pdo()->prepare(
            'SELECT device_type, COUNT(*) AS events, COUNT(DISTINCT visitor_id) AS visitors
               FROM analytics_events
              WHERE created_at BETWEEN :from AND :to
              GROUP BY device_type
              ORDER BY events DESC',
        );
        $statement->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * Rebuilds the `analytics_daily` rollup for one day (or a range).
     * Safe to run repeatedly — the table is a cache, not a source of truth.
     */
    public function rebuildDaily(string $from, string $to): void
    {
        [$from, $to] = $this->range($from, $to);
        $pdo = $this->pdo();

        $statement = $pdo->prepare(
            "INSERT INTO analytics_daily
                (report_date, page_views, unique_visitors, service_clicks, call_clicks, leads, connected_calls, revenue)
             SELECT d.report_date,
                    (SELECT COUNT(*) FROM analytics_events e WHERE DATE(e.created_at) = d.report_date AND e.event_type = 'page_view'),
                    (SELECT COUNT(DISTINCT e.visitor_id) FROM analytics_events e WHERE DATE(e.created_at) = d.report_date AND e.event_type = 'page_view'),
                    (SELECT COUNT(*) FROM analytics_events e WHERE DATE(e.created_at) = d.report_date AND e.event_type = 'service_click'),
                    (SELECT COUNT(*) FROM analytics_events e WHERE DATE(e.created_at) = d.report_date AND e.event_type = 'call_click'),
                    (SELECT COUNT(*) FROM leads l WHERE DATE(l.created_at) = d.report_date AND l.deleted_at IS NULL),
                    (SELECT COUNT(*) FROM call_records c WHERE DATE(c.started_at) = d.report_date AND c.connected = 1),
                    (SELECT COALESCE(SUM(r.amount), 0) FROM revenue_records r
                      WHERE r.status IN ('approved','paid') AND r.period_start = d.report_date)
               FROM (SELECT DISTINCT DATE(created_at) AS report_date FROM analytics_events
                      WHERE created_at BETWEEN :from AND :to) d
             ON DUPLICATE KEY UPDATE
                    page_views = VALUES(page_views),
                    unique_visitors = VALUES(unique_visitors),
                    service_clicks = VALUES(service_clicks),
                    call_clicks = VALUES(call_clicks),
                    leads = VALUES(leads),
                    connected_calls = VALUES(connected_calls),
                    revenue = VALUES(revenue)",
        );

        // DATE(created_at) is the day boundary; widen the bounds by one day so
        // events on `to` (23:59) are not lost.
        $statement->execute([
            ':from' => $from . ' 00:00:00',
            ':to' => $to . ' 23:59:59',
        ]);
    }

    /** @return array<int,array<string,mixed>> */
    public function dailyRows(string $from, string $to): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT report_date, page_views, unique_visitors, service_clicks, call_clicks, leads, connected_calls, revenue
               FROM analytics_daily WHERE report_date BETWEEN :from AND :to ORDER BY report_date ASC',
        );
        $statement->execute([':from' => $from, ':to' => $to]);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public function hasData(): bool
    {
        $checks = [
            'SELECT COUNT(*) FROM analytics_events',
            'SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL',
            'SELECT COUNT(*) FROM call_records',
            'SELECT COUNT(*) FROM revenue_records',
        ];
        foreach ($checks as $sql) {
            if ((int) $this->pdo()->query($sql)->fetchColumn() > 0) {
                return true;
            }
        }
        return false;
    }

    /* ------------------------------------------------------------------ */
    /*  Internals                                                          */
    /* ------------------------------------------------------------------ */

    /** @return array<string,mixed> */
    private function metrics(string $from, string $to): array
    {
        $events = $this->pdo()->prepare(
            "SELECT SUM(event_type = 'page_view') AS page_views,
                    COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS unique_visitors,
                    SUM(event_type = 'service_click') AS service_clicks,
                    SUM(event_type = 'call_click') AS call_clicks
               FROM analytics_events
              WHERE created_at BETWEEN :from AND :to",
        );
        $events->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        $row = $events->fetch(PDO::FETCH_ASSOC) ?: [];

        $leads = $this->pdo()->prepare(
            'SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND created_at BETWEEN :from AND :to',
        );
        $leads->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        $leadCount = (int) $leads->fetchColumn();

        $calls = $this->pdo()->prepare(
            'SELECT SUM(connected = 1) AS connected, COUNT(*) AS tracked
               FROM call_records WHERE started_at BETWEEN :from AND :to',
        );
        $calls->execute([':from' => $from . ' 00:00:00', ':to' => $to . ' 23:59:59']);
        $callRow = $calls->fetch(PDO::FETCH_ASSOC) ?: [];

        $revenue = $this->pdo()->prepare(
            "SELECT COALESCE(SUM(amount), 0) FROM revenue_records
              WHERE status IN ('approved','paid')
                AND COALESCE(period_start, DATE(created_at)) BETWEEN :from AND :to",
        );
        $revenue->execute([':from' => $from, ':to' => $to]);

        $pageViews = (int) ($row['page_views'] ?? 0);
        $callClicks = (int) ($row['call_clicks'] ?? 0);

        return [
            'page_views' => $pageViews,
            'unique_visitors' => (int) ($row['unique_visitors'] ?? 0),
            'service_clicks' => (int) ($row['service_clicks'] ?? 0),
            'call_clicks' => $callClicks,
            'leads' => $leadCount,
            'connected_calls' => (int) ($callRow['connected'] ?? 0),
            'tracked_calls' => (int) ($callRow['tracked'] ?? 0),
            'revenue' => round((float) $revenue->fetchColumn(), 2),
            'click_to_call_rate' => $pageViews > 0 ? round(($callClicks / $pageViews) * 100, 2) : 0.0,
        ];
    }

    /** @return array{0:string,1:string} */
    private function range(string $from, string $to): array
    {
        $from = $this->validDate($from, gmdate('Y-m-d', strtotime('-29 days')));
        $to = $this->validDate($to, gmdate('Y-m-d'));
        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }
        return [$from, $to];
    }

    private function validDate(string $value, string $fallback): string
    {
        if ($value === '' ) {
            return $fallback;
        }
        $date = \DateTimeImmutable::createFromFormat('Y-m-d', $value);
        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw ApiException::unprocessable('Dates must use the YYYY-MM-DD format.', ['date' => 'Invalid date.']);
        }
        return $value;
    }

    /** @return array{0:string,1:string} */
    private function previousRange(string $from, string $to): array
    {
        $start = new \DateTimeImmutable($from);
        $end = new \DateTimeImmutable($to);
        $days = (int) $start->diff($end)->format('%a') + 1;
        $previousEnd = $start->modify('-1 day');
        $previousStart = $previousEnd->modify('-' . ($days - 1) . ' days');

        return [$previousStart->format('Y-m-d'), $previousEnd->format('Y-m-d')];
    }

    private function percentChange(float|int $previous, float|int $current): ?float
    {
        if ($previous === 0 || $previous === 0.0) {
            return $current > 0 ? null : 0.0; // null = "new activity", shown as "—"
        }
        return round((($current - $previous) / $previous) * 100, 1);
    }

    private function bucketExpression(string $granularity, string $column): string
    {
        return match ($granularity) {
            'week' => "DATE_FORMAT(DATE_SUB(DATE({$column}), INTERVAL WEEKDAY({$column}) DAY), '%Y-%m-%d')",
            'month' => "DATE_FORMAT({$column}, '%Y-%m-01')",
            default => "DATE_FORMAT({$column}, '%Y-%m-%d')",
        };
    }

    /** @return array<int,string> */
    private function buckets(string $from, string $to, string $granularity): array
    {
        $start = new \DateTimeImmutable($from);
        $end = new \DateTimeImmutable($to);
        $buckets = [];

        if ($granularity === 'month') {
            $cursor = $start->modify('first day of this month');
            $stop = $end->modify('first day of this month');
            while ($cursor <= $stop) {
                $buckets[] = $cursor->format('Y-m-01');
                $cursor = $cursor->modify('+1 month');
            }
            return $buckets;
        }

        if ($granularity === 'week') {
            $cursor = $start->modify('monday this week');
            while ($cursor <= $end) {
                $buckets[] = $cursor->format('Y-m-d');
                $cursor = $cursor->modify('+1 week');
            }
            return $buckets;
        }

        $cursor = $start;
        while ($cursor <= $end) {
            $buckets[] = $cursor->format('Y-m-d');
            $cursor = $cursor->modify('+1 day');
        }
        return $buckets;
    }

    /** @param array<string,mixed> $event */
    private function classifySource(array $event): string
    {
        $utmMedium = strtolower((string) ($event['utm_medium'] ?? ''));
        $utmSource = strtolower((string) ($event['utm_source'] ?? ''));

        if ($utmMedium !== '') {
            if (str_contains($utmMedium, 'cpc') || str_contains($utmMedium, 'paid')) {
                return str_contains($utmMedium, 'social') ? 'Paid social' : 'Paid search';
            }
            if (str_contains($utmMedium, 'email')) {
                return 'Email';
            }
            if (str_contains($utmMedium, 'social')) {
                return 'Social';
            }
            if (str_contains($utmMedium, 'referral')) {
                return 'Referral';
            }
        }

        $referrer = strtolower((string) ($event['referrer'] ?? ''));
        if ($referrer === '') {
            return 'Direct';
        }
        foreach (['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia'] as $engine) {
            if (str_contains($referrer, $engine)) {
                return 'Organic search';
            }
        }
        foreach (['facebook', 'instagram', 't.co', 'twitter', 'x.com', 'linkedin', 'pinterest', 'tiktok', 'reddit'] as $network) {
            if (str_contains($referrer, $network)) {
                return 'Social';
            }
        }
        if ($utmSource !== '') {
            return 'Referral';
        }

        return 'Referral';
    }
}
