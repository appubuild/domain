<?php
/**
 * Contact-form leads and support requests.
 *
 * Public submission stores the enquiry in the database; nothing is sent to a
 * third party unless LEAD_WEBHOOK_URL is configured by the site owner.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;
use Shn\Helpers\Config;

final class LeadModel extends BaseModel
{
    protected string $table = 'leads';

    public const STATUSES = ['new', 'contacted', 'qualified', 'closed'];
    public const PRIORITIES = ['low', 'normal', 'high'];

    /**
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public function create(array $data, string $ipHash, string $userAgent): array
    {
        $reference = $this->nextReference();

        $statement = $this->pdo()->prepare(
            'INSERT INTO leads (reference, type, name, email, phone, service, subject, message, status,
                                priority, source, utm_source, utm_medium, utm_campaign, consent, ip_hash, user_agent)
             VALUES (:reference, :type, :name, :email, :phone, :service, :subject, :message, "new",
                     :priority, :source, :utm_source, :utm_medium, :utm_campaign, :consent, :ip_hash, :user_agent)',
        );

        $statement->execute([
            ':reference' => $reference,
            ':type' => $data['type'] ?? 'lead',
            ':name' => $data['name'],
            ':email' => $data['email'],
            ':phone' => $data['phone'] ?? null,
            ':service' => $data['service'] ?? null,
            ':subject' => $data['subject'] ?? null,
            ':message' => $data['message'],
            ':priority' => $data['priority'] ?? 'normal',
            ':source' => $data['source'] ?? 'Direct',
            ':utm_source' => $data['utm_source'] ?? null,
            ':utm_medium' => $data['utm_medium'] ?? null,
            ':utm_campaign' => $data['utm_campaign'] ?? null,
            ':consent' => !empty($data['consent']) ? 1 : 0,
            ':ip_hash' => $ipHash,
            ':user_agent' => substr($userAgent, 0, 255),
        ]);

        $id = (int) $this->pdo()->lastInsertId();

        $this->notifyWebhook($reference, $data);

        return [
            'id' => $id,
            'reference' => $reference,
            'status' => 'new',
            'created_at' => gmdate('c'),
        ];
    }

    /**
     * @param array{status?:string,type?:string,q?:string,from?:string,to?:string,include_deleted?:bool} $filters
     * @return array{items:array<int,array<string,mixed>>,meta:array<string,mixed>}
     */
    public function adminList(array $filters, int $page, int $perPage): array
    {
        $conditions = [];
        $params = [];

        if (empty($filters['include_deleted'])) {
            $conditions[] = 'l.deleted_at IS NULL';
        }
        if (!empty($filters['status'])) {
            $conditions[] = 'l.status = :status';
            $params[':status'] = $filters['status'];
        }
        if (!empty($filters['type'])) {
            $conditions[] = 'l.type = :type';
            $params[':type'] = $filters['type'];
        }
        if (!empty($filters['from'])) {
            $conditions[] = 'l.created_at >= :from';
            $params[':from'] = $filters['from'] . ' 00:00:00';
        }
        if (!empty($filters['to'])) {
            $conditions[] = 'l.created_at <= :to';
            $params[':to'] = $filters['to'] . ' 23:59:59';
        }
        if (!empty($filters['q'])) {
            $conditions[] = '(l.name LIKE :q OR l.email LIKE :q OR l.reference LIKE :q OR l.message LIKE :q)';
            $params[':q'] = '%' . $filters['q'] . '%';
        }

        $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

        $count = $this->pdo()->prepare('SELECT COUNT(*) FROM leads l' . $where);
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $sql = 'SELECT l.*, a.name AS assigned_name
                  FROM leads l LEFT JOIN admins a ON a.id = l.assigned_to' . $where
            . ' ORDER BY l.created_at DESC LIMIT ' . $perPage . ' OFFSET ' . $offset;

        $statement = $this->pdo()->prepare($sql);
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return [
            'items' => array_map([$this, 'hydrate'], $rows),
            'meta' => $this->paginationMeta($total, $page, $perPage, [
                'status_counts' => $this->statusCounts(),
            ]),
        ];
    }

    /** @return array<string,mixed> */
    public function adminFind(int $id): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT l.*, a.name AS assigned_name FROM leads l
               LEFT JOIN admins a ON a.id = l.assigned_to
              WHERE l.id = :id AND l.deleted_at IS NULL LIMIT 1',
        );
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('Lead not found.');
        }
        return $this->hydrate($row);
    }

    /** @param array<string,mixed> $data */
    public function update(int $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];

        foreach (['status', 'priority', 'assigned_to', 'subject'] as $column) {
            if (!array_key_exists($column, $data)) {
                continue;
            }
            if ($column === 'status' && !in_array($data[$column], self::STATUSES, true)) {
                throw ApiException::unprocessable('Unknown lead status.', ['status' => 'Use new, contacted, qualified or closed.']);
            }
            if ($column === 'priority' && !in_array($data[$column], self::PRIORITIES, true)) {
                throw ApiException::unprocessable('Unknown priority.', ['priority' => 'Use low, normal or high.']);
            }
            $fields[] = '`' . $column . '` = :' . $column;
            $bindings[':' . $column] = $data[$column] === '' ? null : $data[$column];
        }

        if ($fields === []) {
            return;
        }

        $statement = $this->pdo()->prepare('UPDATE leads SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $statement->execute($bindings);
    }

    /** @return array<string,int> */
    public function statusCounts(): array
    {
        $rows = $this->pdo()->query(
            'SELECT status, COUNT(*) AS total FROM leads WHERE deleted_at IS NULL GROUP BY status',
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $counts = array_fill_keys(self::STATUSES, 0);
        foreach ($rows as $row) {
            $counts[(string) $row['status']] = (int) $row['total'];
        }
        return $counts;
    }

    private function nextReference(): string
    {
        $prefix = 'SHN-' . gmdate('ymd');
        $statement = $this->pdo()->prepare(
            'SELECT COUNT(*) FROM leads WHERE reference LIKE :prefix',
        );
        $statement->execute([':prefix' => $prefix . '%']);
        $sequence = (int) $statement->fetchColumn() + 1;

        // Loop defensively in case of a concurrent insert with the same sequence.
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $reference = $prefix . '-' . str_pad((string) ($sequence + $attempt), 4, '0', STR_PAD_LEFT);
            $check = $this->pdo()->prepare('SELECT COUNT(*) FROM leads WHERE reference = :reference');
            $check->execute([':reference' => $reference]);
            if ((int) $check->fetchColumn() === 0) {
                return $reference;
            }
        }

        return $prefix . '-' . strtoupper(bin2hex(random_bytes(3)));
    }

    /** @param array<string,mixed> $payload */
    private function notifyWebhook(string $reference, array $payload): void
    {
        $url = Config::string('integrations.lead_webhook', '');
        if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
            return;
        }
        if (!function_exists('curl_init')) {
            return;
        }

        $body = json_encode([
            'reference' => $reference,
            'name' => $payload['name'] ?? null,
            'email' => $payload['email'] ?? null,
            'phone' => $payload['phone'] ?? null,
            'service' => $payload['service'] ?? null,
            'message' => $payload['message'] ?? null,
            'source' => $payload['source'] ?? 'Direct',
        ], JSON_UNESCAPED_SLASHES);

        $handle = curl_init($url);
        if ($handle === false) {
            return;
        }
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
        ]);
        $result = curl_exec($handle);
        if ($result === false) {
            error_log('[lead] webhook delivery failed: ' . curl_error($handle));
        }
        curl_close($handle);
    }

    /** @param array<string,mixed> $row */
    private function hydrate(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'reference' => $row['reference'],
            'type' => $row['type'],
            'name' => $row['name'],
            'email' => $row['email'],
            'phone' => $row['phone'],
            'service' => $row['service'],
            'subject' => $row['subject'],
            'message' => $row['message'],
            'status' => $row['status'],
            'priority' => $row['priority'],
            'source' => $row['source'],
            'utm_source' => $row['utm_source'],
            'utm_medium' => $row['utm_medium'],
            'utm_campaign' => $row['utm_campaign'],
            'assigned_to' => $row['assigned_to'] !== null ? (int) $row['assigned_to'] : null,
            'assigned_name' => $row['assigned_name'] ?? null,
            'consent' => (int) $row['consent'] === 1,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }
}
