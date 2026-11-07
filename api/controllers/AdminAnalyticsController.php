<?php
/**
 * Admin analytics, call records and revenue.
 *
 * Reports only ever describe recorded data. Connected calls and revenue can be
 * entered here (or imported from a verified network report) — they are never
 * estimated.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Database;
use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Helpers\Validator;
use Shn\Models\AnalyticsModel;

final class AdminAnalyticsController extends Controller
{
    public function __construct(
        Request $request,
        private readonly AnalyticsModel $analytics = new AnalyticsModel(),
    ) {
        parent::__construct($request);
    }

    public function overview(Request $request): void
    {
        unset($request);
        Response::ok($this->analytics->overview($this->from(), $this->to()));
    }

    public function timeseries(Request $request): void
    {
        unset($request);
        $granularity = $this->filter('granularity', 10) ?? 'day';
        Response::ok($this->analytics->timeseries($this->from(), $this->to(), $granularity));
    }

    public function sources(Request $request): void
    {
        unset($request);
        Response::ok($this->analytics->trafficSources($this->from(), $this->to()));
    }

    public function referrers(Request $request): void
    {
        unset($request);
        Response::ok($this->analytics->referrers($this->from(), $this->to()));
    }

    public function landingPages(Request $request): void
    {
        unset($request);
        Response::ok($this->analytics->landingPages($this->from(), $this->to()));
    }

    public function campaigns(Request $request): void
    {
        unset($request);
        Response::ok($this->analytics->campaigns($this->from(), $this->to()));
    }

    public function services(Request $request): void
    {
        unset($request);
        Response::ok($this->analytics->servicePerformance($this->from(), $this->to()));
    }

    public function numbers(Request $request): void
    {
        unset($request);
        Response::ok($this->analytics->numberPerformance($this->from(), $this->to()));
    }

    public function devices(Request $request): void
    {
        unset($request);
        Response::ok($this->analytics->deviceBreakdown($this->from(), $this->to()));
    }

    public function daily(Request $request): void
    {
        unset($request);
        Response::ok($this->analytics->dailyRows($this->from(), $this->to()));
    }

    /** Rebuilds the daily rollup for the requested range. */
    public function rebuild(Request $request): void
    {
        $from = $this->from();
        $to = $this->to();

        $this->analytics->rebuildDaily($from, $to);
        Logger::audit($request->admin, 'analytics.rebuilt', 'analytics_daily', null, "Rebuilt {$from} → {$to}", $request->ip());

        Response::ok([
            'range' => ['from' => $from, 'to' => $to],
            'rows' => $this->analytics->dailyRows($from, $to),
        ]);
    }

    /* ------------------------- call records -------------------------- */

    /**
     * Records a verified call from a tracking network report.
     * Only call-tracking integrations (or an admin entering a real report) may
     * create these rows — the public site never does.
     */
    public function storeCall(Request $request): void
    {
        $data = Validator::validate($this->body(), [
            'external_call_id' => 'required|string|min:2|max:120',
            'phone_number_id' => 'nullable|int',
            'service_id' => 'nullable|int',
            'network' => 'nullable|string|max:120',
            'campaign' => 'nullable|string|max:160',
            'caller_state' => 'nullable|string|max:2',
            'started_at' => 'required|date',
            'duration_seconds' => 'nullable|int|min:0',
            'connected' => 'required|bool',
            'recording_url' => 'nullable|url|max:500',
            'revenue' => 'nullable|string|max:20',
            'verified' => 'nullable|bool',
        ]);

        $statement = Database::pdo()->prepare(
            'INSERT INTO call_records
                (external_call_id, phone_number_id, service_id, network, campaign, caller_state,
                 started_at, duration_seconds, connected, recording_url, revenue, verified)
             VALUES
                (:external_call_id, :phone_number_id, :service_id, :network, :campaign, :caller_state,
                 :started_at, :duration_seconds, :connected, :recording_url, :revenue, :verified)
             ON DUPLICATE KEY UPDATE
                duration_seconds = VALUES(duration_seconds),
                connected = VALUES(connected),
                revenue = VALUES(revenue),
                verified = VALUES(verified)',
        );

        try {
            $statement->execute([
                ':external_call_id' => $data['external_call_id'],
                ':phone_number_id' => $data['phone_number_id'] ?? null,
                ':service_id' => $data['service_id'] ?? null,
                ':network' => $data['network'] ?? null,
                ':campaign' => $data['campaign'] ?? null,
                ':caller_state' => $data['caller_state'] ?? null,
                ':started_at' => gmdate('Y-m-d H:i:s', strtotime((string) $data['started_at'])),
                ':duration_seconds' => (int) ($data['duration_seconds'] ?? 0),
                ':connected' => !empty($data['connected']) ? 1 : 0,
                ':recording_url' => $data['recording_url'] ?? null,
                ':revenue' => $data['revenue'] ?? '0.00',
                ':verified' => !empty($data['verified']) ? 1 : 0,
            ]);
        } catch (\PDOException $exception) {
            error_log('[calls] insert failed: ' . $exception->getMessage());
            throw ApiException::server('The call record could not be stored.');
        }

        Logger::audit(
            $request->admin,
            'call.recorded',
            'call_record',
            $data['external_call_id'],
            'Recorded a verified call',
            $request->ip(),
        );

        Response::created(['external_call_id' => $data['external_call_id']]);
    }

    public function calls(Request $request): void
    {
        unset($request);

        $statement = Database::pdo()->prepare(
            'SELECT c.*, p.number, p.label AS number_label, s.name AS service_name
               FROM call_records c
               LEFT JOIN phone_numbers p ON p.id = c.phone_number_id
               LEFT JOIN services s ON s.id = c.service_id
              WHERE c.started_at BETWEEN :from AND :to
              ORDER BY c.started_at DESC LIMIT 500',
        );
        $statement->execute([
            ':from' => $this->from() . ' 00:00:00',
            ':to' => $this->to() . ' 23:59:59',
        ]);

        Response::ok($statement->fetchAll(\PDO::FETCH_ASSOC) ?: []);
    }

    /* --------------------------- revenue ----------------------------- */

    public function storeRevenue(Request $request): void
    {
        $data = Validator::validate($this->body(), [
            'source' => 'required|string|max:120',
            'call_record_id' => 'nullable|int',
            'amount' => 'required|string|max:20',
            'currency' => 'nullable|string|max:3',
            'status' => 'nullable|in:pending,approved,paid,void',
            'period_start' => 'nullable|date',
            'period_end' => 'nullable|date',
            'notes' => 'nullable|string|max:300',
        ]);

        if (!is_numeric($data['amount'])) {
            throw ApiException::unprocessable('Enter the amount as a number.', ['amount' => 'Must be numeric.']);
        }

        $statement = Database::pdo()->prepare(
            'INSERT INTO revenue_records (source, call_record_id, amount, currency, status, period_start, period_end, notes)
             VALUES (:source, :call_record_id, :amount, :currency, :status, :period_start, :period_end, :notes)',
        );

        $statement->execute([
            ':source' => $data['source'],
            ':call_record_id' => $data['call_record_id'] ?? null,
            ':amount' => number_format((float) $data['amount'], 2, '.', ''),
            ':currency' => strtoupper((string) ($data['currency'] ?? 'USD')),
            ':status' => $data['status'] ?? 'pending',
            ':period_start' => isset($data['period_start']) ? gmdate('Y-m-d', strtotime((string) $data['period_start'])) : null,
            ':period_end' => isset($data['period_end']) ? gmdate('Y-m-d', strtotime((string) $data['period_end'])) : null,
            ':notes' => $data['notes'] ?? null,
        ]);

        $id = (int) Database::pdo()->lastInsertId();
        Logger::audit($request->admin, 'revenue.recorded', 'revenue_record', $id, 'Recorded revenue', $request->ip());

        Response::created(['id' => $id]);
    }

    public function revenue(Request $request): void
    {
        unset($request);

        $statement = Database::pdo()->prepare(
            'SELECT r.*, c.external_call_id
               FROM revenue_records r
               LEFT JOIN call_records c ON c.id = r.call_record_id
              WHERE COALESCE(r.period_start, DATE(r.created_at)) BETWEEN :from AND :to
              ORDER BY COALESCE(r.period_start, DATE(r.created_at)) DESC LIMIT 500',
        );
        $statement->execute([':from' => $this->from(), ':to' => $this->to()]);

        Response::ok([
            'items' => $statement->fetchAll(\PDO::FETCH_ASSOC) ?: [],
            'totals' => $this->revenueTotals(),
        ]);
    }

    /** @return array<string,float|int> */
    private function revenueTotals(): array
    {
        $statement = Database::pdo()->prepare(
            'SELECT status, COUNT(*) AS records, COALESCE(SUM(amount), 0) AS total
               FROM revenue_records
              WHERE COALESCE(period_start, DATE(created_at)) BETWEEN :from AND :to
              GROUP BY status',
        );
        $statement->execute([':from' => $this->from(), ':to' => $this->to()]);

        $totals = ['pending' => 0.0, 'approved' => 0.0, 'paid' => 0.0, 'void' => 0.0];
        foreach ($statement->fetchAll(\PDO::FETCH_ASSOC) ?: [] as $row) {
            $totals[(string) $row['status']] = round((float) $row['total'], 2);
        }

        return $totals;
    }

    private function from(): string
    {
        return $this->filter('from', 10) ?? gmdate('Y-m-d', strtotime('-29 days'));
    }

    private function to(): string
    {
        return $this->filter('to', 10) ?? gmdate('Y-m-d');
    }
}
