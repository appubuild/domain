<?php
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/public-content.php';
$pdo = db();
$file = basename(request_string($_GET, 'file'));
if (!preg_match('/^blog-[0-9]{2,3}\.html$/', $file)) not_found_page($pdo);
$query = $pdo->prepare("SELECT slug FROM blog_posts WHERE legacy_file=:file AND status='published' AND published_at <= UTC_TIMESTAMP() LIMIT 1");
$query->execute(['file' => $file]);
$slug = $query->fetchColumn();
if (!$slug) not_found_page($pdo);
header('X-Robots-Tag: noindex');
redirect_to('blog/' . $slug, 301);
