<?php
/**
 * Housekeeping script. Run from cron (daily) or manually:
 *
 *     php /home/USER/public_html/api/tools/maintenance.php
 *
 * Deletes expired sessions, password resets and rate-limit buckets, then trims
 * analytics events older than the configured retention window. It never touches
 * content, leads, calls or revenue.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit("Not found.\n");
}

$_SERVER['SCRIPT_NAME'] = '/api/tools/maintenance.php';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';

require dirname(__DIR__) . '/helpers/bootstrap.php';

use Shn\Helpers\Config;
use Shn\Helpers\Database;

$pdo = Database::pdo();
$report = [];

$report['expired_sessions'] = $pdo->exec('DELETE FROM admin_sessions WHERE expires_at < UTC_TIMESTAMP()');
$report['password_resets'] = $pdo->exec('DELETE FROM password_resets WHERE expires_at < UTC_TIMESTAMP() OR used_at IS NOT NULL');
$report['rate_limit_rows'] = $pdo->exec('DELETE FROM rate_limits WHERE expires_at < UTC_TIMESTAMP()');

$retention = Config::int('auth.analytics_retention_days', 400);
if ($retention > 0) {
    $statement = $pdo->prepare('DELETE FROM analytics_events WHERE created_at < UTC_TIMESTAMP() - INTERVAL :days DAY');
    $statement->bindValue(':days', $retention, PDO::PARAM_INT);
    $statement->execute();
    $report['analytics_events'] = $statement->rowCount();
}

$pdo->exec('OPTIMIZE TABLE rate_limits');

printf("[maintenance] %s\n", gmdate('c'));
foreach ($report as $label => $count) {
    printf("  %-20s %s\n", $label, (string) $count);
}
