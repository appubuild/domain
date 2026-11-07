<?php
/**
 * Services (trades) and their published phone groups.
 *
 * Public reads never return internal notes, operator names, campaign data or
 * non-active numbers. Admin reads return everything.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;

final class ServiceModel extends BaseModel
{
    protected string $table = 'services';

    private const JSON_COLUMNS = ['intro', 'common_needs', 'options', 'faqs', 'related', 'search_terms'];

    private const WRITABLE = [
        'slug', 'name', 'short_name', 'category_id', 'niche_id', 'icon', 'image', 'featured',
        'status', 'sort_order', 'hero_headline', 'hero_subheadline', 'short_description',
        'intro', 'common_needs', 'options', 'process_note', 'faqs', 'related', 'search_terms',
        'meta_title', 'meta_description',
    ];

    /* ------------------------------------------------------------------ */
    /*  Public reads                                                       */
    /* ------------------------------------------------------------------ */

    /** @return array<int,array<string,mixed>> */
    public function publishedList(): array
    {
        $sql = 'SELECT s.id, s.slug, s.name, s.short_name, s.category_id, s.niche_id, s.icon, s.image,
                       s.featured, s.hero_headline, s.hero_subheadline, s.short_description,
                       s.meta_title, s.meta_description, s.sort_order,
                       c.name AS category_name, n.name AS niche_name, n.slug AS niche_slug,
                       (SELECT COUNT(*) FROM service_phone_groups spg WHERE spg.service_id = s.id) AS phone_group_count
                  FROM services s
                  LEFT JOIN service_categories c ON c.id = s.category_id
                  LEFT JOIN niches n ON n.id = s.niche_id
                 WHERE s.deleted_at IS NULL AND s.status = "published"
                 ORDER BY s.sort_order ASC, s.name ASC';

        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(static function (array $row): array {
            return [
                'id' => (int) $row['id'],
                'slug' => $row['slug'],
                'name' => $row['name'],
                'short_name' => $row['short_name'],
                'category' => $row['category_id'] === null ? null : [
                    'id' => $row['category_id'],
                    'name' => $row['category_name'],
                ],
                'niche' => $row['niche_id'] === null ? null : [
                    'slug' => $row['niche_slug'],
                    'name' => $row['niche_name'],
                ],
                'icon' => $row['icon'],
                'image' => $row['image'],
                'featured' => (int) $row['featured'] === 1,
                'hero_headline' => $row['hero_headline'],
                'hero_subheadline' => $row['hero_subheadline'],
                'short_description' => $row['short_description'],
                'meta_title' => $row['meta_title'],
                'meta_description' => $row['meta_description'],
                'phone_group_count' => (int) $row['phone_group_count'],
            ];
        }, $rows);
    }

    /** Full published service by slug, including active phone numbers. */
    /** @return array<string,mixed>|null */
    public function publishedDetail(string $slug): ?array
    {
        $statement = $this->pdo()->prepare(
            'SELECT s.*, c.name AS category_name, n.name AS niche_name
               FROM services s
               LEFT JOIN service_categories c ON c.id = s.category_id
               LEFT JOIN niches n ON n.id = s.niche_id
              WHERE s.slug = :slug AND s.deleted_at IS NULL AND s.status = "published"
              LIMIT 1',
        );
        $statement->execute([':slug' => $slug]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }

        $service = [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'short_name' => $row['short_name'],
            'category' => $row['category_id'] === null ? null : [
                'id' => $row['category_id'],
                'name' => $row['category_name'],
            ],
            'niche' => $row['niche_id'] === null ? null : [
                'slug' => $row['niche_slug'] ?? null,
                'name' => $row['niche_name'],
            ],
            'icon' => $row['icon'],
            'image' => $row['image'],
            'featured' => (int) $row['featured'] === 1,
            'hero_headline' => $row['hero_headline'],
            'hero_subheadline' => $row['hero_subheadline'],
            'short_description' => $row['short_description'],
            'intro' => self::decodeJsonList($row['intro']),
            'common_needs' => self::decodeJsonList($row['common_needs']),
            'options' => self::decodeJsonList($row['options']),
            'process_note' => $row['process_note'],
            'faqs' => self::decodeJsonList($row['faqs']),
            'related' => self::decodeJsonList($row['related']),
            'search_terms' => self::decodeJsonList($row['search_terms']),
            'meta_title' => $row['meta_title'],
            'meta_description' => $row['meta_description'],
            'updated_at' => $row['updated_at'],
            'phone_groups' => $this->publicGroups((int) $row['id']),
        ];

        return $service;
    }

    /**
     * Active, authorised numbers for a service, grouped for the call panel.
     * Services with no mapped group return an empty array — the site must then
     * show a contact message instead of another trade's number.
     *
     * @return array<int,array<string,mixed>>
     */
    public function publicGroups(int $serviceId): array
    {
        return $this->publicGroupsForServices([$serviceId])[$serviceId] ?? [];
    }

    /**
     * Full published payloads for every service, in two queries.
     * Used by the public site so one request hydrates the whole directory.
     *
     * @return array<int,array<string,mixed>>
     */
    public function publishedDetails(): array
    {
        $sql = 'SELECT s.*, c.name AS category_name, n.name AS niche_name, n.slug AS niche_slug
                  FROM services s
                  LEFT JOIN service_categories c ON c.id = s.category_id
                  LEFT JOIN niches n ON n.id = s.niche_id
                 WHERE s.deleted_at IS NULL AND s.status = "published"
                 ORDER BY s.sort_order ASC, s.name ASC';

        $rows = $this->pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
        if ($rows === []) {
            return [];
        }

        $ids = array_map(static fn (array $row): int => (int) $row['id'], $rows);
        $groups = $this->publicGroupsForServices($ids);

        return array_map(function (array $row) use ($groups): array {
            $id = (int) $row['id'];

            return [
                'id' => $id,
                'slug' => $row['slug'],
                'name' => $row['name'],
                'short_name' => $row['short_name'],
                'category' => $row['category_id'] === null ? null : [
                    'id' => $row['category_id'],
                    'name' => $row['category_name'],
                ],
                'niche' => $row['niche_id'] === null ? null : [
                    'slug' => $row['niche_slug'],
                    'name' => $row['niche_name'],
                ],
                'icon' => $row['icon'],
                'image' => $row['image'],
                'featured' => (int) $row['featured'] === 1,
                'hero_headline' => $row['hero_headline'],
                'hero_subheadline' => $row['hero_subheadline'],
                'short_description' => $row['short_description'],
                'intro' => self::decodeJsonList($row['intro']),
                'common_needs' => self::decodeJsonList($row['common_needs']),
                'options' => self::decodeJsonList($row['options']),
                'process_note' => $row['process_note'],
                'faqs' => self::decodeJsonList($row['faqs']),
                'related' => self::decodeJsonList($row['related']),
                'search_terms' => self::decodeJsonList($row['search_terms']),
                'meta_title' => $row['meta_title'],
                'meta_description' => $row['meta_description'],
                'updated_at' => $row['updated_at'],
                'phone_groups' => $groups[$id] ?? [],
            ];
        }, $rows);
    }

    /**
     * Active, authorised numbers for a set of services, grouped for the call
     * panel. Services with no mapped group are absent from the result — the site
     * must then show a contact message instead of another trade's number.
     *
     * @param array<int,int> $serviceIds
     * @return array<int,array<int,array<string,mixed>>>
     */
    public function publicGroupsForServices(array $serviceIds): array
    {
        $serviceIds = array_values(array_filter(array_map('intval', $serviceIds)));
        if ($serviceIds === []) {
            return [];
        }

        $placeholders = implode(', ', array_fill(0, count($serviceIds), '?'));

        $sql = 'SELECT spg.service_id, spg.position AS group_position,
                       g.id AS group_id, g.name AS group_name, g.label AS group_label,
                       g.blurb AS group_blurb, g.icon AS group_icon,
                       p.id AS number_id, p.external_id, p.number, p.label AS number_label, p.priority
                  FROM service_phone_groups spg
                  INNER JOIN phone_groups g ON g.id = spg.group_id
                  LEFT JOIN phone_numbers p
                         ON p.group_id = g.id
                        AND p.deleted_at IS NULL
                        AND p.status = "active"
                 WHERE spg.service_id IN (' . $placeholders . ')
                 ORDER BY spg.service_id ASC, spg.position ASC, g.name ASC, p.priority ASC, p.id ASC';

        $statement = $this->pdo()->prepare($sql);
        $statement->execute($serviceIds);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $result = [];
        foreach ($rows as $row) {
            $serviceId = (int) $row['service_id'];
            $groupId = (string) $row['group_id'];

            $result[$serviceId][$groupId] ??= [
                'id' => $groupId,
                'name' => $row['group_name'],
                'label' => $row['group_label'],
                'blurb' => $row['group_blurb'],
                'icon' => $row['group_icon'],
                'numbers' => [],
            ];

            if ($row['number_id'] !== null) {
                $result[$serviceId][$groupId]['numbers'][] = [
                    'id' => (int) $row['number_id'],
                    'external_id' => $row['external_id'],
                    'number' => $row['number'],
                    'label' => $row['number_label'],
                    'priority' => (int) $row['priority'],
                    'priority_label' => (int) $row['priority'] === 1 ? 'Call Now' : 'Call Alternate',
                    'tel' => 'tel:+1' . preg_replace('/\D+/', '', (string) $row['number']),
                ];
            }
        }

        // Drop groups with no active number so the UI never shows an empty panel.
        return array_map(
            static fn (array $groups): array => array_values(array_filter(
                $groups,
                static fn (array $group): bool => $group['numbers'] !== [],
            )),
            $result,
        );
    }

    /** @return array<int,array<string,mixed>> */
    public function publishedCategories(): array
    {
        $sql = 'SELECT c.id, c.name, c.description, c.sort_order,
                       (SELECT COUNT(*) FROM services s
                         WHERE s.category_id = c.id AND s.deleted_at IS NULL AND s.status = "published") AS service_count
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

    /* ------------------------------------------------------------------ */
    /*  Admin reads                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * @param array{status?:string,category?:string,niche?:string,q?:string,include_deleted?:bool} $filters
     * @return array{items:array<int,array<string,mixed>>,meta:array<string,mixed>}
     */
    public function adminList(array $filters, int $page, int $perPage): array
    {
        $conditions = [];
        $params = [];

        if (empty($filters['include_deleted'])) {
            $conditions[] = 's.deleted_at IS NULL';
        }
        if (!empty($filters['status'])) {
            $conditions[] = 's.status = :status';
            $params[':status'] = $filters['status'];
        }
        if (!empty($filters['category'])) {
            $conditions[] = 's.category_id = :category';
            $params[':category'] = $filters['category'];
        }
        if (!empty($filters['niche'])) {
            if (ctype_digit((string) $filters['niche'])) {
                $conditions[] = 's.niche_id = :niche';
                $params[':niche'] = (int) $filters['niche'];
            } else {
                $conditions[] = 'n.slug = :niche_slug';
                $params[':niche_slug'] = $filters['niche'];
            }
        }
        if (!empty($filters['q'])) {
            $conditions[] = '(s.name LIKE :q OR s.slug LIKE :q OR s.short_description LIKE :q)';
            $params[':q'] = '%' . $filters['q'] . '%';
        }

        $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

        $countSql = 'SELECT COUNT(*) FROM services s LEFT JOIN niches n ON n.id = s.niche_id' . $where;
        $countStatement = $this->pdo()->prepare($countSql);
        $countStatement->execute($params);
        $total = (int) $countStatement->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $sql = 'SELECT s.*, c.name AS category_name, n.name AS niche_name, n.slug AS niche_slug
                  FROM services s
                  LEFT JOIN service_categories c ON c.id = s.category_id
                  LEFT JOIN niches n ON n.id = s.niche_id'
            . $where
            . ' ORDER BY s.sort_order ASC, s.name ASC LIMIT ' . $perPage . ' OFFSET ' . $offset;

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
        $sql = 'SELECT s.*, c.name AS category_name, n.name AS niche_name, n.slug AS niche_slug
                  FROM services s
                  LEFT JOIN service_categories c ON c.id = s.category_id
                  LEFT JOIN niches n ON n.id = s.niche_id
                 WHERE s.id = :id' . ($withDeleted ? '' : ' AND s.deleted_at IS NULL') . ' LIMIT 1';
        $statement = $this->pdo()->prepare($sql);
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('Service not found.');
        }

        $service = $this->hydrateAdmin($row);
        $service['phone_group_ids'] = $this->groupIdsFor($id);
        return $service;
    }

    /* ------------------------------------------------------------------ */
    /*  Admin writes                                                       */
    /* ------------------------------------------------------------------ */

    /** @param array<string,mixed> $data */
    public function create(array $data): int
    {
        $payload = $this->prepareWrite($data, true);

        $columns = array_keys($payload);
        $placeholders = array_map(static fn (string $column): string => ':' . $column, $columns);

        $sql = 'INSERT INTO services (' . implode(', ', array_map(static fn (string $c): string => '`' . $c . '`', $columns)) . ')'
            . ' VALUES (' . implode(', ', $placeholders) . ')';

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

        $assignments = array_map(static fn (string $column): string => '`' . $column . '` = :' . $column, array_keys($payload));
        $sql = 'UPDATE services SET ' . implode(', ', $assignments) . ' WHERE id = :id AND deleted_at IS NULL';

        $statement = $this->pdo()->prepare($sql);
        $statement->execute($this->bindings($payload) + [':id' => $id]);
    }

    /** @param array<int,string> $groupIds */
    public function syncGroups(int $serviceId, array $groupIds): void
    {
        $pdo = $this->pdo();

        // Validate the group ids first so a typo cannot silently drop a mapping.
        $groupIds = array_values(array_unique(array_map('strval', $groupIds)));
        if ($groupIds !== []) {
            $placeholders = implode(', ', array_fill(0, count($groupIds), '?'));
            $check = $pdo->prepare('SELECT id FROM phone_groups WHERE id IN (' . $placeholders . ')');
            $check->execute($groupIds);
            $found = array_map('strval', $check->fetchAll(PDO::FETCH_COLUMN) ?: []);
            $missing = array_values(array_diff($groupIds, $found));
            if ($missing !== []) {
                throw ApiException::unprocessable('Unknown phone group(s).', ['phone_group_ids' => implode(', ', $missing)]);
            }
        }

        $pdo->beginTransaction();
        try {
            $delete = $pdo->prepare('DELETE FROM service_phone_groups WHERE service_id = :id');
            $delete->execute([':id' => $serviceId]);

            $insert = $pdo->prepare(
                'INSERT INTO service_phone_groups (service_id, group_id, position) VALUES (:service_id, :group_id, :position)',
            );
            foreach ($groupIds as $index => $groupId) {
                $insert->execute([
                    ':service_id' => $serviceId,
                    ':group_id' => $groupId,
                    ':position' => $index + 1,
                ]);
            }
            $pdo->commit();
        } catch (\Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    /** @return array<int,string> */
    public function groupIdsFor(int $serviceId): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT group_id FROM service_phone_groups WHERE service_id = :id ORDER BY position ASC',
        );
        $statement->execute([':id' => $serviceId]);
        return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN) ?: []);
    }

    /* ------------------------------------------------------------------ */
    /*  Hydration helpers                                                  */
    /* ------------------------------------------------------------------ */

    /** @param array<string,mixed> $row */
    private function hydrateAdmin(array $row): array
    {
        $service = [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'short_name' => $row['short_name'],
            'category_id' => $row['category_id'],
            'category_name' => $row['category_name'] ?? null,
            'niche_id' => $row['niche_id'] !== null ? (int) $row['niche_id'] : null,
            'niche_name' => $row['niche_name'] ?? null,
            'niche_slug' => $row['niche_slug'] ?? null,
            'icon' => $row['icon'],
            'image' => $row['image'],
            'featured' => (int) $row['featured'] === 1,
            'status' => $row['status'],
            'sort_order' => (int) $row['sort_order'],
            'hero_headline' => $row['hero_headline'],
            'hero_subheadline' => $row['hero_subheadline'],
            'short_description' => $row['short_description'],
            'intro' => self::decodeJsonList($row['intro']),
            'common_needs' => self::decodeJsonList($row['common_needs']),
            'options' => self::decodeJsonList($row['options']),
            'process_note' => $row['process_note'],
            'faqs' => self::decodeJsonList($row['faqs']),
            'related' => self::decodeJsonList($row['related']),
            'search_terms' => self::decodeJsonList($row['search_terms']),
            'meta_title' => $row['meta_title'],
            'meta_description' => $row['meta_description'],
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
            'deleted_at' => $row['deleted_at'],
        ];

        return $service;
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

            if (in_array($column, self::JSON_COLUMNS, true)) {
                $value = self::encodeJson($value);
            } elseif ($column === 'featured') {
                $value = $value ? 1 : 0;
            } elseif ($column === 'sort_order') {
                $value = (int) $value;
            } elseif ($column === 'niche_id') {
                $value = $value === null || $value === '' ? null : (int) $value;
            }

            $payload[$column] = $value;
        }

        if ($isCreate) {
            $payload += [
                'status' => $payload['status'] ?? 'draft',
                'icon' => $payload['icon'] ?? 'Wrench',
                'featured' => $payload['featured'] ?? 0,
                'sort_order' => $payload['sort_order'] ?? 0,
            ];
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
