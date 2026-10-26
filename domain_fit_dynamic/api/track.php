<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/analytics.php';
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(204);
    exit;
}
$site = (string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '');
if (in_array($site, ['cross-site'], true)) {
    http_response_code(204);
    exit;
}
try {
    $pdo = db();
    if (!setting($pdo, 'site_analytics_enabled', false) || !allow_public_request($pdo, 'site-track', 240, 60)) {
        http_response_code(204);
        exit;
    }
    $body = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($body)) {
        http_response_code(204);
        exit;
    }
    $typeValue = $body['event'] ?? '';
    $type = is_string($typeValue) ? $typeValue : '';
    if (!in_array($type, ['page_view','generator_run'], true)) {
        http_response_code(204);
        exit;
    }
    $pathValue = $body['path'] ?? '/';
    $path = (string) (parse_url(is_string($pathValue) ? $pathValue : '/', PHP_URL_PATH) ?: '/');
    if (!str_starts_with($path, '/') || str_starts_with($path, '//')) $path = '/';
    $base = app_base_path();
    if ($base !== '' && str_starts_with($path, $base)) $path = substr($path, strlen($base)) ?: '/';
    $path = preg_replace('/[^\pL\pN\/_.,:@+-]/u', '', $path) ?? '/';
    record_site_event($pdo, $type, substr($path, 0, 500));
    http_response_code(204);
} catch (Throwable $error) {
    error_log('Site analytics: ' . $error->getMessage());
    http_response_code(204);
}
