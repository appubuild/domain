<?php
/**
 * Site settings.
 *
 * Only settings flagged `is_public` are exposed through the public endpoint.
 * Tracking / verification snippets are stored separately and are re-validated
 * on the way out, so a hand-edited database row cannot inject arbitrary script.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;
use Shn\Helpers\Config;
use Shn\Helpers\Security;

final class SettingModel extends BaseModel
{
    protected string $table = 'settings';
    protected bool $softDeletes = false;

    /** key => [group, type, public] — the settings the admin UI may edit. */
    public const DEFINITIONS = [
        'site_name' => ['general', 'string', true],
        'site_short_name' => ['general', 'string', true],
        'legal_name' => ['general', 'string', true],
        'domain' => ['general', 'string', true],
        'site_url' => ['general', 'string', true],
        'tagline' => ['general', 'string', true],
        'description' => ['general', 'text', true],
        'model_statement' => ['general', 'text', true],
        'logo_path' => ['appearance', 'string', true],
        'favicon_path' => ['appearance', 'string', true],
        'contact_phone' => ['contact', 'string', true],
        'contact_phone_display' => ['contact', 'string', true],
        'contact_email' => ['contact', 'string', true],
        'support_hours' => ['contact', 'string', true],
        'response_time' => ['contact', 'text', true],
        'address_lines' => ['contact', 'json', true],
        'social_facebook' => ['social', 'string', true],
        'social_instagram' => ['social', 'string', true],
        'social_linkedin' => ['social', 'string', true],
        'social_x' => ['social', 'string', true],
        'social_youtube' => ['social', 'string', true],
        'analytics_id' => ['integrations', 'string', false],
        'google_verification' => ['integrations', 'string', false],
        'header_scripts' => ['integrations', 'script', false],
        'footer_scripts' => ['integrations', 'script', false],
        'maintenance_mode' => ['operations', 'bool', false],
        'lead_notifications' => ['operations', 'bool', false],
        'call_tracking_enabled' => ['operations', 'bool', false],
        'lead_notification_email' => ['operations', 'string', false],
        'sitemap_enabled' => ['seo', 'bool', true],
        'timezone' => ['general', 'string', true],
        'currency' => ['general', 'string', true],
        'api_version' => ['general', 'string', false],
    ];

    /** @return array<string,mixed> */
    public function publicSettings(): array
    {
        $statement = $this->pdo()->query(
            'SELECT setting_key, setting_value, setting_type FROM settings WHERE is_public = 1 ORDER BY setting_key ASC',
        );
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $settings = [];
        foreach ($rows as $row) {
            $settings[(string) $row['setting_key']] = $this->castValue((string) $row['setting_value'], (string) $row['setting_type']);
        }
        return $settings;
    }

    /**
     * Tracking + verification configuration for the public site.
     * Snippets are re-validated before they are returned.
     *
     * @return array<string,mixed>
     */
    public function publicIntegrations(): array
    {
        $statement = $this->pdo()->query(
            'SELECT setting_key, setting_value FROM settings
              WHERE setting_key IN ("analytics_id", "google_verification", "header_scripts", "footer_scripts", "maintenance_mode", "sitemap_enabled")',
        );
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $map = [];
        foreach ($rows as $row) {
            $map[(string) $row['setting_key']] = (string) ($row['setting_value'] ?? '');
        }

        $header = Security::validateSnippet($map['header_scripts'] ?? '', 'header');
        $footer = Security::validateSnippet($map['footer_scripts'] ?? '', 'footer');

        return [
            'analytics_id' => ($map['analytics_id'] ?? '') !== '' ? $map['analytics_id'] : null,
            'google_verification' => ($map['google_verification'] ?? '') !== '' ? $map['google_verification'] : null,
            'header_scripts' => $header['ok'] ? ($header['clean'] ?: null) : null,
            'footer_scripts' => $footer['ok'] ? ($footer['clean'] ?: null) : null,
            'scripts_valid' => $header['ok'] && $footer['ok'],
            'maintenance_mode' => ($map['maintenance_mode'] ?? '0') === '1',
            'sitemap_enabled' => ($map['sitemap_enabled'] ?? '1') === '1',
        ];
    }

    /** @return array<string,mixed> */
    public function get(string $key, mixed $default = null): mixed
    {
        $statement = $this->pdo()->prepare('SELECT setting_value, setting_type FROM settings WHERE setting_key = :key LIMIT 1');
        $statement->execute([':key' => $key]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return $default;
        }
        return $this->castValue((string) $row['setting_value'], (string) $row['setting_type']);
    }

    /** @return array<int,array<string,mixed>> grouped for the admin UI */
    public function adminAll(): array
    {
        $rows = $this->pdo()->query('SELECT setting_key, setting_group, setting_value, setting_type, is_public, updated_at FROM settings ORDER BY setting_group ASC, setting_key ASC')
            ->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $groups = [];
        foreach ($rows as $row) {
            $group = (string) $row['setting_group'];
            $groups[$group][] = [
                'key' => $row['setting_key'],
                'group' => $group,
                'value' => $this->castValue((string) $row['setting_value'], (string) $row['setting_type']),
                'raw_value' => $row['setting_value'],
                'type' => $row['setting_type'],
                'is_public' => (int) $row['is_public'] === 1,
                'editable' => isset(self::DEFINITIONS[(string) $row['setting_key']]),
                'updated_at' => $row['updated_at'],
            ];
        }

        return $groups;
    }

    /**
     * Updates a set of settings after validating each value.
     *
     * @param array<string,mixed> $values key => value
     * @return array<int,string> updated keys
     */
    public function updateMany(array $values, ?int $adminId): array
    {
        $errors = [];
        $updates = [];

        foreach ($values as $key => $value) {
            if (!isset(self::DEFINITIONS[$key])) {
                $errors[$key] = 'This setting cannot be edited through the API.';
                continue;
            }

            [$group, $type] = self::DEFINITIONS[$key];

            try {
                $normalised = $this->normaliseValue($key, $type, $value);
            } catch (ApiException $exception) {
                $errors[$key] = $exception->getMessage();
                continue;
            }

            $updates[] = ['key' => (string) $key, 'value' => $normalised, 'group' => $group, 'type' => $type];
        }

        if ($errors !== []) {
            throw ApiException::unprocessable('Some settings are invalid.', $errors);
        }

        if ($updates === []) {
            return [];
        }

        $statement = $this->pdo()->prepare(
            'UPDATE settings SET setting_value = :value, updated_by = :admin WHERE setting_key = :key',
        );

        $pdo = $this->pdo();
        $pdo->beginTransaction();
        try {
            foreach ($updates as $update) {
                $statement->execute([
                    ':value' => $update['value'],
                    ':admin' => $adminId,
                    ':key' => $update['key'],
                ]);
            }
            $pdo->commit();
        } catch (\Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }

        return array_column($updates, 'key');
    }

    private function normaliseValue(string $key, string $type, mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        switch ($type) {
            case 'bool':
                $value = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                if ($value === null) {
                    throw ApiException::unprocessable('Must be true or false.');
                }
                return $value ? '1' : '0';

            case 'int':
                if (!is_numeric($value)) {
                    throw ApiException::unprocessable('Must be a number.');
                }
                return (string) (int) $value;

            case 'json':
                if (is_string($value)) {
                    $decoded = json_decode($value, true);
                    if (json_last_error() !== JSON_ERROR_NONE) {
                        throw ApiException::unprocessable('Must be valid JSON.');
                    }
                    $value = $decoded;
                }
                return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

            case 'script':
                $slot = $key === 'header_scripts' ? 'header' : 'footer';
                $result = Security::validateSnippet(is_string($value) ? $value : '', $slot);
                if (!$result['ok']) {
                    throw ApiException::unprocessable($result['reason']);
                }
                return $result['clean'] === '' ? null : $result['clean'];

            case 'text':
                return Security::plainText((string) $value, 0) === ''
                    ? trim((string) $value)
                    : trim((string) $value);

            default:
                $value = trim((string) $value);

                if ($key === 'analytics_id' && $value !== '' && !Security::isValidMeasurementId($value)) {
                    throw ApiException::unprocessable('Use a GA4 (G-XXXXXXX) or GTM (GTM-XXXXXX) id.');
                }
                if (in_array($key, ['social_facebook', 'social_instagram', 'social_linkedin', 'social_x', 'social_youtube', 'site_url'], true)
                    && $value !== '' && !Security::isSafeUrl($value)) {
                    throw ApiException::unprocessable('Must be a valid https URL.');
                }
                if (in_array($key, ['contact_email', 'lead_notification_email'], true)
                    && $value !== '' && filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
                    throw ApiException::unprocessable('Must be a valid email address.');
                }
                if (in_array($key, ['logo_path', 'favicon_path'], true) && $value !== '' && !preg_match('#^(/|https://)#', $value)) {
                    throw ApiException::unprocessable('Use an absolute path starting with / or an https URL.');
                }
                return $value === '' ? null : $value;
        }
    }

    private function castValue(string $value, string $type): mixed
    {
        return match ($type) {
            'bool' => $value === '1',
            'int' => (int) $value,
            'json' => (static function () use ($value) {
                $decoded = json_decode($value, true);
                return is_array($decoded) ? $decoded : [];
            })(),
            default => $value,
        };
    }

    /** Absolute base URL used for canonical links and the sitemap. */
    public function siteUrl(): string
    {
        $url = $this->get('site_url');
        if (is_string($url) && $url !== '') {
            return rtrim($url, '/');
        }
        $fallback = Config::string('site.url', '');
        return rtrim($fallback, '/');
    }
}
