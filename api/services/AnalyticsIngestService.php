<?php
/**
 * Validates and normalises analytics events sent by the public site.
 *
 * Only page views, service-card clicks and call-button clicks may be submitted
 * by a browser. Lead submissions are recorded server-side by the lead endpoint,
 * so a visitor cannot inflate lead counts.
 */

declare(strict_types=1);

namespace Shn\Services;

use PDO;
use Shn\Helpers\ApiException;
use Shn\Helpers\Database;

final class AnalyticsIngestService
{
    public const CLIENT_EVENT_TYPES = ['page_view', 'service_click', 'call_click'];
    public const MAX_BATCH = 20;

    /**
     * @param array<int,mixed> $events
     * @return array<int,array<string,mixed>>
     */
    public function normalise(array $events): array
    {
        if (count($events) > self::MAX_BATCH) {
            throw ApiException::unprocessable('Send at most ' . self::MAX_BATCH . ' events per request.');
        }

        $normalised = [];
        foreach ($events as $event) {
            if (!is_array($event)) {
                continue;
            }

            $type = (string) ($event['event_type'] ?? $event['type'] ?? '');
            if (!in_array($type, self::CLIENT_EVENT_TYPES, true)) {
                continue;
            }

            $serviceId = $this->positiveInt($event['service_id'] ?? null);
            $numberId = $this->positiveInt($event['phone_number_id'] ?? null);

            if ($type === 'service_click' && $serviceId === null) {
                continue;
            }
            if ($type === 'call_click' && $numberId === null) {
                continue;
            }

            if ($serviceId !== null && !$this->serviceExists($serviceId)) {
                continue;
            }

            if ($numberId !== null) {
                if (!$this->numberAllowed($numberId, $serviceId, $type)) {
                    continue;
                }
            }

            $normalised[] = [
                'event_type' => $type,
                'visitor_id' => $this->visitorId($event['visitor_id'] ?? null),
                'session_id' => $this->visitorId($event['session_id'] ?? null),
                'path' => $this->path($event['path'] ?? null),
                'referrer' => $this->referrer($event['referrer'] ?? null),
                'utm_source' => $this->text($event['utm_source'] ?? null, 120),
                'utm_medium' => $this->text($event['utm_medium'] ?? null, 120),
                'utm_campaign' => $this->text($event['utm_campaign'] ?? null, 160),
                'utm_term' => $this->text($event['utm_term'] ?? null, 160),
                'utm_content' => $this->text($event['utm_content'] ?? null, 160),
                'service_id' => $serviceId,
                'phone_number_id' => $numberId,
                'device_type' => $this->device($event['device_type'] ?? null),
            ];
        }

        if ($normalised === []) {
            throw ApiException::unprocessable('No valid events were supplied.');
        }

        return $normalised;
    }

    private function positiveInt(mixed $value): ?int
    {
        return is_numeric($value) && (int) $value > 0 ? (int) $value : null;
    }

    private function visitorId(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        return preg_match('/^[0-9a-fA-F-]{8,36}$/', $value) ? substr($value, 0, 36) : null;
    }

    private function path(mixed $value): ?string
    {
        if (!is_string($value) || !str_starts_with($value, '/')) {
            return null;
        }
        $path = preg_replace('#[?#].*$#', '', $value) ?? $value;
        return substr($path, 0, 255);
    }

    private function referrer(mixed $value): ?string
    {
        if (!is_string($value) || $value === '') {
            return null;
        }
        if (strlen($value) > 500) {
            $value = substr($value, 0, 500);
        }
        // Only keep the origin + path of an http(s) referrer.
        $scheme = parse_url($value, PHP_URL_SCHEME);
        if ($scheme !== null && !in_array(strtolower((string) $scheme), ['http', 'https'], true)) {
            return null;
        }
        return $value;
    }

    private function text(mixed $value, int $limit): ?string
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }
        return substr(trim($value), 0, $limit);
    }

    private function device(mixed $value): string
    {
        $value = is_string($value) ? strtolower($value) : '';
        return in_array($value, ['mobile', 'tablet', 'desktop'], true) ? $value : 'unknown';
    }

    private function serviceExists(int $serviceId): bool
    {
        $statement = Database::pdo()->prepare('SELECT COUNT(*) FROM services WHERE id = :id AND deleted_at IS NULL');
        $statement->execute([':id' => $serviceId]);
        return (int) $statement->fetchColumn() > 0;
    }

    /**
     * A number may only be recorded against a service it is actually mapped to,
     * and only while it is active.
     */
    private function numberAllowed(int $numberId, ?int $serviceId, string $type): bool
    {
        $sql = 'SELECT COUNT(*)
                  FROM phone_numbers p
                 WHERE p.id = :id AND p.deleted_at IS NULL';
        $params = [':id' => $numberId];

        if ($type === 'call_click') {
            $sql .= ' AND p.status = "active"';
        }

        if ($serviceId !== null) {
            $sql .= ' AND EXISTS (SELECT 1 FROM service_phone_groups spg
                                   WHERE spg.group_id = p.group_id AND spg.service_id = :service_id)';
            $params[':service_id'] = $serviceId;
        }

        $statement = Database::pdo()->prepare($sql);
        $statement->execute($params);

        return (int) $statement->fetchColumn() > 0;
    }
}
