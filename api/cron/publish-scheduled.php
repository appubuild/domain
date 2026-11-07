<?php
/**
 * Cron job: publish scheduled posts and pages whose time has arrived.
 *
 * Run from cPanel → Cron Jobs (once every 5 minutes is plenty):
 *
 *     /usr/local/bin/php /home/USER/public_html/api/cron/publish-scheduled.php >> /home/USER/public_html/api/storage/logs/cron.log 2>&1
 *
 * Or on Hostinger's hPanel cron scheduler, same command with the real paths.
 *
 * Flags (CLI only):
 *     --dry-run    report what would be published, change nothing
 *     --actor=NAME label written into publishing_log (default: cron)
 *     --quiet      only write to the log file, not stdout
 *
 * Safety
 *   · refuses to run from the web (403) — a cron job never needs a URL
 *   · takes an exclusive lock so two overlapping runs cannot race
 *   · the publish UPDATE is guarded by `status = 'scheduled'`, so an item can
 *     only move to published once, and publishing_log records every attempt
 *   · all timestamps are UTC; scheduled_at is compared against UTC_TIMESTAMP()
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'This script must be run from the command line.']);
    exit;
}

use Shn\Helpers\Database;
use Shn\Helpers\Logger;
use Shn\Services\Scheduler;

require dirname(__DIR__) . '/helpers/bootstrap.php';

$args = array_slice($argv, 1);
$dryRun = in_array('--dry-run', $args, true);
$quiet = in_array('--quiet', $args, true);
$actor = 'cron';
foreach ($args as $arg) {
    if (str_starts_with($arg, '--actor=')) {
        $actor = substr($arg, 8) ?: 'cron';
    }
}

$logDir = dirname(__DIR__) . '/storage/logs';
if (!is_dir($logDir)) {
    @mkdir($logDir, 0775, true);
}

$log = static function (string $message) use ($quiet): void {
    if (!$quiet) {
        fwrite(STDOUT, $message . PHP_EOL);
    }
};

/* -------------------------------------------------------------------------- */
/*  Single-run lock                                                           */
/* -------------------------------------------------------------------------- */

$lockPath = $logDir . '/publish-scheduled.lock';
$lock = fopen($lockPath, 'c');
if ($lock === false) {
    fwrite(STDERR, 'Cannot open the lock file at ' . $lockPath . PHP_EOL);
    exit(1);
}
if (!flock($lock, LOCK_EX | LOCK_NB)) {
    $log('Another publishing run is still active — exiting.');
    exit(0);
}

$started = microtime(true);
$log('[' . gmdate('c') . '] publish-scheduled started' . ($dryRun ? ' (dry run)' : ''));

try {
    if ($dryRun) {
        $blog = new \Shn\Models\BlogModel();
        $pages = new \Shn\Models\PageModel();
        $duePosts = $blog->dueScheduled(200);
        $duePages = $pages->dueScheduled(200);
        $log('Due now: ' . count($duePosts) . ' post(s), ' . count($duePages) . ' page(s).');
        foreach ($duePosts as $row) {
            $log('  would publish post #' . $row['id'] . ' — ' . $row['title'] . ' (scheduled ' . $row['scheduled_at'] . ' UTC)');
        }
        foreach ($duePages as $row) {
            $log('  would publish page #' . $row['id'] . ' — ' . $row['title'] . ' (scheduled ' . $row['scheduled_at'] . ' UTC)');
        }
        $log('Dry run complete — nothing was changed.');
        flock($lock, LOCK_UN);
        fclose($lock);
        exit(0);
    }

    $scheduler = new Scheduler();
    $result = $scheduler->run($actor);

    $log('Checked ' . $result['checked'] . ' due item(s): ' . count($result['published']) . ' published, ' . count($result['failed']) . ' failed.');
    foreach ($result['published'] as $item) {
        $log('  published ' . $item['type'] . ' #' . $item['id'] . ' — ' . $item['title']);
    }
    foreach ($result['failed'] as $item) {
        fwrite(STDERR, '  FAILED ' . $item['type'] . ' #' . $item['id'] . ': ' . $item['error'] . PHP_EOL);
    }

    // Housekeeping: keep the log table to a sane size.
    $deleted = Database::pdo()->exec('DELETE FROM publishing_log WHERE executed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 180 DAY)');
    if (is_int($deleted) && $deleted > 0) {
        $log('Pruned ' . $deleted . ' publishing_log row(s) older than 180 days.');
    }

    $elapsed = number_format(microtime(true) - $started, 2);
    $log('[' . gmdate('c') . '] finished in ' . $elapsed . 's');
} catch (Throwable $error) {
    Logger::error('Scheduled publishing failed', $error);
    fwrite(STDERR, '[' . gmdate('c') . '] FAILED: ' . $error->getMessage() . PHP_EOL);
    flock($lock, LOCK_UN);
    fclose($lock);
    exit(1);
}

flock($lock, LOCK_UN);
fclose($lock);
exit(0);
