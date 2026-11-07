<?php
/**
 * Homepage sections (hero, trust bar, service picker …) with ordering and
 * visibility control.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class HomepageModel extends BaseModel
{
    protected string $table = 'homepage_sections';
    protected bool $softDeletes = false;

    /** @return array<int,array<string,mixed>> */
    public function publicSections(): array
    {
        $sql = 'SELECT section_key, name, heading, subheading, body, sort_order
                  FROM homepage_sections
                 WHERE visible = 1
                 ORDER BY sort_order ASC, id ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(static fn (array $row): array => [
            'key' => $row['section_key'],
            'name' => $row['name'],
            'heading' => $row['heading'],
            'subheading' => $row['subheading'],
            'body' => $row['body'],
            'sort_order' => (int) $row['sort_order'],
        ], $rows);
    }

    /** @return array<int,array<string,mixed>> */
    public function adminList(): array
    {
        $rows = $this->pdo()->query('SELECT * FROM homepage_sections ORDER BY sort_order ASC, id ASC')->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map([$this, 'hydrate'], $rows);
    }

    /** @return array<string,mixed> */
    public function adminFind(int $id): array
    {
        $row = $this->find($id);
        if ($row === null) {
            throw ApiException::notFound('Homepage section not found.');
        }
        return $this->hydrate($row);
    }

    /** @param array<string,mixed> $data */
    public function create(array $data): int
    {
        $statement = $this->pdo()->prepare(
            'INSERT INTO homepage_sections (section_key, name, heading, subheading, body, visible, sort_order)
             VALUES (:section_key, :name, :heading, :subheading, :body, :visible, :sort_order)',
        );
        $statement->execute([
            ':section_key' => $data['section_key'],
            ':name' => $data['name'],
            ':heading' => $data['heading'] ?? null,
            ':subheading' => $data['subheading'] ?? null,
            ':body' => $data['body'] ?? null,
            ':visible' => !empty($data['visible']) ? 1 : 0,
            ':sort_order' => (int) ($data['sort_order'] ?? 0),
        ]);
        return (int) $this->pdo()->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function update(int $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];
        foreach (['section_key', 'name', 'heading', 'subheading', 'body', 'visible', 'sort_order'] as $column) {
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
        $statement = $this->pdo()->prepare('UPDATE homepage_sections SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $statement->execute($bindings);
    }

    public function delete(int $id): void
    {
        $statement = $this->pdo()->prepare('DELETE FROM homepage_sections WHERE id = :id');
        $statement->execute([':id' => $id]);
    }

    /** @param array<int,int> $orderedIds */
    public function reorder(array $orderedIds): void
    {
        $pdo = $this->pdo();
        $statement = $pdo->prepare('UPDATE homepage_sections SET sort_order = :sort_order WHERE id = :id');
        $pdo->beginTransaction();
        try {
            foreach (array_values($orderedIds) as $index => $id) {
                $statement->execute([':sort_order' => $index + 1, ':id' => (int) $id]);
            }
            $pdo->commit();
        } catch (\Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    /** @param array<string,mixed> $row */
    private function hydrate(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'section_key' => $row['section_key'],
            'name' => $row['name'],
            'heading' => $row['heading'],
            'subheading' => $row['subheading'],
            'body' => $row['body'],
            'visible' => (int) $row['visible'] === 1,
            'sort_order' => (int) $row['sort_order'],
            'updated_at' => $row['updated_at'],
        ];
    }
}
