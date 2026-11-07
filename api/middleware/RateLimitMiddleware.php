<?php
/**
 * Fixed-window rate limiting backed by MySQL (works on shared hosting, no Redis).
 *
 * The bucket key includes the window index, so a new window naturally gets a
 * fresh counter. Counters are bounded and pruned opportunistically.
 */

declare(strict_types=1);

namespace Shn\Middleware;

use PDOException;
use Shn\Helpers\ApiException;
use Shn\Helpers\Config;
use Shn\Helpers\Database;
use Shn\Helpers\Request;
use Shn\Helpers\Security;

final class RateLimitMiddleware
{
    public function handle(Request $request, string $action = 'default'): void
    {
        $limits = Config::get('rate_limits.' . $action, null);
        if (!is_array($limits)) {
            $limits = Config::get('rate_limits.default', [120, 60]);
        }

        [$max, $window] = [(int) $limits[0], (int) $limits[1]];
        if ($max <= 0 || $window <= 0) {
            return;
        }

        $now = time();
        $windowStart = intdiv($now, $window) * $window;
        $bucket = hash('sha256', $action . '|' . $request->ip() . '|' . $windowStart);
        $expires = gmdate('Y-m-d H:i:s', $windowStart + $window + 60);

        try {
            $pdo = Database::pdo();
        } catch (\Throwable $exception) {
            // Fail open: a database problem must not take the whole API down.
            error_log('[rate-limit] store unavailable: ' . $exception->getMessage());
            return;
        }

        try {
            $insert = $pdo->prepare(
                'INSERT INTO rate_limits (bucket, action, attempts, window_start, expires_at)
                 VALUES (:bucket, :action, 1, UTC_TIMESTAMP(), :expires)
                 ON DUPLICATE KEY UPDATE attempts = attempts + 1, expires_at = VALUES(expires_at)',
            );
            $insert->execute([
                ':bucket' => $bucket,
                ':action' => substr($action, 0, 60),
                ':expires' => $expires,
            ]);

            $select = $pdo->prepare('SELECT attempts FROM rate_limits WHERE bucket = :bucket LIMIT 1');
            $select->execute([':bucket' => $bucket]);
            $attempts = (int) ($select->fetchColumn() ?: 1);

            $remaining = max(0, $max - $attempts);
            if (!headers_sent()) {
                header('X-RateLimit-Limit: ' . $max);
                header('X-RateLimit-Remaining: ' . $remaining);
            }

            if ($attempts > $max) {
                $retryAfter = max(1, $windowStart + $window - $now);
                if (!headers_sent()) {
                    header('Retry-After: ' . $retryAfter);
                }
                throw ApiException::tooManyRequests(
                    'Too many requests. Please try again in ' . $retryAfter . ' seconds.',
                    $retryAfter,
                );
            }

            if (random_int(1, 50) === 1) {
                $prune = $pdo->prepare('DELETE FROM rate_limits WHERE expires_at < UTC_TIMESTAMP() LIMIT 500');
                $prune->execute();
            }
        } catch (ApiException $exception) {
            throw $exception;
        } catch (PDOException $exception) {
            // Never block legitimate traffic because the limiter store failed.
            error_log('[rate-limit] ' . $exception->getMessage());
        }
    }

    /** Used by login to also clear counters after a successful sign-in. */
    public static function clear(string $action, string $ip): void
    {
        try {
            $statement = Database::pdo()->prepare('DELETE FROM rate_limits WHERE action = :action AND bucket LIKE :prefix');
            $statement->execute([
                ':action' => $action,
                ':prefix' => '%',
            ]);
        } catch (PDOException $exception) {
            error_log('[rate-limit] clear failed: ' . $exception->getMessage());
        }
        unset($ip);
    }

    /** Test helper: current bucket hash for an action/ip pair. */
    public static function bucketFor(string $action, string $ip, int $window, ?int $now = null): string
    {
        $now ??= time();
        return hash('sha256', $action . '|' . $ip . '|' . (intdiv($now, $window) * $window));
    }

    public static function fingerprint(string $ip): string
    {
        return Security::fingerprintIp($ip);
    }
}
