<?php
declare(strict_types=1);

require_once __DIR__ . '/env.php';
load_local_env_file(dirname(__DIR__) . '/.env');

/** PDO connection for the isolated dynamic copy. Hosting variables override the private local .env. */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '3306';
    $name = getenv('DB_NAME') ?: 'domain_fit_dynamic';
    $user = getenv('DB_USER');
    $pass = getenv('DB_PASS');
    if ($user === false || $user === '') {
        throw new RuntimeException('Database is not configured. Set DB_HOST, DB_NAME, DB_USER and DB_PASS in the PHP environment.');
    }

    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $host, $port, $name);
    $pdo = new PDO($dsn, $user, (string) $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}
