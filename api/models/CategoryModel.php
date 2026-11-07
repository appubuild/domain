<?php
/**
 * Service categories (the five public buckets: exterior, systems, remodeling,
 * restoration, specialty). The id is a stable string used by the frontend.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class CategoryModel extends BaseModel
{
    protected string $table = 'service_categories';
    protected bool $softDeletes = false;

    /** @return array<int,array<string,mixed>> */
    public function all(): array
    {
        $sql = 'SELECT c.*,
                       (SELECT COUNT(*) FROM services s
                         WHERE s.category_id = c.id AND s.deleted_at IS NULL) AS service_count
                  FROM service_categories c
                 ORDER BY c.sort_order ASC, c.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(static fn (array $row): array => [
            'id' => $row['id'],
            'name' => $row['name'],
            'description' => $row['description'],
            'sort_order' => (int) $row['sort_order'],
            'service_count' => (int) $row['service_count'],
        ], $rows);
    }

    /** @return array<string,mixed> */
    public function findOrFail(string $id): array
    {
        $statement = $this->pdo()->prepare('SELECT * FROM service_categories WHERE id = :id LIMIT 1');
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('Category not found.');
        }
        return $row;
    }

    /** @param array<string,mixed> $data */
    public function create(array $data): string
    {
        $statement = $this->pdo()->prepare(
            'INSERT INTO service_categories (id, name, description, sort_order) VALUES (:id, :name, :description, :sort_order)',
        );
        $statement->execute([
            ':id' => $data['id'],
            ':name' => $data['name'],
            ':description' => $data['description'] ?? null,
            ':sort_order' => (int) ($data['sort_order'] ?? 0),
        ]);
        return (string) $data['id'];
    }

    /** @param array<string,mixed> $data */
    public function update(string $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];
        foreach (['name', 'description', 'sort_order'] as $column) {
            if (!array_key_exists($column, $data)) {
                continue;
            }
            $fields[] = '`' . $column . '` = :' . $column;
            $bindings[':' . $column] = $column === 'sort_order' ? (int) $data[$column] : $data[$column];
        }
        if ($fields === []) {
            return;
        }
        $statement = $this->pdo()->prepare('UPDATE service_categories SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $statement->execute($bindings);
    }

    public function delete(string $id): void
    {
        $check = $this->pdo()->prepare('SELECT COUNT(*) FROM services WHERE category_id = :id AND deleted_at IS NULL');
        $check->execute([':id' => $id]);
        if ((int) $check->fetchColumn() > 0) {
            throw ApiException::conflict('Reassign the services in this category first.');
        }

        $statement = $this->pdo()->prepare('DELETE FROM service_categories WHERE id = :id');
        $statement->execute([':id' => $id]);
    }
}
