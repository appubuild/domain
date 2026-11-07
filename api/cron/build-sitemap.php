<?php
/**
 * Cron job: regenerate public/sitemap.xml from the database.
 *
 *     /usr/local/bin/php /home/USER/public_html/api/cron/build-sitemap.php
 *
 * Run it hourly (cPanel → Cron Jobs: "0 * * * *"). Publishing a post also
 * triggers a rebuild immediately, so this is only a safety net for changes made
 * directly in the database.
 *
 * The file must be writable by the PHP user. Either point SITEMAP_PATH at a
 * writable location or chmod the public folder (usually 755 with the file 644
 * owned by the account user is enough on shared hosting).
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'This script must be run from the command line.']);
    exit;
}

use Shn\Helpers\Logger;
use Shn\Services\SitemapBuilder;

require dirname(__DIR__) . '/helpers/bootstrap.php';

try {
    $builder = new SitemapBuilder();
    $bytes = $builder->write();
    $count = count($builder->entries());
    fwrite(STDOUT, gmdate('c') . ' sitemap rebuilt: ' . $count . ' URLs, ' . $bytes . ' bytes → ' . $builder->path() . PHP_EOL);
    exit(0);
} catch (Throwable $error) {
    Logger::error('Sitemap rebuild failed', $error);
    fwrite(STDERR, gmdate('c') . ' sitemap failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
