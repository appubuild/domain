<?php
/**
 * Shared model behaviour: connection access, soft deletes, pagination, JSON
 * column decoding.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\Database;

abstract class BaseModel
{
    /** SQL table name (no prefix). */
    protected string $table = '';

    protected string $primaryKey = 'id';

    protected bool $softDeletes = true;

    protected function pdo(): PDO
    {
        return Database::pdo();
    }

    /** @return array<string,mixed>|null */
    public function find(int|string $id, bool $withDeleted = false): ?array
    {
        $sql = 'SELECT * FROM `' . $this->table . '` WHERE `' . $this->primaryKey . '` = :id';
        if ($this->softDeletes && !$withDeleted) {
            $sql .= ' AND deleted_at IS NULL';
        }
        $statement = $this->pdo()->prepare($sql . ' LIMIT 1');
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return is_array($row) ? $row : null;
    }

    public function softDelete(int|string $id): bool
    {
        $statement = $this->pdo()->prepare(
            'UPDATE `' . $this->table . '` SET deleted_at = UTC_TIMESTAMP() WHERE `' . $this->primaryKey . '` = :id',
        );
        $statement->execute([':id' => $id]);
        return $statement->rowCount() > 0;
    }

    public function restore(int|string $id): bool
    {
        $statement = $this->pdo()->prepare(
            'UPDATE `' . $this->table . '` SET deleted_at = NULL WHERE `' . $this->primaryKey . '` = :id',
        );
        $statement->execute([':id' => $id]);
        return $statement->rowCount() > 0;
    }

    public function hardDelete(int|string $id): bool
    {
        $statement = $this->pdo()->prepare(
            'DELETE FROM `' . $this->table . '` WHERE `' . $this->primaryKey . '` = :id',
        );
        $statement->execute([':id' => $id]);
        return $statement->rowCount() > 0;
    }

    /** @param array<string,mixed> $extra */
    protected function paginationMeta(int $total, int $page, int $perPage, array $extra = []): array
    {
        $lastPage = $perPage > 0 ? (int) ceil($total / $perPage) : 0;
        return array_merge([
            'page' => $page,
            'per_page' => $perPage,
            'total' => $total,
            'total_pages' => max(0, $lastPage),
            'has_more' => $page < $lastPage,
        ], $extra);
    }

    /** @return array<int,mixed> */
    protected static function decodeJsonList(mixed $value): array
    {
        if (is_array($value)) {
            return array_values($value);
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return is_array($decoded) ? array_values($decoded) : [];
    }

    /** @return array<string,mixed> */
    protected static function decodeJsonObject(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

    protected static function encodeJson(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $value = $decoded;
            }
        }
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Converts MySQL booleans/ints coming back as strings. */
    protected static function castBool(mixed $value): bool
    {
        return (int) $value === 1;
    }

    protected static function castInt(mixed $value): int
    {
        return (int) $value;
    }
}
