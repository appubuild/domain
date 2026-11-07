<?php
/**
 * Blog posts, categories and tags.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class BlogModel extends BaseModel
{
    protected string $table = 'blog_posts';

    private const WRITABLE = [
        'slug', 'title', 'category_id', 'status', 'excerpt', 'body',
        'featured_image', 'featured_image_alt', 'seo_title', 'seo_description',
        'seo_summary', 'focus_keyword', 'secondary_keywords', 'canonical_url',
        'noindex', 'social_image', 'author_name', 'published_at', 'scheduled_at',
        'updated_by',
    ];

    /** Editorial extras stored in blog_post_metadata (one row per key). */
    public const METADATA_KEYS = [
        'search_intent', 'target_audience', 'article_length', 'cta_target',
        'internal_links', 'visual_direction', 'editor_notes',
    ];

    private const PUBLIC_CONDITION = '(b.status = "published" OR (b.status = "scheduled" AND b.scheduled_at IS NOT NULL AND b.scheduled_at <= UTC_TIMESTAMP()))';

    /* ------------------------------------------------------------------ */
    /*  Public reads                                                       */
    /* ------------------------------------------------------------------ */

    /**
     * @param array{category?:string,tag?:string,q?:string} $filters
     * @return array{items:array<int,array<string,mixed>>,meta:array<string,mixed>}
     */
    public function publicIndex(array $filters, int $page, int $perPage): array
    {
        $conditions = ['b.deleted_at IS NULL', self::PUBLIC_CONDITION];
        $params = [];

        if (!empty($filters['category'])) {
            $conditions[] = 'c.slug = :category';
            $params[':category'] = $filters['category'];
        }
        if (!empty($filters['tag'])) {
            $conditions[] = 'EXISTS (SELECT 1 FROM blog_post_tags bpt
                                        INNER JOIN blog_tags t ON t.id = bpt.tag_id
                                       WHERE bpt.post_id = b.id AND t.slug = :tag)';
            $params[':tag'] = $filters['tag'];
        }
        if (!empty($filters['q'])) {
            $conditions[] = '(b.title LIKE :q OR b.excerpt LIKE :q OR b.body LIKE :q)';
            $params[':q'] = '%' . $filters['q'] . '%';
        }

        $where = ' WHERE ' . implode(' AND ', $conditions);

        $count = $this->pdo()->prepare(
            'SELECT COUNT(*) FROM blog_posts b LEFT JOIN blog_categories c ON c.id = b.category_id' . $where,
        );
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $sql = 'SELECT b.id, b.slug, b.title, b.excerpt, b.featured_image, b.featured_image_alt,
                       b.author_name, b.published_at, b.seo_title, b.seo_description,
                       b.focus_keyword, b.social_image, b.view_count,
                       c.slug AS category_slug, c.name AS category_name,
                       c.seo_title AS category_seo_title, c.seo_description AS category_seo_description
                  FROM blog_posts b
                  LEFT JOIN blog_categories c ON c.id = b.category_id'
            . $where
            . ' ORDER BY b.published_at DESC, b.id DESC LIMIT ' . $perPage . ' OFFSET ' . $offset;

        $statement = $this->pdo()->prepare($sql);
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return [
            'items' => array_map(static fn (array $row): array => [
                'id' => (int) $row['id'],
                'slug' => $row['slug'],
                'title' => $row['title'],
                'excerpt' => $row['excerpt'],
                'featured_image' => $row['featured_image'],
                'featured_image_alt' => $row['featured_image_alt'],
                'author' => $row['author_name'],
                'published_at' => $row['published_at'],
                'category' => $row['category_slug'] === null ? null : [
                    'slug' => $row['category_slug'],
                    'name' => $row['category_name'],
                ],
                'seo_title' => $row['seo_title'],
                'seo_description' => $row['seo_description'],
                'focus_keyword' => $row['focus_keyword'],
                'social_image' => $row['social_image'],
                'view_count' => (int) $row['view_count'],
                'category_seo' => $row['category_seo_title'] === null ? null : [
                    'title' => $row['category_seo_title'],
                    'description' => $row['category_seo_description'],
                ],
                'tags' => $this->tagsFor((int) $row['id']),
            ], $rows),
            'meta' => $this->paginationMeta($total, $page, $perPage),
        ];
    }

    /** @return array<string,mixed>|null */
    public function publicBySlug(string $slug): ?array
    {
        $statement = $this->pdo()->prepare(
            'SELECT b.*, c.slug AS category_slug, c.name AS category_name
               FROM blog_posts b
               LEFT JOIN blog_categories c ON c.id = b.category_id
              WHERE b.slug = :slug AND b.deleted_at IS NULL AND ' . self::PUBLIC_CONDITION . '
              LIMIT 1',
        );
        $statement->execute([':slug' => $slug]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }

        $postId = (int) $row['id'];
        $categoryId = $row['category_id'] !== null ? (int) $row['category_id'] : null;

        return [
            'id' => $postId,
            'slug' => $row['slug'],
            'title' => $row['title'],
            'excerpt' => $row['excerpt'],
            'body' => $row['body'],
            'featured_image' => $row['featured_image'],
            'featured_image_alt' => $row['featured_image_alt'],
            'author' => $row['author_name'],
            'published_at' => $row['published_at'],
            'updated_at' => $row['updated_at'],
            'category' => $row['category_slug'] === null ? null : [
                'slug' => $row['category_slug'],
                'name' => $row['category_name'],
            ],
            'tags' => $this->tagsFor($postId),
            'seo_title' => $row['seo_title'],
            'seo_description' => $row['seo_description'],
            'focus_keyword' => $row['focus_keyword'] ?? null,
            'secondary_keywords' => $row['secondary_keywords'] ?? null,
            'canonical_url' => $row['canonical_url'] ?? null,
            'noindex' => (int) ($row['noindex'] ?? 0),
            'social_image' => $row['social_image'] ?? null,
            'seo_summary' => $row['seo_summary'] ?? null,
            'read_time_minutes' => $this->readTime((string) ($row['body'] ?? '')),
            'metadata' => $this->metadataFor($postId),
            'related' => $this->relatedPosts($categoryId, $postId, 3),
        ];
    }

    /** @return array<int,array<string,mixed>> */
    public function publicCategories(): array
    {
        $sql = 'SELECT c.id, c.slug, c.name, c.description, c.seo_title, c.seo_description,
                       c.noindex, c.sort_order,
                       (SELECT COUNT(*) FROM blog_posts b
                         WHERE b.category_id = c.id AND b.deleted_at IS NULL AND ' . self::PUBLIC_CONDITION . ') AS post_count
                  FROM blog_categories c
                 ORDER BY c.sort_order ASC, c.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'description' => $row['description'],
            'seo_title' => $row['seo_title'],
            'seo_description' => $row['seo_description'],
            'noindex' => (int) $row['noindex'],
            'post_count' => (int) $row['post_count'],
        ], $rows);
    }

    /** @return array<int,array<string,mixed>> */
    public function publicTags(): array
    {
        $sql = 'SELECT t.id, t.slug, t.name,
                       (SELECT COUNT(*) FROM blog_post_tags bpt WHERE bpt.tag_id = t.id) AS post_count
                  FROM blog_tags t
                 ORDER BY t.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'post_count' => (int) $row['post_count'],
        ], $rows);
    }

    /* ------------------------------------------------------------------ */
    /*  Admin reads                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * @param array{status?:string,category?:string,q?:string,include_deleted?:bool} $filters
     * @return array{items:array<int,array<string,mixed>>,meta:array<string,mixed>}
     */
    public function adminList(array $filters, int $page, int $perPage): array
    {
        $conditions = [];
        $params = [];

        if (empty($filters['include_deleted'])) {
            $conditions[] = 'b.deleted_at IS NULL';
        }
        if (!empty($filters['status'])) {
            $conditions[] = 'b.status = :status';
            $params[':status'] = $filters['status'];
        }
        if (!empty($filters['category'])) {
            $conditions[] = ctype_digit((string) $filters['category'])
                ? 'b.category_id = :category'
                : 'c.slug = :category';
            $params[':category'] = $filters['category'];
        }
        if (!empty($filters['q'])) {
            $conditions[] = '(b.title LIKE :q OR b.slug LIKE :q OR b.excerpt LIKE :q)';
            $params[':q'] = '%' . $filters['q'] . '%';
        }

        $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

        $count = $this->pdo()->prepare(
            'SELECT COUNT(*) FROM blog_posts b LEFT JOIN blog_categories c ON c.id = b.category_id' . $where,
        );
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $sql = 'SELECT b.*, c.slug AS category_slug, c.name AS category_name
                  FROM blog_posts b
                  LEFT JOIN blog_categories c ON c.id = b.category_id' . $where
            . ' ORDER BY b.updated_at DESC LIMIT ' . $perPage . ' OFFSET ' . $offset;

        $statement = $this->pdo()->prepare($sql);
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return [
            'items' => array_map(fn (array $row): array => $this->hydrateAdmin($row), $rows),
            'meta' => $this->paginationMeta($total, $page, $perPage),
        ];
    }

    /** @return array<string,mixed> */
    public function adminFind(int $id, bool $withDeleted = false): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT b.*, c.slug AS category_slug, c.name AS category_name
               FROM blog_posts b
               LEFT JOIN blog_categories c ON c.id = b.category_id
              WHERE b.id = :id' . ($withDeleted ? '' : ' AND b.deleted_at IS NULL') . ' LIMIT 1',
        );
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('Post not found.');
        }

        $post = $this->hydrateAdmin($row);
        $post['tag_ids'] = array_map(static fn (array $tag): int => (int) $tag['id'], $this->tagsFor($id));
        $post['metadata'] = $this->metadataFor($id);
        return $post;
    }

    /* ------------------------------------------------------------------ */
    /*  Admin writes                                                       */
    /* ------------------------------------------------------------------ */

    /** @param array<string,mixed> $data */
    public function create(array $data, array $tagIds = []): int
    {
        $payload = $this->prepareWrite($data, true);
        $columns = array_keys($payload);
        $sql = 'INSERT INTO blog_posts (' . implode(', ', array_map(static fn (string $c): string => '`' . $c . '`', $columns)) . ')'
            . ' VALUES (' . implode(', ', array_map(static fn (string $c): string => ':' . $c, $columns)) . ')';
        $statement = $this->pdo()->prepare($sql);
        $statement->execute($this->bindings($payload));

        $id = (int) $this->pdo()->lastInsertId();
        $this->syncTags($id, $tagIds);

        return $id;
    }

    /** @param array<string,mixed> $data */
    public function update(int $id, array $data, ?array $tagIds = null): void
    {
        $payload = $this->prepareWrite($data, false);
        if ($payload !== []) {
            $assignments = array_map(static fn (string $c): string => '`' . $c . '` = :' . $c, array_keys($payload));
            $statement = $this->pdo()->prepare('UPDATE blog_posts SET ' . implode(', ', $assignments) . ' WHERE id = :id');
            $statement->execute($this->bindings($payload) + [':id' => $id]);
        }

        if ($tagIds !== null) {
            $this->syncTags($id, $tagIds);
        }
    }

    /** @param array<int,int|string> $tagIds */
    public function syncTags(int $postId, array $tagIds): void
    {
        $pdo = $this->pdo();
        $delete = $pdo->prepare('DELETE FROM blog_post_tags WHERE post_id = :id');
        $delete->execute([':id' => $postId]);

        if ($tagIds === []) {
            return;
        }

        $insert = $pdo->prepare('INSERT IGNORE INTO blog_post_tags (post_id, tag_id) VALUES (:post_id, :tag_id)');
        foreach (array_unique(array_map('intval', $tagIds)) as $tagId) {
            if ($tagId <= 0) {
                continue;
            }
            $insert->execute([':post_id' => $postId, ':tag_id' => $tagId]);
        }
    }

    /** @return array<int,array<string,mixed>> */
    public function tagsFor(int $postId): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT t.id, t.slug, t.name
               FROM blog_tags t
               INNER JOIN blog_post_tags bpt ON bpt.tag_id = t.id
              WHERE bpt.post_id = :id
              ORDER BY t.name ASC',
        );
        $statement->execute([':id' => $postId]);
        return array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
        ], $statement->fetchAll(PDO::FETCH_ASSOC) ?: []);
    }

    /* ------------------------- taxonomy ------------------------------- */

    /** @return array<int,array<string,mixed>> */
    public function adminCategories(): array
    {
        $sql = 'SELECT c.*, (SELECT COUNT(*) FROM blog_posts b WHERE b.category_id = c.id AND b.deleted_at IS NULL) AS post_count
                  FROM blog_categories c ORDER BY c.sort_order ASC, c.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'description' => $row['description'],
            'seo_title' => $row['seo_title'] ?? null,
            'seo_description' => $row['seo_description'] ?? null,
            'sort_order' => (int) ($row['sort_order'] ?? 0),
            'noindex' => (int) ($row['noindex'] ?? 0),
            'post_count' => (int) $row['post_count'],
        ], $rows);
    }

    /** @param array<string,mixed> $data */
    public function createCategory(array $data): int
    {
        $statement = $this->pdo()->prepare(
            'INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
             VALUES (:slug, :name, :description, :seo_title, :seo_description, :sort_order, :noindex)',
        );
        $statement->execute([
            ':slug' => $data['slug'],
            ':name' => $data['name'],
            ':description' => $data['description'] ?? null,
            ':seo_title' => $data['seo_title'] ?? null,
            ':seo_description' => $data['seo_description'] ?? null,
            ':sort_order' => (int) ($data['sort_order'] ?? 0),
            ':noindex' => !empty($data['noindex']) ? 1 : 0,
        ]);
        return (int) $this->pdo()->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function updateCategory(int $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];
        foreach (['slug', 'name', 'description', 'seo_title', 'seo_description', 'sort_order', 'noindex'] as $column) {
            if (array_key_exists($column, $data)) {
                $fields[] = '`' . $column . '` = :' . $column;
                $bindings[':' . $column] = $data[$column];
            }
        }
        if ($fields === []) {
            return;
        }
        $statement = $this->pdo()->prepare('UPDATE blog_categories SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $statement->execute($bindings);
    }

    public function deleteCategory(int $id): void
    {
        $count = $this->pdo()->prepare('SELECT COUNT(*) FROM blog_posts WHERE category_id = :id AND deleted_at IS NULL');
        $count->execute([':id' => $id]);
        if ((int) $count->fetchColumn() > 0) {
            throw ApiException::conflict('Move the posts in this category first.');
        }
        $statement = $this->pdo()->prepare('DELETE FROM blog_categories WHERE id = :id');
        $statement->execute([':id' => $id]);
    }

    /** @return array<int,array<string,mixed>> */
    public function adminTags(): array
    {
        $sql = 'SELECT t.*, (SELECT COUNT(*) FROM blog_post_tags bpt WHERE bpt.tag_id = t.id) AS post_count
                  FROM blog_tags t ORDER BY t.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'post_count' => (int) $row['post_count'],
        ], $rows);
    }

    /** @param array<string,mixed> $data */
    public function createTag(array $data): int
    {
        $statement = $this->pdo()->prepare('INSERT INTO blog_tags (slug, name) VALUES (:slug, :name)');
        $statement->execute([':slug' => $data['slug'], ':name' => $data['name']]);
        return (int) $this->pdo()->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function updateTag(int $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];
        foreach (['slug', 'name'] as $column) {
            if (array_key_exists($column, $data)) {
                $fields[] = '`' . $column . '` = :' . $column;
                $bindings[':' . $column] = $data[$column];
            }
        }
        if ($fields === []) {
            return;
        }
        $statement = $this->pdo()->prepare('UPDATE blog_tags SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $statement->execute($bindings);
    }

    public function deleteTag(int $id): void
    {
        $statement = $this->pdo()->prepare('DELETE FROM blog_tags WHERE id = :id');
        $statement->execute([':id' => $id]);
    }

    /* ------------------------------------------------------------------ */
    /*  Related content, views and metadata                                */
    /* ------------------------------------------------------------------ */

    /** @return array<int,array<string,mixed>> */
    public function relatedPosts(?int $categoryId, int $excludeId = 0, int $limit = 3): array
    {
        if ($categoryId === null) {
            $statement = $this->pdo()->prepare(
                'SELECT b.slug, b.title, b.excerpt, b.featured_image, b.featured_image_alt, b.published_at,
                        c.slug AS category_slug, c.name AS category_name
                   FROM blog_posts b
                   LEFT JOIN blog_categories c ON c.id = b.category_id
                  WHERE b.id <> :exclude AND b.deleted_at IS NULL AND ' . self::PUBLIC_CONDITION . '
                  ORDER BY b.published_at DESC, b.id DESC
                  LIMIT ' . max(1, min(9, $limit)),
            );
            $statement->execute([':exclude' => $excludeId]);
        } else {
            $statement = $this->pdo()->prepare(
                'SELECT b.slug, b.title, b.excerpt, b.featured_image, b.featured_image_alt, b.published_at,
                        c.slug AS category_slug, c.name AS category_name
                   FROM blog_posts b
                   LEFT JOIN blog_categories c ON c.id = b.category_id
                  WHERE b.id <> :exclude AND b.deleted_at IS NULL AND ' . self::PUBLIC_CONDITION . '
                  ORDER BY (b.category_id = :category) DESC, b.published_at DESC, b.id DESC
                  LIMIT ' . max(1, min(9, $limit)),
            );
            $statement->execute([':exclude' => $excludeId, ':category' => $categoryId]);
        }

        return array_map(static fn (array $row): array => [
            'slug' => $row['slug'],
            'title' => $row['title'],
            'excerpt' => $row['excerpt'],
            'featured_image' => $row['featured_image'],
            'featured_image_alt' => $row['featured_image_alt'],
            'published_at' => $row['published_at'],
            'category' => $row['category_slug'] === null ? null : [
                'slug' => $row['category_slug'],
                'name' => $row['category_name'],
            ],
        ], $statement->fetchAll(PDO::FETCH_ASSOC) ?: []);
    }

    /** @return array<string,mixed>|null */
    public function publicCategoryBySlug(string $slug): ?array
    {
        $statement = $this->pdo()->prepare(
            'SELECT c.id, c.slug, c.name, c.description, c.seo_title, c.seo_description, c.noindex,
                    (SELECT COUNT(*) FROM blog_posts b WHERE b.category_id = c.id AND b.deleted_at IS NULL AND ' . self::PUBLIC_CONDITION . ') AS post_count
               FROM blog_categories c WHERE c.slug = :slug LIMIT 1',
        );
        $statement->execute([':slug' => $slug]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }

        return [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'description' => $row['description'],
            'seo_title' => $row['seo_title'],
            'seo_description' => $row['seo_description'],
            'noindex' => (int) $row['noindex'],
            'post_count' => (int) $row['post_count'],
        ];
    }

    /** True when another post already uses this slug (deleted rows included). */
    public function slugTaken(string $slug, int $ignoreId = 0): bool
    {
        $statement = $this->pdo()->prepare('SELECT COUNT(*) FROM blog_posts WHERE slug = :slug AND id <> :id');
        $statement->execute([':slug' => $slug, ':id' => $ignoreId]);
        return (int) $statement->fetchColumn() > 0;
    }

    public function incrementView(int $postId): void
    {
        $statement = $this->pdo()->prepare('UPDATE blog_posts SET view_count = view_count + 1 WHERE id = :id');
        $statement->execute([':id' => $postId]);
    }

    /** Estimated reading time in minutes, from the rendered body. */
    public function readTime(string $html): int
    {
        $text = trim(preg_replace('/\s+/', ' ', strip_tags($html)) ?? '');
        $words = $text === '' ? 1 : count(explode(' ', $text));
        return max(1, (int) round($words / 220));
    }

    /** @return array<string,string> */
    public function metadataFor(int $postId): array
    {
        $statement = $this->pdo()->prepare('SELECT meta_key, meta_value FROM blog_post_metadata WHERE post_id = :id');
        $statement->execute([':id' => $postId]);
        $out = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $out[(string) $row['meta_key']] = (string) ($row['meta_value'] ?? '');
        }
        return $out;
    }

    /** @param array<string,mixed> $metadata */
    public function syncMetadata(int $postId, array $metadata): void
    {
        $delete = $this->pdo()->prepare('DELETE FROM blog_post_metadata WHERE post_id = :id AND meta_key = :key');
        $upsert = $this->pdo()->prepare(
            'INSERT INTO blog_post_metadata (post_id, meta_key, meta_value) VALUES (:id, :key, :value)
             ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)',
        );

        foreach ($metadata as $key => $value) {
            if (!in_array($key, self::METADATA_KEYS, true)) {
                continue;
            }
            if ($value === null || $value === '') {
                $delete->execute([':id' => $postId, ':key' => $key]);
                continue;
            }
            $upsert->execute([
                ':id' => $postId,
                ':key' => $key,
                ':value' => mb_substr((string) $value, 0, 2000),
            ]);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Scheduling                                                         */
    /* ------------------------------------------------------------------ */

    /** @return array<int,array<string,mixed>> */
    public function dueScheduled(int $limit = 50): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT id, slug, title, scheduled_at FROM blog_posts
              WHERE status = "scheduled" AND deleted_at IS NULL
                AND scheduled_at IS NOT NULL AND scheduled_at <= UTC_TIMESTAMP()
              ORDER BY scheduled_at ASC
              LIMIT ' . max(1, min(200, $limit)),
        );
        $statement->execute();
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * Publishes one scheduled post. Returns true only for the call that
     * actually performed the transition, so a double cron run cannot publish
     * (or log) the same post twice.
     */
    public function publishScheduled(int $postId): bool
    {
        $statement = $this->pdo()->prepare(
            'UPDATE blog_posts
                SET status = "published", published_at = UTC_TIMESTAMP()
              WHERE id = :id AND status = "scheduled" AND deleted_at IS NULL
                AND scheduled_at IS NOT NULL AND scheduled_at <= UTC_TIMESTAMP()',
        );
        $statement->execute([':id' => $postId]);
        return $statement->rowCount() === 1;
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    /** @param array<string,mixed> $row */
    private function hydrateAdmin(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'title' => $row['title'],
            'category_id' => $row['category_id'] !== null ? (int) $row['category_id'] : null,
            'category_slug' => $row['category_slug'] ?? null,
            'category_name' => $row['category_name'] ?? null,
            'status' => $row['status'],
            'excerpt' => $row['excerpt'],
            'body' => $row['body'],
            'featured_image' => $row['featured_image'],
            'featured_image_alt' => $row['featured_image_alt'],
            'seo_title' => $row['seo_title'],
            'seo_description' => $row['seo_description'],
            'seo_summary' => $row['seo_summary'] ?? null,
            'focus_keyword' => $row['focus_keyword'] ?? null,
            'secondary_keywords' => $row['secondary_keywords'] ?? null,
            'canonical_url' => $row['canonical_url'] ?? null,
            'noindex' => (int) ($row['noindex'] ?? 0),
            'social_image' => $row['social_image'] ?? null,
            'view_count' => (int) ($row['view_count'] ?? 0),
            'scheduled_at' => $row['scheduled_at'] ?? null,
            'author' => $row['author_name'],
            'published_at' => $row['published_at'],
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
            'deleted_at' => $row['deleted_at'],
            'read_time_minutes' => $this->readTime((string) ($row['body'] ?? '')),
            'tags' => $this->tagsFor((int) $row['id']),
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
            if ($column === 'category_id') {
                $value = $value === null || $value === '' ? null : (int) $value;
            }
            if ($value === '' && $column !== 'body' && $column !== 'excerpt') {
                $value = null;
            }
            $payload[$column] = $value;
        }

        if ($isCreate) {
            $payload += [
                'status' => 'draft',
                'author_name' => $payload['author_name'] ?? 'Editorial team',
            ];
        }

        if (array_key_exists('noindex', $payload)) {
            $payload['noindex'] = $payload['noindex'] ? 1 : 0;
        }

        if (($payload['status'] ?? null) === 'published' && empty($payload['published_at'])) {
            $payload['published_at'] = gmdate('Y-m-d H:i:s');
        }

        // Scheduling uses scheduled_at (UTC). Accept published_at as a fallback
        // so older clients keep working.
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
