<?php
/**
 * Static pages (Home, About, How it works, legal pages …).
 *
 * Scheduled pages become public automatically once published_at is reached.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class PageModel extends BaseModel
{
    protected string $table = 'pages';

    private const WRITABLE = [
        'slug', 'title', 'template', 'status', 'excerpt', 'body',
        'seo_title', 'seo_description', 'focus_keyword', 'secondary_keywords',
        'canonical_url', 'noindex', 'og_image', 'page_group', 'sort_order',
        'published_at', 'scheduled_at',
    ];

    private const PUBLIC_CONDITION = '(p.status = "published" OR (p.status = "scheduled" AND p.scheduled_at IS NOT NULL AND p.scheduled_at <= UTC_TIMESTAMP()))';

    /** @return array<string,mixed>|null */
    public function publicBySlug(string $slug): ?array
    {
        $statement = $this->pdo()->prepare(
            'SELECT p.slug, p.title, p.template, p.excerpt, p.body, p.seo_title, p.seo_description,
                    p.focus_keyword, p.secondary_keywords, p.canonical_url, p.noindex, p.og_image,
                    p.page_group, p.sort_order, p.published_at, p.updated_at
               FROM pages p
              WHERE p.slug = :slug AND p.deleted_at IS NULL AND ' . self::PUBLIC_CONDITION . '
              LIMIT 1',
        );
        $statement->execute([':slug' => $slug]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return is_array($row) ? $row : null;
    }

    /** @return array<int,array<string,mixed>> */
    public function publicIndex(): array
    {
        $sql = 'SELECT p.slug, p.title, p.template, p.excerpt, p.seo_title, p.seo_description,
                       p.focus_keyword, p.canonical_url, p.noindex, p.og_image, p.page_group,
                       p.sort_order, p.published_at, p.updated_at
                  FROM pages p
                 WHERE p.deleted_at IS NULL AND ' . self::PUBLIC_CONDITION . '
                 ORDER BY p.sort_order ASC, p.slug ASC';
        return $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
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
            $conditions[] = 'p.deleted_at IS NULL';
        }
        if (!empty($filters['status'])) {
            $conditions[] = 'p.status = :status';
            $params[':status'] = $filters['status'];
        }
        if (!empty($filters['q'])) {
            $conditions[] = '(p.title LIKE :q OR p.slug LIKE :q OR p.excerpt LIKE :q)';
            $params[':q'] = '%' . $filters['q'] . '%';
        }

        $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

        $count = $this->pdo()->prepare('SELECT COUNT(*) FROM pages p' . $where);
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $sql = 'SELECT p.*, a.name AS updated_by_name
                  FROM pages p
                  LEFT JOIN admins a ON a.id = p.updated_by' . $where
            . ' ORDER BY p.updated_at DESC LIMIT ' . $perPage . ' OFFSET ' . $offset;

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
            'SELECT p.*, a.name AS updated_by_name
               FROM pages p LEFT JOIN admins a ON a.id = p.updated_by
              WHERE p.id = :id' . ($withDeleted ? '' : ' AND p.deleted_at IS NULL') . ' LIMIT 1',
        );
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('Page not found.');
        }
        return $this->hydrate($row);
    }

    /** @param array<string,mixed> $data */
    public function create(array $data, ?int $adminId): int
    {
        $payload = $this->prepareWrite($data, true);
        $payload['updated_by'] = $adminId;

        $columns = array_keys($payload);
        $sql = 'INSERT INTO pages (' . implode(', ', array_map(static fn (string $c): string => '`' . $c . '`', $columns)) . ')'
            . ' VALUES (' . implode(', ', array_map(static fn (string $c): string => ':' . $c, $columns)) . ')';
        $statement = $this->pdo()->prepare($sql);
        $statement->execute($this->bindings($payload));

        return (int) $this->pdo()->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function update(int $id, array $data, ?int $adminId): void
    {
        $payload = $this->prepareWrite($data, false);
        $payload['updated_by'] = $adminId;

        $assignments = array_map(static fn (string $c): string => '`' . $c . '` = :' . $c, array_keys($payload));
        $statement = $this->pdo()->prepare('UPDATE pages SET ' . implode(', ', $assignments) . ' WHERE id = :id AND deleted_at IS NULL');
        $statement->execute($this->bindings($payload) + [':id' => $id]);
    }

    /** @param array<string,mixed> $row */
    private function hydrate(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'title' => $row['title'],
            'template' => $row['template'],
            'status' => $row['status'],
            'excerpt' => $row['excerpt'],
            'body' => $row['body'],
            'seo_title' => $row['seo_title'],
            'seo_description' => $row['seo_description'],
            'focus_keyword' => $row['focus_keyword'] ?? null,
            'secondary_keywords' => $row['secondary_keywords'] ?? null,
            'canonical_url' => $row['canonical_url'] ?? null,
            'noindex' => (int) ($row['noindex'] ?? 0),
            'og_image' => $row['og_image'] ?? null,
            'page_group' => $row['page_group'] ?? null,
            'sort_order' => (int) ($row['sort_order'] ?? 0),
            'scheduled_at' => $row['scheduled_at'] ?? null,
            'published_at' => $row['published_at'],
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
            'deleted_at' => $row['deleted_at'],
            'updated_by' => $row['updated_by'] !== null ? (int) $row['updated_by'] : null,
            'updated_by_name' => $row['updated_by_name'] ?? null,
        ];
    }

    /** @param array<string,mixed> $data
     *  @return array<string,mixed> */
    private function prepareWrite(array $data, bool $isCreate): array
    {
        $payload = [];
        foreach (self::WRITABLE as $column) {
            if (array_key_exists($column, $data)) {
                $payload[$column] = $data[$column] === '' ? null : $data[$column];
            }
        }

        if ($isCreate) {
            $payload += ['template' => 'standard', 'status' => 'draft'];
        }

        if (array_key_exists('noindex', $payload)) {
            $payload['noindex'] = $payload['noindex'] ? 1 : 0;
        }

        if (($payload['status'] ?? null) === 'published' && empty($payload['published_at'])) {
            $payload['published_at'] = gmdate('Y-m-d H:i:s');
        }

        if (($payload['status'] ?? null) === 'scheduled') {
            if (empty($payload['scheduled_at']) && !empty($payload['published_at'])) {
                $payload['scheduled_at'] = $payload['published_at'];
            }
            if (!empty($payload['scheduled_at'])) {
                $payload['published_at'] = $payload['scheduled_at'];
            }
        }

        return $payload;
    }

    /* ------------------------------------------------------------------ */
    /*  Scheduling                                                         */
    /* ------------------------------------------------------------------ */

    /** @return array<int,array<string,mixed>> */
    public function dueScheduled(int $limit = 50): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT id, slug, title, scheduled_at FROM pages
              WHERE status = "scheduled" AND deleted_at IS NULL
                AND scheduled_at IS NOT NULL AND scheduled_at <= UTC_TIMESTAMP()
              ORDER BY scheduled_at ASC
              LIMIT ' . max(1, min(200, $limit)),
        );
        $statement->execute();
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** Publishes one scheduled page; true only for the winning transition. */
    public function publishScheduled(int $pageId): bool
    {
        $statement = $this->pdo()->prepare(
            'UPDATE pages
                SET status = "published", published_at = UTC_TIMESTAMP()
              WHERE id = :id AND status = "scheduled" AND deleted_at IS NULL
                AND scheduled_at IS NOT NULL AND scheduled_at <= UTC_TIMESTAMP()',
        );
        $statement->execute([':id' => $pageId]);
        return $statement->rowCount() === 1;
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
