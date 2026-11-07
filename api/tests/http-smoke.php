<?php
/**
 * CLI smoke runner: dispatches one request through the real router and prints
 * the JSON body plus `STATUS:<code>` on stderr.
 *
 *     php tests/http-smoke.php GET /v1/health
 *     php tests/http-smoke.php GET /v1/does-not-exist
 *
 * Routes that need MySQL return 500/503 when no database is configured — that
 * is expected outside a provisioned host; see docs/TESTING.md.
 */

declare(strict_types=1);

use Shn\Helpers\Request;
use Shn\Helpers\Router;

$method = strtoupper($argv[1] ?? 'GET');
$path = $argv[2] ?? '/';
$body = $argv[3] ?? '';

$_SERVER['REQUEST_METHOD'] = $method;
$_SERVER['SCRIPT_NAME'] = '/api/index.php';
$_SERVER['REQUEST_URI'] = '/api' . $path;
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTP_USER_AGENT'] = 'shn-cli-smoke';

require dirname(__DIR__) . '/helpers/bootstrap.php';

register_shutdown_function(static function (): void {
    fwrite(STDERR, 'STATUS:' . http_response_code() . PHP_EOL);
});

$decoded = $body !== '' ? json_decode($body, true) : [];
$request = new Request(
    $method,
    Request::normalisePath('/api' . $path),
    [],
    is_array($decoded) ? $decoded : [],
    ['content-type' => 'application/json'],
    $_SERVER,
    [],
);

Router::boot()->dispatch($request);
