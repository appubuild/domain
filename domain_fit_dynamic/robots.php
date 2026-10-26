<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/public-content.php';
header('Content-Type: text/plain; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=3600');
$siteOrigin = rtrim((string) (getenv('SITE_ORIGIN') ?: ''), '/');
$sitemap = $siteOrigin !== '' ? $siteOrigin . app_url('sitemap.xml') : absolute_public_url('sitemap.xml');
echo "User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /config/\nDisallow: /includes/\nDisallow: /storage/\n";
if ($sitemap !== '') echo 'Sitemap: ' . $sitemap . "\n";
