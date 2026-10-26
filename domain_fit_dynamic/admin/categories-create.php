<?php
declare(strict_types=1);

require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/analytics.php';
require_once __DIR__ . '/../includes/cache.php';

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
    $respond(['error' => 'Use POST to create a category.'], 405);
}
if (!has_permission($pdo, (int) $admin['id'], 'manage_posts')) {
    $respond(['error' => 'You do not have permission to manage post categories.'], 403);
}
$knownToken = (string) ($_SESSION['_csrf'] ?? '');
$postedToken = request_string($_POST, '_csrf');
if ($knownToken === '' || $postedToken === '' || !hash_equals($knownToken, $postedToken)) {
    $respond(['error' => 'Your session expired. Refresh the page and try again.'], 419);
}
$name = trim(substr(strip_tags(request_string($_POST, 'name', '')), 0, 120));
if ($name === '' || preg_match('/[\x00-\x1f\x7f]/', $name)) {
    $respond(['error' => 'Enter a valid category name, up to 120 characters.'], 422);
}
try {
    $existing = $pdo->prepare('SELECT id,name,slug FROM categories WHERE name=:name LIMIT 1');
    $existing->execute(['name' => $name]);
    $row = $existing->fetch();
    if ($row) $respond(['category' => ['id' => (int) $row['id'], 'name' => (string) $row['name'], 'slug' => (string) $row['slug']], 'created' => false]);

    $baseSlug = substr(slugify($name), 0, 120);
    if ($baseSlug === '') $baseSlug = 'category';
    $slug = $baseSlug;
    $checkSlug = $pdo->prepare('SELECT id FROM categories WHERE slug=:slug LIMIT 1');
    $suffix = 0;
    do {
        $checkSlug->execute(['slug' => $slug]);
        if (!$checkSlug->fetchColumn()) break;
        $suffix++;
        $slug = substr($baseSlug, 0, 120) . '-' . substr(hash('sha256', $name . '|' . $suffix), 0, 12);
    } while ($suffix < 20);
    if ($suffix >= 20) throw new RuntimeException('Could not create a unique category URL key.');

    $insert = $pdo->prepare('INSERT INTO categories (name,slug,created_by) VALUES (:name,:slug,:admin)');
    $insert->execute(['name' => $name, 'slug' => $slug, 'admin' => (int) $admin['id']]);
    $id = (int) $pdo->lastInsertId();
    audit_log($pdo, (int) $admin['id'], 'post.category_created', 'category', (string) $id, $name);
    cache_clear_all();
    $respond(['category' => ['id' => $id, 'name' => $name, 'slug' => $slug], 'created' => true]);
} catch (Throwable $error) {
    error_log('Post category create: ' . $error->getMessage());
    $respond(['error' => 'Category could not be created. Confirm the enterprise category migration has been applied.'], 503);
}
