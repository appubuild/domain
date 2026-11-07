<?php
/**
 * Site-wide SEO defaults (single row, id = 1).
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;
use Shn\Helpers\Security;

final class SeoModel extends BaseModel
{
    protected string $table = 'seo_settings';
    protected bool $softDeletes = false;

    /** @return array<string,mixed> */
    public function current(): array
    {
        $statement = $this->pdo()->query('SELECT * FROM seo_settings WHERE id = 1 LIMIT 1');
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('SEO settings have not been initialised.');
        }
        return $this->hydrate($row);
    }

    /** Public subset — no verification tokens, no internal fields. */
    /** @return array<string,mixed> */
    public function publicView(): array
    {
        $row = $this->current();
        return [
            'default_title' => $row['default_title'],
            'title_template' => $row['title_template'],
            'default_description' => $row['default_description'],
            'robots' => $row['robots'],
            'canonical_base' => $row['canonical_base'],
            'og_image' => $row['og_image'],
            'sitemap_enabled' => $row['sitemap_enabled'],
            'keywords' => $row['keywords'],
        ];
    }

    /** @param array<string,mixed> $data */
    public function update(array $data, ?int $adminId): void
    {
        $fields = [];
        $bindings = [':updated_by' => $adminId];

        foreach (['default_title', 'title_template', 'default_description', 'robots', 'canonical_base', 'og_image', 'google_verification', 'analytics_id'] as $column) {
            if (!array_key_exists($column, $data)) {
                continue;
            }
            $value = $data[$column] === '' ? null : $data[$column];
            if ($column === 'analytics_id' && $value !== null && !Security::isValidMeasurementId((string) $value)) {
                throw ApiException::unprocessable('Use a GA4 (G-XXXXXXX) or GTM (GTM-XXXXXX) id.', ['analytics_id' => 'Invalid measurement id.']);
            }
            if ($column === 'og_image' && $value !== null && !Security::isSafeUrl((string) $value)) {
                throw ApiException::unprocessable('Use a relative image path or a full https URL.', ['og_image' => 'Invalid image path.']);
            }
            $fields[] = '`' . $column . '` = :' . $column;
            $bindings[':' . $column] = $value;
        }

        if (array_key_exists('keywords', $data)) {
            $keywords = $data['keywords'];
            if (is_string($keywords)) {
                $keywords = array_values(array_filter(array_map('trim', explode(',', $keywords))));
            }
            if (!is_array($keywords)) {
                throw ApiException::unprocessable('Keywords must be a list.');
            }
            $fields[] = '`keywords` = :keywords';
            $bindings[':keywords'] = json_encode(array_values($keywords), JSON_UNESCAPED_UNICODE);
        }

        if (array_key_exists('sitemap_enabled', $data)) {
            $fields[] = '`sitemap_enabled` = :sitemap_enabled';
            $bindings[':sitemap_enabled'] = !empty($data['sitemap_enabled']) ? 1 : 0;
        }

        if ($fields === []) {
            return;
        }

        $statement = $this->pdo()->prepare(
            'UPDATE seo_settings SET ' . implode(', ', $fields) . ', updated_by = :updated_by WHERE id = 1',
        );
        $statement->execute($bindings);
    }

    /** @param array<string,mixed> $row */
    private function hydrate(array $row): array
    {
        return [
            'default_title' => $row['default_title'],
            'title_template' => $row['title_template'],
            'default_description' => $row['default_description'],
            'keywords' => self::decodeJsonList($row['keywords']),
            'robots' => $row['robots'],
            'sitemap_enabled' => (int) $row['sitemap_enabled'] === 1,
            'canonical_base' => $row['canonical_base'],
            'og_image' => $row['og_image'],
            'google_verification' => $row['google_verification'],
            'analytics_id' => $row['analytics_id'],
            'updated_at' => $row['updated_at'],
        ];
    }
}
