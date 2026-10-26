<?php
require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/cache.php';

function rebase_local_urls(string $html): string
{
    $base = app_base_path();
    if ($base === '') return $html;
    return preg_replace_callback('/\b(href|src)=("|\')(\/[^"\']*)\2/i', static function (array $match) use ($base): string {
        $path = $match[3];
        if (str_starts_with($path, '//') || $path === $base || str_starts_with($path, $base . '/')) {
            return $match[0];
        }
        return strtolower($match[1]) . '=' . $match[2] . e($base . $path) . $match[2];
    }, $html) ?? $html;
}

function public_content(string $html): string
{
    return rebase_local_urls(sanitize_rich_html($html));
}

function public_image_url(string $url): string
{
    $url = trim($url);
    if ($url === '') return '';
    if (preg_match('~^https://~i', $url)) return $url;
    if (str_starts_with($url, '//') || preg_match('~^https?://~i', $url)) return '';
    $base = app_base_path();
    if ($base !== '' && ($url === $base || str_starts_with($url, $base . '/'))) return $url;
    return str_starts_with($url, '/') ? $base . $url : app_url($url);
}

function absolute_public_url(string $path): string
{
    if (preg_match('~^https://~i', $path)) return $path;
    if (preg_match('~^http://~i', $path)) return '';
    $origin = rtrim((string) (getenv('SITE_ORIGIN') ?: ''), '/');
    if ($origin !== '') return $origin . (str_starts_with($path, '/') ? $path : app_url($path));
    $host = preg_replace('/[^a-z0-9.\-:\[\]]/i', '', (string) ($_SERVER['HTTP_HOST'] ?? '')) ?? '';
    if ($host === '') return '';
    $scheme = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') ? 'https' : 'http';
    $relativePath = str_starts_with($path, '/') ? $path : app_url($path);
    return $scheme . '://' . $host . $relativePath;
}

function not_found_page(PDO $pdo, string $message = 'This page could not be found.'): never
{
    http_response_code(404);
    $page_title = 'Page not found';
    $page_description = $message;
    $noindex = true;
    require dirname(__DIR__) . '/includes/header.php';
    echo '<main id="main-content" class="page-main"><section class="container page-heading"><p class="eyebrow">404</p><h1>Page not found</h1><p>' . e($message) . '</p><a class="button button-primary" href="' . e(app_url('index.php')) . '">Return home</a></section></main>';
    require dirname(__DIR__) . '/includes/footer.php';
    exit;
}

function format_public_date(?string $value): string
{
    if (!$value) return '';
    $timestamp = strtotime($value);
    return $timestamp ? date('F j, Y', $timestamp) : '';
}
