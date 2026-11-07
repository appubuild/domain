<?php
/**
 * Bootstrap: autoloading, configuration, error handling, timezone.
 * Loaded once by index.php before anything else runs.
 */

declare(strict_types=1);

use Shn\Helpers\Config;

mb_internal_encoding('UTF-8');
date_default_timezone_set('UTC');

/* -------------------------------------------------------------------------- */
/*  Autoloader — PSR-4 style, no Composer dependency                          */
/* -------------------------------------------------------------------------- */

spl_autoload_register(static function (string $class): void {
    $prefix = 'Shn\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $parts = explode('\\', $relative);
    $map = [
        'Helpers' => 'helpers',
        'Models' => 'models',
        'Controllers' => 'controllers',
        'Middleware' => 'middleware',
        'Services' => 'services',
        'Config' => 'config',
    ];

    $folder = $map[$parts[0]] ?? null;
    if ($folder === null || count($parts) < 2) {
        return;
    }

    $file = dirname(__DIR__) . '/' . $folder . '/' . $parts[1] . '.php';
    if (is_file($file)) {
        require $file;
    }
});

/* -------------------------------------------------------------------------- */
/*  Configuration                                                             */
/* -------------------------------------------------------------------------- */

require __DIR__ . '/Env.php';
require __DIR__ . '/Config.php';

Config::load(dirname(__DIR__));

$debug = Config::bool('app.debug', false);

/* -------------------------------------------------------------------------- */
/*  Errors                                                                    */
/* -------------------------------------------------------------------------- */

error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
ini_set('html_errors', '0');

$logDir = Config::get('app.log_dir', dirname(__DIR__) . '/storage/logs');
if (!is_dir($logDir)) {
    @mkdir($logDir, 0775, true);
}
ini_set('error_log', $logDir . '/php-error.log');

require __DIR__ . '/ApiException.php';
require __DIR__ . '/Response.php';
require __DIR__ . '/Request.php';
require __DIR__ . '/Router.php';
require __DIR__ . '/Validator.php';
require __DIR__ . '/Security.php';
require __DIR__ . '/Database.php';

set_exception_handler(static function (Throwable $error) use ($debug): void {
    error_log('[unhandled] ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());

    if (!headers_sent()) {
        Response::error(
            500,
            'server_error',
            $debug ? $error->getMessage() : 'An unexpected error occurred. The incident has been logged.',
        );
    }
});

register_shutdown_function(static function (): void {
    $error = error_get_last();
    if ($error === null || !in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }
    error_log('[fatal] ' . $error['message'] . ' @ ' . $error['file'] . ':' . $error['line']);
    if (!headers_sent()) {
        Response::error(500, 'server_error', 'A fatal error occurred. The incident has been logged.');
    }
});
