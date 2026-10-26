<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/domain-brain.php';
require_once __DIR__ . '/../includes/analytics.php';
header('X-Content-Type-Options: nosniff');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300, stale-while-revalidate=600');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}
try {
    $pdo = db();
    if (!allow_public_request($pdo, 'wordbank-read', 120, 60)) {
        http_response_code(429);
        header('Retry-After: 60');
        echo json_encode(['error' => 'Too many requests.']);
        exit;
    }
    $bank = get_generator_wordbank($pdo);
    $json = json_encode($bank, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $etag = '"' . hash('sha256', $json) . '"';
    header('ETag: ' . $etag);
    if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
        http_response_code(304);
        exit;
    }
    echo $json;
} catch (Throwable $error) {
    error_log('Wordbank API: ' . $error->getMessage());
    http_response_code(503);
    header('Cache-Control: no-store');
    echo json_encode(['error' => 'Word bank is temporarily unavailable.']);
}
