<?php
/**
 * Tracking numbers.
 *
 * Rules enforced here:
 *  · a number is only ever returned publicly when status = 'active';
 *  · internal notes, network, campaign and verification data are admin-only;
 *  · display format is normalised to 800-000-0000 and must be dialable.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class PhoneNumberModel extends BaseModel
{
    protected string $table = 'phone_numbers';

    public const STATUSES = ['active', 'pending-verification', 'inactive'];

    private const WRITABLE = [
        'external_id', 'group_id', 'number', 'label', 'priority', 'status', 'network',
        'campaign', 'campaign_nationwide', 'campaign_states', 'campaign_zip_codes', 'notes', 'verified_at',
    ];

    /* ------------------------------------------------------------------ */
    /*  Public reads                                                       */
    /* ------------------------------------------------------------------ */

    /**
     * Groups with counts only — public pages must not show a number until the
     * visitor has selected a service.
     *
     * @return array<int,array<string,mixed>>
     */
    public function publicGroupIndex(): array
    {
        $sql = 'SELECT g.id, g.name, g.label, g.blurb, g.icon,
                       (SELECT COUNT(*) FROM phone_numbers p
                         WHERE p.group_id = g.id AND p.deleted_at IS NULL AND p.status = "active") AS active_numbers
                  FROM phone_groups g
                 ORDER BY g.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(static fn (array $row): array => [
            'id' => $row['id'],
            'name' => $row['name'],
            'label' => $row['label'],
            'blurb' => $row['blurb'],
            'icon' => $row['icon'],
            'has_active_numbers' => (int) $row['active_numbers'] > 0,
            'active_number_count' => (int) $row['active_numbers'],
        ], $rows);
    }

    /* ------------------------------------------------------------------ */
    /*  Admin reads                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * @param array{group?:string,status?:string,q?:string,network?:string,include_deleted?:bool} $filters
     * @return array{items:array<int,array<string,mixed>>,meta:array<string,mixed>}
     */
    public function adminList(array $filters, int $page, int $perPage): array
    {
        $conditions = [];
        $params = [];

        if (empty($filters['include_deleted'])) {
            $conditions[] = 'p.deleted_at IS NULL';
        }
        if (!empty($filters['group'])) {
            $conditions[] = 'p.group_id = :group';
            $params[':group'] = $filters['group'];
        }
        if (!empty($filters['status'])) {
            $conditions[] = 'p.status = :status';
            $params[':status'] = $filters['status'];
        }
        if (!empty($filters['network'])) {
            $conditions[] = 'p.network = :network';
            $params[':network'] = $filters['network'];
        }
        if (!empty($filters['q'])) {
            $conditions[] = '(p.number LIKE :q OR p.label LIKE :q OR p.external_id LIKE :q OR p.campaign LIKE :q)';
            $params[':q'] = '%' . $filters['q'] . '%';
        }

        $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

        $count = $this->pdo()->prepare('SELECT COUNT(*) FROM phone_numbers p' . $where);
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $sql = 'SELECT p.*, g.name AS group_name
                  FROM phone_numbers p
                  LEFT JOIN phone_groups g ON g.id = p.group_id'
            . $where
            . ' ORDER BY g.name ASC, p.priority ASC, p.number ASC LIMIT ' . $perPage . ' OFFSET ' . $offset;

        $statement = $this->pdo()->prepare($sql);
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return [
            'items' => array_map(fn (array $row): array => $this->hydrate($row), $rows),
            'meta' => $this->paginationMeta($total, $page, $perPage),
        ];
    }

    /** @return array<string,mixed> */
    public function adminFind(int $id, bool $withDeleted = false): array
    {
        $sql = 'SELECT p.*, g.name AS group_name
                  FROM phone_numbers p
                  LEFT JOIN phone_groups g ON g.id = p.group_id
                 WHERE p.id = :id' . ($withDeleted ? '' : ' AND p.deleted_at IS NULL') . ' LIMIT 1';
        $statement = $this->pdo()->prepare($sql);
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('Phone number not found.');
        }
        return $this->hydrate($row);
    }

    /** Services that currently use a given group (used by the mapping screen). */
    /** @return array<int,array<string,mixed>> */
    public function servicesForNumber(int $numberId): array
    {
        $sql = 'SELECT s.id, s.slug, s.name
                  FROM phone_numbers p
                  INNER JOIN service_phone_groups spg ON spg.group_id = p.group_id
                  INNER JOIN services s ON s.id = spg.service_id
                 WHERE p.id = :id AND s.deleted_at IS NULL
                 ORDER BY s.name ASC';
        $statement = $this->pdo()->prepare($sql);
        $statement->execute([':id' => $numberId]);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /* ------------------------------------------------------------------ */
    /*  Admin writes                                                       */
    /* ------------------------------------------------------------------ */

    /** @param array<string,mixed> $data */
    public function create(array $data): int
    {
        $payload = $this->prepareWrite($data, true);

        $columns = array_keys($payload);
        $sql = 'INSERT INTO phone_numbers (' . implode(', ', array_map(static fn (string $c): string => '`' . $c . '`', $columns)) . ')'
            . ' VALUES (' . implode(', ', array_map(static fn (string $c): string => ':' . $c, $columns)) . ')';

        $statement = $this->pdo()->prepare($sql);
        $statement->execute($this->bindings($payload));

        return (int) $this->pdo()->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function update(int $id, array $data): void
    {
        $payload = $this->prepareWrite($data, false);
        if ($payload === []) {
            return;
        }

        $assignments = array_map(static fn (string $c): string => '`' . $c . '` = :' . $c, array_keys($payload));
        $statement = $this->pdo()->prepare('UPDATE phone_numbers SET ' . implode(', ', $assignments) . ' WHERE id = :id');
        $statement->execute($this->bindings($payload) + [':id' => $id]);
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    /** Normalises `(800) 779-3921` / `+1 800 779 3921` to `800-779-3921`. */
    public static function normalise(string $input): ?string
    {
        $digits = preg_replace('/\D+/', '', $input) ?? '';
        if (strlen($digits) === 11 && str_starts_with($digits, '1')) {
            $digits = substr($digits, 1);
        }
        if (strlen($digits) !== 10) {
            return null;
        }
        // Reject obviously invalid NANP numbers (area code / prefix cannot start with 0 or 1).
        if ($digits[0] === '0' || $digits[0] === '1' || $digits[3] === '0' || $digits[3] === '1') {
            return null;
        }
        return substr($digits, 0, 3) . '-' . substr($digits, 3, 3) . '-' . substr($digits, 6, 4);
    }

    /** @param array<string,mixed> $row */
    private function hydrate(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'external_id' => $row['external_id'],
            'group_id' => $row['group_id'],
            'group_name' => $row['group_name'] ?? null,
            'number' => $row['number'],
            'tel' => 'tel:+1' . preg_replace('/\D+/', '', (string) $row['number']),
            'label' => $row['label'],
            'priority' => (int) $row['priority'],
            'priority_label' => (int) $row['priority'] === 1 ? 'Call Now' : 'Call Alternate',
            'status' => $row['status'],
            'network' => $row['network'],
            'campaign' => $row['campaign'],
            'campaign_nationwide' => (int) $row['campaign_nationwide'] === 1,
            'campaign_states' => self::decodeJsonList($row['campaign_states']),
            'campaign_zip_codes' => self::decodeJsonList($row['campaign_zip_codes']),
            'notes' => $row['notes'],
            'verified_at' => $row['verified_at'],
            'is_verified' => $row['verified_at'] !== null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
            'deleted_at' => $row['deleted_at'],
        ];
    }

    /** @param array<string,mixed> $data
     *  @return array<string,mixed> */
    private function prepareWrite(array $data, bool $isCreate): array
    {
        $payload = [];

        foreach (self::WRITABLE as $column) {
            if (!array_key_exists($column, $data)) {
                continue;
            }
            $value = $data[$column];

            if ($column === 'number' && $value !== null) {
                $normalised = self::normalise((string) $value);
                if ($normalised === null) {
                    throw ApiException::unprocessable('Enter a valid 10-digit US phone number.', ['number' => 'Not a dialable US number.']);
                }
                $value = $normalised;
            } elseif (in_array($column, ['campaign_states', 'campaign_zip_codes'], true)) {
                $value = self::encodeJson($value);
            } elseif (in_array($column, ['priority'], true)) {
                $value = (int) $value;
            } elseif ($column === 'campaign_nationwide') {
                $value = $value ? 1 : 0;
            } elseif ($column === 'verified_at' && $value === '') {
                $value = null;
            }

            $payload[$column] = $value;
        }

        if (isset($payload['status'])) {
            if (!in_array($payload['status'], self::STATUSES, true)) {
                throw ApiException::unprocessable('Unknown number status.', ['status' => 'Use active, pending-verification or inactive.']);
            }
            if ($payload['status'] === 'active' && empty($payload['verified_at'])) {
                $payload['verified_at'] = gmdate('Y-m-d H:i:s');
            }
        }

        if ($isCreate) {
            $payload += [
                'priority' => $payload['priority'] ?? 1,
                'status' => $payload['status'] ?? 'pending-verification',
                'campaign_nationwide' => $payload['campaign_nationwide'] ?? 0,
            ];
        }

        if (isset($payload['external_id'])) {
            $payload['external_id'] = substr((string) $payload['external_id'], 0, 64);
        }

        return $payload;
    }

    /** @param array<string,mixed> $payload
     *  @return array<string,mixed> */
    private function bindings(array $payload): array
    {
        $bindings = [];
        foreach ($payload as $column => $value) {
            $bindings[':' . $column] = $value;
        }
        return $bindings;
    }
}
