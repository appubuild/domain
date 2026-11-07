<?php
/**
 * Niches — higher-level groupings used for internal organisation and the
 * homepage "popular categories" module.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class NicheModel extends BaseModel
{
    protected string $table = 'niches';

    /** @return array<int,array<string,mixed>> */
    public function publicList(): array
    {
        $sql = 'SELECT n.id, n.slug, n.name, n.description, n.tone, n.sort_order,
                       (SELECT COUNT(*) FROM services s
                         WHERE s.niche_id = n.id AND s.deleted_at IS NULL AND s.status = "published") AS service_count
                  FROM niches n
                 WHERE n.deleted_at IS NULL AND n.status = "active"
                 ORDER BY n.sort_order ASC, n.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'description' => $row['description'],
            'tone' => $row['tone'],
            'service_count' => (int) $row['service_count'],
        ], $rows);
    }

    /**
     * @param array{status?:string,q?:string,include_deleted?:bool} $filters
     * @return array{items:array<int,array<string,mixed>>,meta:array<string,mixed>}
     */
    public function adminList(array $filters, int $page, int $perPage): array
    {
        $conditions = [];
        $params = [];

        if (empty($filters['include_deleted'])) {
            $conditions[] = 'n.deleted_at IS NULL';
        }
        if (!empty($filters['status'])) {
            $conditions[] = 'n.status = :status';
            $params[':status'] = $filters['status'];
        }
        if (!empty($filters['q'])) {
            $conditions[] = '(n.name LIKE :q OR n.slug LIKE :q OR n.description LIKE :q)';
            $params[':q'] = '%' . $filters['q'] . '%';
        }

        $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

        $count = $this->pdo()->prepare('SELECT COUNT(*) FROM niches n' . $where);
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $sql = 'SELECT n.*,
                       (SELECT COUNT(*) FROM services s WHERE s.niche_id = n.id AND s.deleted_at IS NULL) AS service_count
                  FROM niches n' . $where
            . ' ORDER BY n.sort_order ASC, n.name ASC LIMIT ' . $perPage . ' OFFSET ' . $offset;

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
        $statement = $this->pdo()->prepare(
            'SELECT n.*, (SELECT COUNT(*) FROM services s WHERE s.niche_id = n.id AND s.deleted_at IS NULL) AS service_count
               FROM niches n WHERE n.id = :id' . ($withDeleted ? '' : ' AND n.deleted_at IS NULL') . ' LIMIT 1',
        );
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('Niche not found.');
        }
        return $this->hydrate($row);
    }

    /** @param array<string,mixed> $data */
    public function create(array $data): int
    {
        $statement = $this->pdo()->prepare(
            'INSERT INTO niches (slug, name, description, tone, status, sort_order)
             VALUES (:slug, :name, :description, :tone, :status, :sort_order)',
        );
        $statement->execute([
            ':slug' => $data['slug'],
            ':name' => $data['name'],
            ':description' => $data['description'] ?? null,
            ':tone' => $data['tone'] ?? 'brand',
            ':status' => $data['status'] ?? 'active',
            ':sort_order' => (int) ($data['sort_order'] ?? 0),
        ]);

        return (int) $this->pdo()->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function update(int $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];

        foreach (['slug', 'name', 'description', 'tone', 'status', 'sort_order'] as $column) {
            if (!array_key_exists($column, $data)) {
                continue;
            }
            $fields[] = '`' . $column . '` = :' . $column;
            $bindings[':' . $column] = $column === 'sort_order' ? (int) $data[$column] : $data[$column];
        }

        if ($fields === []) {
            return;
        }

        $statement = $this->pdo()->prepare('UPDATE niches SET ' . implode(', ', $fields) . ' WHERE id = :id AND deleted_at IS NULL');
        $statement->execute($bindings);
    }

    /** @param array<string,mixed> $row */
    private function hydrate(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'description' => $row['description'],
            'tone' => $row['tone'],
            'status' => $row['status'],
            'sort_order' => (int) $row['sort_order'],
            'service_count' => isset($row['service_count']) ? (int) $row['service_count'] : 0,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
            'deleted_at' => $row['deleted_at'],
        ];
    }
}
