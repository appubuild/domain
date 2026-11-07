<?php
/**
 * Audit trail writer plus a thin file logger for non-audit events.
 * Audit rows never contain secrets or raw IP addresses.
 */

declare(strict_types=1);

namespace Shn\Helpers;

use PDOException;

final class Logger
{
    /** @param array<string,mixed> $context */
    public static function audit(
        ?array $admin,
        string $action,
        ?string $entityType = null,
        int|string|null $entityId = null,
        ?string $summary = null,
        ?string $ip = null,
    ): void {
        try {
            $statement = Database::pdo()->prepare(
                'INSERT INTO activity_log (admin_id, action, entity_type, entity_id, summary, ip_hash)
                 VALUES (:admin_id, :action, :entity_type, :entity_id, :summary, :ip_hash)',
            );
            $statement->execute([
                ':admin_id' => $admin['id'] ?? null,
                ':action' => substr($action, 0, 80),
                ':entity_type' => $entityType !== null ? substr($entityType, 0, 60) : null,
                ':entity_id' => $entityId !== null ? substr((string) $entityId, 0, 60) : null,
                ':summary' => $summary !== null ? Security::plainText($summary, 300) : null,
                ':ip_hash' => $ip !== null ? Security::fingerprintIp($ip) : null,
            ]);
        } catch (PDOException $exception) {
            error_log('[audit] ' . $exception->getMessage());
        }
    }

    /** @param array<string,mixed> $context */
    public static function warning(string $message, array $context = []): void
    {
        $line = '[warn] ' . $message;
        if ($context !== []) {
            $line .= ' ' . json_encode($context, JSON_UNESCAPED_SLASHES);
        }
        error_log($line);
    }

    public static function error(string $message, ?\Throwable $error = null): void
    {
        $line = '[error] ' . $message;
        if ($error !== null) {
            $line .= ' :: ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine();
        }
        error_log($line);
    }
}
