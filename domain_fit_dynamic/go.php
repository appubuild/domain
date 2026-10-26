<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/analytics.php';
header('X-Robots-Tag: noindex,nofollow');
$slug = strtolower(trim(request_string($_GET, 'slug')));
if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug)) {
    http_response_code(404);
    exit('Link not found.');
}
try {
    $pdo = db();
    $query = $pdo->prepare('SELECT id,destination_url FROM affiliate_links WHERE slug=:slug AND is_active=1 LIMIT 1');
    $query->execute(['slug' => $slug]);
    $link = $query->fetch();
    if (!$link) {
        http_response_code(404);
        exit('Link not found.');
    }
    $target = trim((string) $link['destination_url']);
    if (!filter_var($target, FILTER_VALIDATE_URL) || strtolower((string) parse_url($target, PHP_URL_SCHEME)) !== 'https') {
        http_response_code(404);
        exit('Link not available.');
    }
    $insert = $pdo->prepare('INSERT INTO affiliate_clicks (affiliate_link_id,visitor_hash) VALUES (:id,:visitor)');
    $insert->execute(['id' => $link['id'], 'visitor' => analytics_visitor_hash()]);
    header('Cache-Control: no-store');
    header('Location: ' . $target, true, 302);
} catch (Throwable $error) {
    error_log('Affiliate redirect: ' . $error->getMessage());
    http_response_code(503);
    exit('Link unavailable.');
}
