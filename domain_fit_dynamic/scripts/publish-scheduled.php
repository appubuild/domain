<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__) . '/includes/functions.php';
require_once dirname(__DIR__) . '/includes/cache.php';
$pdo = db();
$statement = $pdo->prepare("UPDATE blog_posts SET status='published',published_at=scheduled_at WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=UTC_TIMESTAMP() AND (legacy_day IS NULL OR legacy_day<31 OR legacy_day>50 OR publication_reviewed=1)");
$statement->execute();
$published = $statement->rowCount();
$pdo->exec("DELETE FROM public_rate_limits WHERE updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)");
if ($published > 0) cache_clear_all();
fwrite(STDOUT, 'Published ' . $published . " scheduled posts.\n");
