<?php
/**
 * PDO connection factory.
 *
 * · one connection per request (lazy)
 * · exceptions on, emulation off, real prepared statements only
 * · utf8mb4 by default
 */

declare(strict_types=1);

namespace Shn\Helpers;

use PDO;
use PDOException;

final class Database
{
    private static ?PDO $connection = null;

    public static function pdo(): PDO
    {
        if (self::$connection instanceof PDO) {
            return self::$connection;
        }

        $host = Config::string('db.host', '127.0.0.1');
        $port = Config::int('db.port', 3306);
        $name = Config::string('db.name', '');
        $user = Config::string('db.user', '');
        $password = Config::string('db.password', '');
        $charset = Config::string('db.charset', 'utf8mb4');

        if ($name === '' || $user === '' || $password === '') {
            throw ApiException::server('Database credentials are not configured. Create api/.env from api/.env.example.');
        }

        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $host, $port, $name, $charset);

        try {
            self::$connection = new PDO($dsn, $user, $password, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES {$charset} COLLATE {$charset}_unicode_ci, time_zone = '+00:00'",
            ]);
        } catch (PDOException $exception) {
            error_log('[db] connection failed: ' . $exception->getMessage());
            throw ApiException::server('Database connection failed. Check the credentials in api/.env.');
        }

        return self::$connection;
    }

    /**
     * Runs a callback inside a transaction, rolling back on any throwable.
     *
     * @template T
     * @param callable(PDO):T $callback
     * @return T
     */
    public static function transaction(callable $callback): mixed
    {
        $pdo = self::pdo();
        $pdo->beginTransaction();
        try {
            $result = $callback($pdo);
            $pdo->commit();
            return $result;
        } catch (\Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    /** Used by the test harness to inject a fake driver. */
    public static function setConnection(?PDO $pdo): void
    {
        self::$connection = $pdo;
    }

    public static function isConnected(): bool
    {
        try {
            self::pdo()->query('SELECT 1');
            return true;
        } catch (\Throwable) {
            return false;
        }
    }
}
