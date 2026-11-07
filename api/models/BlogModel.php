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
        'author_name', 'published_at',
    ];

    private const PUBLIC_CONDITION = '(b.status = "published" OR (b.status = "scheduled" AND b.published_at IS NOT NULL AND b.published_at <= UTC_TIMESTAMP()))';

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
                       c.slug AS category_slug, c.name AS category_name
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

        return [
            'id' => (int) $row['id'],
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
            'tags' => $this->tagsFor((int) $row['id']),
            'seo_title' => $row['seo_title'],
            'seo_description' => $row['seo_description'],
        ];
    }

    /** @return array<int,array<string,mixed>> */
    public function publicCategories(): array
    {
        $sql = 'SELECT c.id, c.slug, c.name, c.description,
                       (SELECT COUNT(*) FROM blog_posts b
                         WHERE b.category_id = c.id AND b.deleted_at IS NULL AND ' . self::PUBLIC_CONDITION . ') AS post_count
                  FROM blog_categories c
                 ORDER BY c.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'description' => $row['description'],
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
                  FROM blog_categories c ORDER BY c.name ASC';
        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'description' => $row['description'],
            'post_count' => (int) $row['post_count'],
        ], $rows);
    }

    /** @param array<string,mixed> $data */
    public function createCategory(array $data): int
    {
        $statement = $this->pdo()->prepare(
            'INSERT INTO blog_categories (slug, name, description) VALUES (:slug, :name, :description)',
        );
        $statement->execute([
            ':slug' => $data['slug'],
            ':name' => $data['name'],
            ':description' => $data['description'] ?? null,
        ]);
        return (int) $this->pdo()->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function updateCategory(int $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];
        foreach (['slug', 'name', 'description'] as $column) {
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
            'author' => $row['author_name'],
            'published_at' => $row['published_at'],
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
            'deleted_at' => $row['deleted_at'],
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

        if (($payload['status'] ?? null) === 'published' && empty($payload['published_at'])) {
            $payload['published_at'] = gmdate('Y-m-d H:i:s');
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
