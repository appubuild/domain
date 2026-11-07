<?php
/**
 * Admin dashboard summary: content counts, recent leads, recent activity and a
 * short analytics window. Nothing here is synthesised.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;

final class DashboardModel extends BaseModel
{
    protected bool $softDeletes = false;

    /** @return array<string,mixed> */
    public function summary(): array
    {
        $counts = [
            'services_total' => $this->count('SELECT COUNT(*) FROM services WHERE deleted_at IS NULL'),
            'services_published' => $this->count('SELECT COUNT(*) FROM services WHERE deleted_at IS NULL AND status = "published"'),
            'services_draft' => $this->count('SELECT COUNT(*) FROM services WHERE deleted_at IS NULL AND status = "draft"'),
            'phone_numbers_total' => $this->count('SELECT COUNT(*) FROM phone_numbers WHERE deleted_at IS NULL'),
            'phone_numbers_active' => $this->count('SELECT COUNT(*) FROM phone_numbers WHERE deleted_at IS NULL AND status = "active"'),
            'phone_numbers_pending' => $this->count('SELECT COUNT(*) FROM phone_numbers WHERE deleted_at IS NULL AND status = "pending-verification"'),
            'phone_groups' => $this->count('SELECT COUNT(*) FROM phone_groups'),
            'pages_total' => $this->count('SELECT COUNT(*) FROM pages WHERE deleted_at IS NULL'),
            'pages_published' => $this->count('SELECT COUNT(*) FROM pages WHERE deleted_at IS NULL AND status = "published"'),
            'pages_draft' => $this->count('SELECT COUNT(*) FROM pages WHERE deleted_at IS NULL AND status = "draft"'),
            'posts_total' => $this->count('SELECT COUNT(*) FROM blog_posts WHERE deleted_at IS NULL'),
            'posts_published' => $this->count('SELECT COUNT(*) FROM blog_posts WHERE deleted_at IS NULL AND status = "published"'),
            'faqs' => $this->count('SELECT COUNT(*) FROM faqs'),
            'leads_new' => $this->count('SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND status = "new"'),
            'leads_total' => $this->count('SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL'),
            'media' => $this->count('SELECT COUNT(*) FROM media'),
        ];

        return [
            'counts' => $counts,
            'recent_leads' => $this->recentLeads(),
            'recent_activity' => $this->recentActivity(),
            'analytics' => $this->analyticsSnapshot(),
            'mapping_warnings' => $this->mappingWarnings(),
        ];
    }

    /** @return array<int,array<string,mixed>> */
    private function recentLeads(int $limit = 5): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT id, reference, name, email, service, status, priority, created_at
               FROM leads WHERE deleted_at IS NULL
              ORDER BY created_at DESC LIMIT ' . max(1, min(20, $limit)),
        );
        $statement->execute();
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<int,array<string,mixed>> */
    public function recentActivity(int $limit = 8): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT l.action, l.entity_type, l.entity_id, l.summary, l.created_at, a.name AS admin_name
               FROM activity_log l LEFT JOIN admins a ON a.id = l.admin_id
              ORDER BY l.created_at DESC, l.id DESC LIMIT ' . max(1, min(50, $limit)),
        );
        $statement->execute();
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<string,mixed> */
    private function analyticsSnapshot(): array
    {
        $from = gmdate('Y-m-d', strtotime('-6 days'));
        $to = gmdate('Y-m-d');

        $statement = $this->pdo()->prepare(
            "SELECT
                (SELECT COUNT(*) FROM analytics_events WHERE event_type = 'page_view' AND created_at BETWEEN :from AND :to) AS page_views,
                (SELECT COUNT(DISTINCT visitor_id) FROM analytics_events WHERE event_type = 'page_view' AND created_at BETWEEN :from2 AND :to2) AS unique_visitors,
                (SELECT COUNT(*) FROM analytics_events WHERE event_type = 'call_click' AND created_at BETWEEN :from3 AND :to3) AS call_clicks,
                (SELECT COUNT(*) FROM analytics_events WHERE event_type = 'service_click' AND created_at BETWEEN :from4 AND :to4) AS service_clicks,
                (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND created_at BETWEEN :from5 AND :to5) AS leads,
                (SELECT COUNT(*) FROM call_records WHERE connected = 1 AND started_at BETWEEN :from6 AND :to6) AS connected_calls",
        );
        $bounds = [];
        foreach (['from', 'to'] as $key) {
            $value = $key === 'from' ? $from . ' 00:00:00' : $to . ' 23:59:59';
            for ($i = 1; $i <= 6; $i++) {
                $bounds[':' . $key . ($i === 1 ? '' : (string) $i)] = $value;
            }
        }
        $statement->execute($bounds);
        $row = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

        return [
            'range' => ['from' => $from, 'to' => $to],
            'page_views' => (int) ($row['page_views'] ?? 0),
            'unique_visitors' => (int) ($row['unique_visitors'] ?? 0),
            'call_clicks' => (int) ($row['call_clicks'] ?? 0),
            'service_clicks' => (int) ($row['service_clicks'] ?? 0),
            'leads' => (int) ($row['leads'] ?? 0),
            'connected_calls' => (int) ($row['connected_calls'] ?? 0),
            'is_sample' => false,
        ];
    }

    /**
     * Services that resolve to no phone group would show a contact message to
     * visitors. Surfacing them in the dashboard prevents silent breakage.
     *
     * @return array<int,array<string,mixed>>
     */
    private function mappingWarnings(): array
    {
        $sql = 'SELECT s.id, s.slug, s.name
                  FROM services s
                 WHERE s.deleted_at IS NULL
                   AND s.status = "published"
                   AND NOT EXISTS (
                       SELECT 1 FROM service_phone_groups spg
                         INNER JOIN phone_numbers p ON p.group_id = spg.group_id
                        WHERE spg.service_id = s.id AND p.deleted_at IS NULL AND p.status = "active"
                   )
                 ORDER BY s.name ASC';
        return $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    private function count(string $sql): int
    {
        return (int) $this->pdo()->query($sql)->fetchColumn();
    }
}
