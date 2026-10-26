<?php
require_once __DIR__ . '/functions.php';

function analytics_visitor_hash(): ?string
{
    $secret = (string) (getenv('ANALYTICS_SALT') ?: '');
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    if ($secret === '' || filter_var($ip, FILTER_VALIDATE_IP) === false) {
        return null;
    }
    // Only a daily keyed digest is retained; the raw network address is never written to the DB.
    return hash_hmac('sha256', gmdate('Y-m-d') . '|' . $ip, $secret);
}

function request_page_path(): string
{
    $path = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/');
    $base = app_base_path();
    if ($base !== '' && str_starts_with($path, $base)) {
        $path = substr($path, strlen($base)) ?: '/';
    }
    $path = preg_replace('/[^\pL\pN\/_.,:@+-]/u', '', $path) ?? '/';
    return substr($path, 0, 500) ?: '/';
}

function record_site_event(PDO $pdo, string $eventType, ?string $pagePath = null): void
{
    if (!in_array($eventType, ['page_view','generator_run'], true)) {
        return;
    }
    $hash = analytics_visitor_hash();
    $query = $pdo->prepare('INSERT INTO site_events (event_type, page_path, visitor_hash) VALUES (:type, :path, :visitor)');
    $query->execute(['type' => $eventType, 'path' => substr($pagePath ?: request_page_path(), 0, 500), 'visitor' => $hash]);
}

function allow_public_request(PDO $pdo, string $scope, int $limit, int $windowSeconds = 60): bool
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    $secret = (string) (getenv('APP_SECRET') ?: '');
    if ($secret === '' || filter_var($ip, FILTER_VALIDATE_IP) === false) return true;
    $windowSeconds = max(10, min(3600, $windowSeconds));
    $key = hash_hmac('sha256', $scope . '|' . $ip, $secret);
    $sql = "INSERT INTO public_rate_limits (key_hash,window_started_at,request_count) VALUES (:key,UTC_TIMESTAMP(),1) "
        . "ON DUPLICATE KEY UPDATE request_count=IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(),INTERVAL {$windowSeconds} SECOND),1,request_count+1), "
        . "window_started_at=IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(),INTERVAL {$windowSeconds} SECOND),UTC_TIMESTAMP(),window_started_at)";
    $pdo->prepare($sql)->execute(['key' => $key]);
    $query = $pdo->prepare('SELECT request_count FROM public_rate_limits WHERE key_hash=:key LIMIT 1');
    $query->execute(['key' => $key]);
    return (int) $query->fetchColumn() <= max(1, $limit);
}

function audit_log(PDO $pdo, ?int $adminId, string $action, string $entityType = '', string $entityId = '', string $detail = ''): void
{
    $query = $pdo->prepare('INSERT INTO admin_audit_logs (admin_id, action_key, entity_type, entity_id, detail) VALUES (:admin, :action, :type, :id, :detail)');
    $query->execute([
        'admin' => $adminId,
        'action' => substr($action, 0, 80),
        'type' => substr($entityType, 0, 80),
        'id' => substr($entityId, 0, 80),
        'detail' => substr($detail, 0, 500),
    ]);
}
