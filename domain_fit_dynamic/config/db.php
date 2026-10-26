<?php
declare(strict_types=1);

require_once __DIR__ . '/env.php';

/** Route PHP runtime errors to private storage while leaving display output clean. */
function configure_php_error_logging(): void
{
    static $configured = false;
    if ($configured) {
        return;
    }
    $configured = true;

    if (PHP_SAPI !== 'cli') {
        @ini_set('display_errors', '0');
        @ini_set('display_startup_errors', '0');
    }
    @ini_set('log_errors', '1');
    error_reporting(E_ALL);

    $directory = dirname(__DIR__) . '/storage/logs';
    if (!is_dir($directory)) {
        @mkdir($directory, 0750, true);
    }
    if (is_dir($directory) && is_writable($directory)) {
        $logFile = $directory . '/php-error.log';
        if (!is_file($logFile)) {
            @touch($logFile);
        }
        if (is_file($logFile)) {
            @chmod($logFile, 0600);
            @ini_set('error_log', $logFile);
        }
    }
}

configure_php_error_logging();
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
