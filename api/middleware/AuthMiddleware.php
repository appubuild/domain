<?php
/**
 * Session authentication.
 *
 * Accepts an HttpOnly cookie (admin panel) or `Authorization: Bearer <token>`
 * (server-to-server). Only the SHA-256 of the token is stored in the database,
 * so a leaked table dump cannot be replayed as a login.
 */

declare(strict_types=1);

namespace Shn\Middleware;

use Shn\Helpers\ApiException;
use Shn\Helpers\Config;
use Shn\Helpers\Database;
use Shn\Helpers\Request;
use Shn\Helpers\Security;
use PDO;

final class AuthMiddleware
{
    public function handle(Request $request): void
    {
        $cookieToken = $request->cookie(Config::string('security.session_cookie', 'shn_admin_session'));

        if ($cookieToken !== null) {
            $token = $cookieToken;
            $via = 'cookie';
        } else {
            $token = $request->bearerToken();
            $via = 'bearer';
        }

        if ($token === null || $token === '' || !preg_match('/^[a-f0-9]{64}$/', $token)) {
            throw ApiException::unauthorized('Sign in to continue.');
        }

        $pdo = Database::pdo();
        $statement = $pdo->prepare(
            'SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.last_used_at,
                    a.id, a.name, a.email, a.role, a.status, a.password_hash
               FROM admin_sessions s
               INNER JOIN admins a ON a.id = s.admin_id
              WHERE s.id = :id
                AND a.status = "active"
                AND a.deleted_at IS NULL
              LIMIT 1',
        );
        $statement->execute([':id' => Security::hashToken($token)]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        if (!is_array($row)) {
            throw ApiException::unauthorized('Your session is no longer valid. Please sign in again.');
        }

        $now = time();
        if (strtotime((string) $row['expires_at']) <= $now) {
            $this->destroy($pdo, (string) $row['session_id']);
            throw ApiException::unauthorized('Your session has expired. Please sign in again.');
        }

        $idle = Config::int('security.session_idle', 7200);
        if ($idle > 0 && strtotime((string) $row['last_used_at']) < $now - $idle) {
            $this->destroy($pdo, (string) $row['session_id']);
            throw ApiException::unauthorized('Your session timed out. Please sign in again.');
        }

        // Touch at most once a minute to avoid a write on every request.
        if (strtotime((string) $row['last_used_at']) < $now - 60) {
            $touch = $pdo->prepare('UPDATE admin_sessions SET last_used_at = UTC_TIMESTAMP() WHERE id = :id');
            $touch->execute([':id' => $row['session_id']]);
        }

        unset($row['password_hash']);

        $request->admin = $row;
        $request->session = [
            'id' => $row['session_id'],
            'csrf_token' => $row['csrf_token'],
            'expires_at' => $row['expires_at'],
            'via' => $via,
        ];
    }

    private function destroy(PDO $pdo, string $sessionId): void
    {
        $statement = $pdo->prepare('DELETE FROM admin_sessions WHERE id = :id');
        $statement->execute([':id' => $sessionId]);
    }
}
