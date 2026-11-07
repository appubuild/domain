<?php
/**
 * Phone groups — the "trades" that own one or more tracking numbers.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class PhoneGroupModel extends BaseModel
{
    protected string $table = 'phone_groups';
    protected string $primaryKey = 'id';
    protected bool $softDeletes = false;

    /** @return array<int,array<string,mixed>> */
    public function all(): array
    {
        $sql = 'SELECT g.*,
                       (SELECT COUNT(*) FROM phone_numbers p
                         WHERE p.group_id = g.id AND p.deleted_at IS NULL) AS number_count,
                       (SELECT COUNT(*) FROM phone_numbers p
                         WHERE p.group_id = g.id AND p.deleted_at IS NULL AND p.status = "active") AS active_number_count,
                       (SELECT COUNT(*) FROM service_phone_groups spg WHERE spg.group_id = g.id) AS service_count
                  FROM phone_groups g
                 ORDER BY g.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(static fn (array $row): array => [
            'id' => $row['id'],
            'name' => $row['name'],
            'label' => $row['label'],
            'blurb' => $row['blurb'],
            'icon' => $row['icon'],
            'number_count' => (int) $row['number_count'],
            'active_number_count' => (int) $row['active_number_count'],
            'service_count' => (int) $row['service_count'],
        ], $rows);
    }

    /** @return array<string,mixed> */
    public function findOrFail(string $id): array
    {
        $statement = $this->pdo()->prepare('SELECT * FROM phone_groups WHERE id = :id LIMIT 1');
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('Phone group not found.');
        }
        return $row;
    }

    /** @param array<string,mixed> $data */
    public function create(array $data): string
    {
        $id = (string) ($data['id'] ?? '');
        $statement = $this->pdo()->prepare(
            'INSERT INTO phone_groups (id, name, label, blurb, icon) VALUES (:id, :name, :label, :blurb, :icon)',
        );
        $statement->execute([
            ':id' => $id,
            ':name' => $data['name'],
            ':label' => $data['label'] ?? null,
            ':blurb' => $data['blurb'] ?? null,
            ':icon' => $data['icon'] ?? null,
        ]);

        return $id;
    }

    /** @param array<string,mixed> $data */
    public function update(string $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];
        foreach (['name', 'label', 'blurb', 'icon'] as $column) {
            if (array_key_exists($column, $data)) {
                $fields[] = '`' . $column . '` = :' . $column;
                $bindings[':' . $column] = $data[$column];
            }
        }
        if ($fields === []) {
            return;
        }

        $statement = $this->pdo()->prepare('UPDATE phone_groups SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $statement->execute($bindings);
    }

    /** A group can only be removed when nothing references it. */
    public function delete(string $id): void
    {
        $numbers = $this->pdo()->prepare('SELECT COUNT(*) FROM phone_numbers WHERE group_id = :id AND deleted_at IS NULL');
        $numbers->execute([':id' => $id]);
        if ((int) $numbers->fetchColumn() > 0) {
            throw ApiException::conflict('Move or delete the numbers in this group first.');
        }

        $services = $this->pdo()->prepare('SELECT COUNT(*) FROM service_phone_groups WHERE group_id = :id');
        $services->execute([':id' => $id]);
        if ((int) $services->fetchColumn() > 0) {
            throw ApiException::conflict('Remove this group from its services first.');
        }

        $statement = $this->pdo()->prepare('DELETE FROM phone_groups WHERE id = :id');
        $statement->execute([':id' => $id]);
    }
}
