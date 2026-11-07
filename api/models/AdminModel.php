<?php
/**
 * Administrators, sessions and password resets.
 *
 * · passwords are bcrypt hashes; the plaintext never touches the database
 * · session tokens are random 32-byte values, stored only as SHA-256
 * · CSRF tokens are stored as SHA-256 as well
 * · repeated failed logins lock the account for a configurable window
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;
use Shn\Helpers\Config;
use Shn\Helpers\Security;

final class AdminModel extends BaseModel
{
    protected string $table = 'admins';

    public const ROLES = ['owner', 'admin', 'editor', 'viewer'];

    /** @return array<string,mixed>|null */
    public function findByEmail(string $email): ?array
    {
        $statement = $this->pdo()->prepare(
            'SELECT * FROM admins WHERE email = :email AND deleted_at IS NULL LIMIT 1',
        );
        $statement->execute([':email' => mb_strtolower(trim($email))]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return is_array($row) ? $row : null;
    }

    /** @return array<string,mixed>|null */
    public function findActive(int $id): ?array
    {
        $statement = $this->pdo()->prepare(
            'SELECT id, name, email, role, status, last_login_at, created_at, updated_at
               FROM admins WHERE id = :id AND deleted_at IS NULL LIMIT 1',
        );
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return is_array($row) ? $row : null;
    }

    public function isLocked(array $admin): bool
    {
        return $admin['locked_until'] !== null && strtotime((string) $admin['locked_until']) > time();
    }

    public function registerFailedAttempt(int $adminId): void
    {
        $max = Config::int('security.max_login_attempts', 5);
        $lockSeconds = Config::int('security.login_lockout', 900);

        $statement = $this->pdo()->prepare(
            'UPDATE admins
                SET failed_attempts = failed_attempts + 1,
                    locked_until = IF(failed_attempts + 1 >= :max, UTC_TIMESTAMP() + INTERVAL :lock SECOND, locked_until)
              WHERE id = :id',
        );
        $statement->execute([
            ':max' => $max,
            ':lock' => $lockSeconds,
            ':id' => $adminId,
        ]);
    }

    public function clearFailures(int $adminId): void
    {
        $statement = $this->pdo()->prepare(
            'UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE id = :id',
        );
        $statement->execute([':id' => $adminId]);
    }

    public function recordSuccessfulLogin(int $adminId, string $ip): void
    {
        $statement = $this->pdo()->prepare(
            'UPDATE admins
                SET last_login_at = UTC_TIMESTAMP(), last_login_ip = :ip, failed_attempts = 0, locked_until = NULL
              WHERE id = :id',
        );
        $statement->execute([':ip' => substr($ip, 0, 64), ':id' => $adminId]);
    }

    /**
     * @return array{token:string,csrf_token:string,expires_at:string,session_id:string}
     */
    public function createSession(int $adminId, string $ip, string $userAgent, bool $remember = false): array
    {
        $lifetime = $remember
            ? Config::int('security.remember_lifetime', 30 * 86400)
            : Config::int('security.session_lifetime', 8 * 3600);

        $token = Security::token(32);
        $csrf = Security::token(32);
        $expiresAt = gmdate('Y-m-d H:i:s', time() + $lifetime);

        // Keep the session table bounded.
        $max = Config::int('auth.max_sessions_per_admin', 10);
        $trim = $this->pdo()->prepare(
            'DELETE FROM admin_sessions
              WHERE admin_id = :admin_id
                AND id NOT IN (SELECT id FROM (
                    SELECT id FROM admin_sessions WHERE admin_id = :admin_id2 ORDER BY created_at DESC LIMIT ' . max(1, $max) . '
                ) AS keep)',
        );
        $trim->execute([':admin_id' => $adminId, ':admin_id2' => $adminId]);

        $statement = $this->pdo()->prepare(
            'INSERT INTO admin_sessions (id, admin_id, csrf_token, ip_hash, user_agent, expires_at)
             VALUES (:id, :admin_id, :csrf_token, :ip_hash, :user_agent, :expires_at)',
        );
        $statement->execute([
            ':id' => Security::hashToken($token),
            ':admin_id' => $adminId,
            ':csrf_token' => Security::hashToken($csrf),
            ':ip_hash' => Security::fingerprintIp($ip),
            ':user_agent' => substr($userAgent, 0, 255),
            ':expires_at' => $expiresAt,
        ]);

        return [
            'token' => $token,
            'csrf_token' => $csrf,
            'expires_at' => $expiresAt,
            'session_id' => Security::hashToken($token),
        ];
    }

    public function revokeSession(string $sessionId): void
    {
        $statement = $this->pdo()->prepare('DELETE FROM admin_sessions WHERE id = :id');
        $statement->execute([':id' => $sessionId]);
    }

    public function revokeAllSessions(int $adminId, ?string $exceptSessionId = null): void
    {
        $sql = 'DELETE FROM admin_sessions WHERE admin_id = :admin_id';
        $params = [':admin_id' => $adminId];
        if ($exceptSessionId !== null) {
            $sql .= ' AND id <> :session_id';
            $params[':session_id'] = $exceptSessionId;
        }
        $statement = $this->pdo()->prepare($sql);
        $statement->execute($params);
    }

    /** @return array<int,array<string,mixed>> */
    public function sessionsFor(int $adminId, ?string $currentSessionId = null): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT id, ip_hash, user_agent, created_at, last_used_at, expires_at
               FROM admin_sessions WHERE admin_id = :admin_id ORDER BY created_at DESC',
        );
        $statement->execute([':admin_id' => $adminId]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(static fn (array $row): array => [
            'id' => $row['id'],
            'current' => $currentSessionId !== null && $row['id'] === $currentSessionId,
            'user_agent' => $row['user_agent'],
            'created_at' => $row['created_at'],
            'last_used_at' => $row['last_used_at'],
            'expires_at' => $row['expires_at'],
        ], $rows);
    }

    public function purgeExpiredSessions(): void
    {
        $this->pdo()->exec('DELETE FROM admin_sessions WHERE expires_at < UTC_TIMESTAMP()');
    }

    /** @param array<string,mixed> $data */
    public function updateProfile(int $adminId, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $adminId];

        if (isset($data['name'])) {
            $fields[] = '`name` = :name';
            $bindings[':name'] = $data['name'];
        }
        if (isset($data['email'])) {
            $exists = $this->pdo()->prepare('SELECT COUNT(*) FROM admins WHERE email = :email AND id <> :id');
            $exists->execute([':email' => mb_strtolower((string) $data['email']), ':id' => $adminId]);
            if ((int) $exists->fetchColumn() > 0) {
                throw ApiException::unprocessable('That email is already in use.', ['email' => 'Already registered.']);
            }
            $fields[] = '`email` = :email';
            $bindings[':email'] = mb_strtolower((string) $data['email']);
        }

        if ($fields === []) {
            return;
        }

        $statement = $this->pdo()->prepare('UPDATE admins SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $statement->execute($bindings);
    }

    public function changePassword(int $adminId, string $currentPassword, string $newPassword, ?string $keepSessionId = null): void
    {
        $statement = $this->pdo()->prepare('SELECT password_hash FROM admins WHERE id = :id');
        $statement->execute([':id' => $adminId]);
        $hash = (string) $statement->fetchColumn();

        if ($hash === '' || !Security::verifyPassword($currentPassword, $hash)) {
            throw ApiException::unprocessable('Your current password is incorrect.', ['current_password' => 'Incorrect password.']);
        }

        $this->assertPasswordStrength($newPassword);

        $update = $this->pdo()->prepare(
            'UPDATE admins SET password_hash = :hash, password_changed_at = UTC_TIMESTAMP(), failed_attempts = 0, locked_until = NULL
              WHERE id = :id',
        );
        $update->execute([':hash' => Security::hashPassword($newPassword), ':id' => $adminId]);

        // Force other devices to sign in again, keeping the current one alive.
        $this->revokeAllSessions($adminId, $keepSessionId);
    }

    public function assertPasswordStrength(string $password): void
    {
        $min = Config::int('security.password_min_length', 12);
        $errors = [];

        if (mb_strlen($password) < $min) {
            $errors['password'] = 'Use at least ' . $min . ' characters.';
        } elseif (!preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) {
            $errors['password'] = 'Include at least one letter and one number.';
        }

        if ($errors !== []) {
            throw ApiException::unprocessable('Choose a stronger password.', $errors);
        }
    }

    /**
     * Issues a single-use reset token. Returns null when the email is unknown
     * (the API responds identically so accounts cannot be enumerated).
     */
    public function createPasswordReset(string $email): ?array
    {
        $admin = $this->findByEmail($email);
        if ($admin === null) {
            return null;
        }

        $token = Security::token(32);
        $expiresAt = gmdate('Y-m-d H:i:s', time() + 3600);

        $this->pdo()->prepare('DELETE FROM password_resets WHERE admin_id = :id AND used_at IS NULL')
            ->execute([':id' => $admin['id']]);

        $statement = $this->pdo()->prepare(
            'INSERT INTO password_resets (admin_id, token_hash, expires_at) VALUES (:admin_id, :token_hash, :expires_at)',
        );
        $statement->execute([
            ':admin_id' => $admin['id'],
            ':token_hash' => Security::hashToken($token),
            ':expires_at' => $expiresAt,
        ]);

        return [
            'token' => $token,
            'expires_at' => $expiresAt,
            'name' => $admin['name'],
            'email' => $admin['email'],
        ];
    }

    public function consumePasswordReset(string $token, string $newPassword): int
    {
        $statement = $this->pdo()->prepare(
            'SELECT id, admin_id, expires_at, used_at FROM password_resets WHERE token_hash = :hash LIMIT 1',
        );
        $statement->execute([':hash' => Security::hashToken($token)]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        if (!is_array($row) || $row['used_at'] !== null || strtotime((string) $row['expires_at']) < time()) {
            throw ApiException::unprocessable('This reset link is invalid or has expired.', ['token' => 'Invalid or expired.']);
        }

        $this->assertPasswordStrength($newPassword);

        $this->pdo()->prepare('UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE id = :id')
            ->execute([':id' => $row['id']]);

        $update = $this->pdo()->prepare(
            'UPDATE admins SET password_hash = :hash, password_changed_at = UTC_TIMESTAMP(), failed_attempts = 0, locked_until = NULL
              WHERE id = :id',
        );
        $update->execute([':hash' => Security::hashPassword($newPassword), ':id' => $row['admin_id']]);

        $this->revokeAllSessions((int) $row['admin_id']);

        return (int) $row['admin_id'];
    }

    /* ------------------------- team management ------------------------- */

    /** @return array<int,array<string,mixed>> */
    public function all(): array
    {
        $rows = $this->pdo()->query(
            'SELECT id, name, email, role, status, last_login_at, created_at, updated_at, deleted_at
               FROM admins ORDER BY deleted_at IS NULL DESC, name ASC',
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'email' => $row['email'],
            'role' => $row['role'],
            'status' => $row['status'],
            'last_login_at' => $row['last_login_at'],
            'created_at' => $row['created_at'],
            'deleted_at' => $row['deleted_at'],
        ], $rows);
    }

    /** @param array<string,mixed> $data */
    public function createAdmin(array $data): int
    {
        $this->assertPasswordStrength((string) $data['password']);

        if ($this->findByEmail((string) $data['email']) !== null) {
            throw ApiException::conflict('An account with that email already exists.', ['email' => 'Already registered.']);
        }

        $statement = $this->pdo()->prepare(
            'INSERT INTO admins (name, email, password_hash, role, status)
             VALUES (:name, :email, :hash, :role, :status)',
        );
        $statement->execute([
            ':name' => $data['name'],
            ':email' => mb_strtolower((string) $data['email']),
            ':hash' => Security::hashPassword((string) $data['password']),
            ':role' => $data['role'] ?? 'editor',
            ':status' => $data['status'] ?? 'active',
        ]);

        return (int) $this->pdo()->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function updateAdmin(int $id, array $data): void
    {
        $fields = [];
        $bindings = [':id' => $id];

        foreach (['name', 'role', 'status'] as $column) {
            if (!array_key_exists($column, $data)) {
                continue;
            }
            if ($column === 'role' && !in_array($data[$column], self::ROLES, true)) {
                throw ApiException::unprocessable('Unknown role.', ['role' => 'Use owner, admin, editor or viewer.']);
            }
            $fields[] = '`' . $column . '` = :' . $column;
            $bindings[':' . $column] = $data[$column];
        }

        if (array_key_exists('password', $data) && $data['password'] !== '' && $data['password'] !== null) {
            $this->assertPasswordStrength((string) $data['password']);
            $fields[] = '`password_hash` = :password_hash';
            $bindings[':password_hash'] = Security::hashPassword((string) $data['password']);
        }

        if ($fields === []) {
            return;
        }

        $statement = $this->pdo()->prepare('UPDATE admins SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $statement->execute($bindings);

        if (($data['status'] ?? '') === 'suspended') {
            $this->revokeAllSessions($id);
        }
    }

    public function deleteAdmin(int $id): void
    {
        $statement = $this->pdo()->prepare('SELECT role FROM admins WHERE id = :id');
        $statement->execute([':id' => $id]);
        $role = (string) $statement->fetchColumn();

        if ($role === 'owner') {
            throw ApiException::forbidden('The owner account cannot be deleted.');
        }

        $this->pdo()->prepare('UPDATE admins SET deleted_at = UTC_TIMESTAMP(), status = "suspended" WHERE id = :id')
            ->execute([':id' => $id]);
        $this->revokeAllSessions($id);
    }
}
