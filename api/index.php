<?php
/**
 * ============================================================================
 *  SAFE HOME NETWORK — API front controller
 * ============================================================================
 *  Public entry point: https://safehomenetwork.com/api/v1/…
 *
 *  Every request passes through:
 *      bootstrap → CORS → route match → (rate limit) → (auth) → (csrf)
 *      → controller → JSON response
 *
 *  No credentials, secrets or SQL live in this file.
 * ============================================================================
 */

declare(strict_types=1);

if (PHP_VERSION_ID < 80100) {
    header('Content-Type: application/json; charset=utf-8', true, 500);
    echo json_encode([
        'error' => [
            'code' => 'php_version_unsupported',
            'message' => 'This API requires PHP 8.1 or newer. The server is running ' . PHP_VERSION,
        ],
    ]);
    exit;
}

require __DIR__ . '/helpers/bootstrap.php';

\Shn\Helpers\Router::boot()->dispatch();
