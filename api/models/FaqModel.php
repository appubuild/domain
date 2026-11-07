<?php
/**
 * FAQ groups and questions shown on the homepage and How it works page.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class FaqModel extends BaseModel
{
    protected string $table = 'faqs';
    protected bool $softDeletes = false;

    /** @return array<int,array<string,mixed>> */
    public function publicGroups(): array
    {
        $sql = 'SELECT f.group_id, g.name AS group_name, f.id, f.question, f.answer, f.sort_order
                  FROM faqs f
                  INNER JOIN faq_groups g ON g.id = f.group_id
                 WHERE f.visible = 1
                 ORDER BY g.id ASC, f.sort_order ASC, f.id ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $groups = [];
        foreach ($rows as $row) {
            $key = (string) $row['group_id'];
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'id' => $key,
                    'name' => $row['group_name'],
                    'faqs' => [],
                ];
            }
            $groups[$key]['faqs'][] = [
                'id' => (int) $row['id'],
                'question' => $row['question'],
                'answer' => $row['answer'],
            ];
        }

        return array_values($groups);
    }

    /** @return array<int,array<string,mixed>> */
    public function adminGroups(): array
    {
        $sql = 'SELECT g.id, g.name, (SELECT COUNT(*) FROM faqs f WHERE f.group_id = g.id) AS faq_count
                  FROM faq_groups g ORDER BY g.id ASC';
        return $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @param array{group?:string,q?:string} $filters
     * @return array{items:array<int,array<string,mixed>>,meta:array<string,mixed>}
     */
    public function adminList(array $filters, int $page, int $perPage): array
    {
        $conditions = [];
        $params = [];

        if (!empty($filters['group'])) {
            $conditions[] = 'f.group_id = :group';
            $params[':group'] = $filters['group'];
        }
        if (!empty($filters['q'])) {
            $conditions[] = '(f.question LIKE :q OR f.answer LIKE :q)';
            $params[':q'] = '%' . $filters['q'] . '%';
        }

        $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

        $count = $this->pdo()->prepare('SELECT COUNT(*) FROM faqs f' . $where);
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $sql = 'SELECT f.*, g.name AS group_name FROM faqs f
                  LEFT JOIN faq_groups g ON g.id = f.group_id' . $where
            . ' ORDER BY f.group_id ASC, f.sort_order ASC, f.id ASC LIMIT ' . $perPage . ' OFFSET ' . $offset;

        $statement = $this->pdo()->prepare($sql);
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return [
            'items' => array_map(static fn (array $row): array => [
                'id' => (int) $row['id'],
                'group_id' => $row['group_id'],
                'group_name' => $row['group_name'] ?? null,
                'question' => $row['question'],
                'answer' => $row['answer'],
                'sort_order' => (int) $row['sort_order'],
                'visible' => (int) $row['visible'] === 1,
                'updated_at' => $row['updated_at'],
            ], $rows),
            'meta' => $this->paginationMeta($total, $page, $perPage),
        ];
    }

    /** @return array<string,mixed> */
    public function adminFind(int $id): array
    {
        $row = $this->find($id);
        if ($row === null) {
            throw ApiException::notFound('FAQ not found.');
        }
        return [
            'id' => (int) $row['id'],
            'group_id' => $row['group_id'],
            'question' => $row['question'],
            'answer' => $row['answer'],
            'sort_order' => (int) $row['sort_order'],
            'visible' => (int) $row['visible'] === 1,
        ];
    }

    /** @param array<string,mixed> $data */
    public function create(array $data): int
    {
        $statement = $this->pdo()->prepare(
            'INSERT INTO faqs (group_id, question, answer, sort_order, visible)
             VALUES (:group_id, :question, :answer, :sort_order, :visible)',
        );
        $statement->execute([
            ':group_id' => $data['group_id'],
            ':question' => $data['question'],
            ':answer' => $data['answer'],
            ':sort_order' => (int) ($data['sort_order'] ?? 0),
            ':visible' => !empty($data['visible']) ? 1 : 0,
        ]);
        return (int) $this->pdo()->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function update(int $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];
        foreach (['group_id', 'question', 'answer', 'sort_order', 'visible'] as $column) {
            if (!array_key_exists($column, $data)) {
                continue;
            }
            $fields[] = '`' . $column . '` = :' . $column;
            $bindings[':' . $column] = match ($column) {
                'visible' => !empty($data[$column]) ? 1 : 0,
                'sort_order' => (int) $data[$column],
                default => $data[$column],
            };
        }
        if ($fields === []) {
            return;
        }
        $statement = $this->pdo()->prepare('UPDATE faqs SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $statement->execute($bindings);
    }

    public function delete(int $id): void
    {
        $statement = $this->pdo()->prepare('DELETE FROM faqs WHERE id = :id');
        $statement->execute([':id' => $id]);
    }

    /** @param array<string,mixed> $data */
    public function createGroup(array $data): string
    {
        $statement = $this->pdo()->prepare('INSERT INTO faq_groups (id, name) VALUES (:id, :name)');
        $statement->execute([':id' => $data['id'], ':name' => $data['name']]);
        return (string) $data['id'];
    }

    /** @param array<string,mixed> $data */
    public function updateGroup(string $id, array $data): void
    {
        if (!array_key_exists('name', $data)) {
            return;
        }
        $statement = $this->pdo()->prepare('UPDATE faq_groups SET name = :name WHERE id = :id');
        $statement->execute([':name' => $data['name'], ':id' => $id]);
    }

    public function deleteGroup(string $id): void
    {
        $count = $this->pdo()->prepare('SELECT COUNT(*) FROM faqs WHERE group_id = :id');
        $count->execute([':id' => $id]);
        if ((int) $count->fetchColumn() > 0) {
            throw ApiException::conflict('Delete or move the questions in this group first.');
        }
        $statement = $this->pdo()->prepare('DELETE FROM faq_groups WHERE id = :id');
        $statement->execute([':id' => $id]);
    }
}
