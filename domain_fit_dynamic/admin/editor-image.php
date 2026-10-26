<?php
declare(strict_types=1);

require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/public-content.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$respond = static function (array $payload, int $status = 200): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
};
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    $respond(['error' => 'Use POST to upload an image.'], 405);
}
if (!has_permission($pdo, (int) $admin['id'], 'manage_posts') && !has_permission($pdo, (int) $admin['id'], 'manage_pages')) {
    $respond(['error' => 'You do not have permission to upload editorial images.'], 403);
}
$knownToken = (string) ($_SESSION['_csrf'] ?? '');
$postedToken = request_string($_POST, '_csrf');
if ($knownToken === '' || $postedToken === '' || !hash_equals($knownToken, $postedToken)) {
    $respond(['error' => 'Your session expired. Refresh the page and try again.'], 419);
}
try {
    $path = save_uploaded_image('image', 'uploads/editor');
    if ($path === null) $respond(['error' => 'Choose an image file first.'], 422);
    $respond(['url' => public_image_url($path), 'message' => 'Image uploaded.']);
} catch (Throwable $error) {
    error_log('Editorial image upload: ' . $error->getMessage());
    $respond(['error' => $error instanceof RuntimeException ? $error->getMessage() : 'Image upload failed.'], 422);
}
