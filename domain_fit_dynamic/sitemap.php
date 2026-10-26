<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/public-content.php';
header('Content-Type: application/xml; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=3600');
try {
    $cached = cache_get('public_sitemap_v1');
    if (is_string($cached) && $cached !== '') {
        echo $cached;
        exit;
    }
    $pdo = db();
    $urls = [
        ['loc' => absolute_public_url('index.php'), 'lastmod' => gmdate('Y-m-d')],
        ['loc' => absolute_public_url('tools/domain-generator'), 'lastmod' => gmdate('Y-m-d')],
        ['loc' => absolute_public_url('blog/'), 'lastmod' => gmdate('Y-m-d')],
    ];
    $pages = $pdo->query("SELECT slug,canonical_url,updated_at FROM site_pages WHERE status='published' AND noindex=0 ORDER BY slug")->fetchAll();
    foreach ($pages as $page) {
        $path = trim((string) ($page['canonical_url'] ?? '')) ?: 'pages/' . $page['slug'];
        $urls[] = ['loc' => absolute_public_url($path), 'lastmod' => gmdate('Y-m-d', strtotime($page['updated_at']))];
    }
    $posts = $pdo->query("SELECT slug,canonical_url,updated_at FROM blog_posts WHERE status='published' AND published_at <= UTC_TIMESTAMP() ORDER BY published_at DESC")->fetchAll();
    foreach ($posts as $post) {
        $path = trim((string) ($post['canonical_url'] ?? '')) ?: 'blog/' . $post['slug'];
        $urls[] = ['loc' => absolute_public_url($path), 'lastmod' => gmdate('Y-m-d', strtotime($post['updated_at']))];
    }
    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
    foreach ($urls as $url) {
        if ($url['loc'] === '') continue;
        $xml .= '  <url><loc>' . htmlspecialchars($url['loc'], ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</loc><lastmod>' . $url['lastmod'] . "</lastmod></url>\n";
    }
    $xml .= "</urlset>\n";
    cache_set('public_sitemap_v1', $xml, 3600);
    echo $xml;
} catch (Throwable $error) {
    error_log('Sitemap: ' . $error->getMessage());
    http_response_code(503);
    echo '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
}
