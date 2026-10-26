<?php
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/public-content.php';
$pdo = db();
$slug = strtolower(request_string($_GET, 'slug'));
if (!preg_match('/^[a-z0-9-]+$/', $slug)) not_found_page($pdo);
$query = $pdo->prepare("SELECT slug FROM site_pages WHERE legacy_file=:file AND status='published' LIMIT 1");
$query->execute(['file' => $slug . '.html']);
$publishedSlug = $query->fetchColumn();
if (!$publishedSlug) not_found_page($pdo);
header('X-Robots-Tag: noindex');
redirect_to('pages/' . $publishedSlug, 301);
