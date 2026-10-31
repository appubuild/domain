<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/functions.php';

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    header('Cache-Control: no-store');
    exit('Method not allowed.');
}

try {
    $pdo = db();
    if (!function_exists('dfo_serve_asset_controller')) {
        http_response_code(404);
        header('Cache-Control: no-store');
        exit('Not found.');
    }
    dfo_serve_asset_controller($pdo);
} catch (Throwable $error) {
    error_log('Optimizer asset request failed: ' . $error->getMessage());
    http_response_code(503);
    header('Cache-Control: no-store');
    exit('Asset optimization is temporarily unavailable.');
}
