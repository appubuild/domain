<?php
/**
 * Application configuration.
 *
 * Values are read from api/.env (or a .env one level above the public API
 * folder). Never commit real values — this file only reads them.
 */

declare(strict_types=1);

use Shn\Helpers\Env;

$storage = dirname(__DIR__) . '/storage';

/** Application key: used for HMACs (visitor fingerprints, CSRF, reset tokens). */
$appKey = Env::get('APP_KEY', '');
if ($appKey === '') {
    $keyFile = $storage . '/app.key';
    if (is_file($keyFile)) {
        $appKey = trim((string) file_get_contents($keyFile));
    }
    if ($appKey === '') {
        if (!is_dir($storage)) {
            @mkdir($storage, 0775, true);
        }
        $generated = bin2hex(random_bytes(32));
        if (@file_put_contents($keyFile, $generated, LOCK_EX) !== false) {
            @chmod($keyFile, 0600);
            $appKey = $generated;
        } else {
            error_log('[config] APP_KEY is missing and storage/ is not writable; using a volatile key.');
            $appKey = $generated;
        }
    }
}

$originList = Env::get('CORS_ALLOWED_ORIGINS', '');

return [
    'name' => Env::get('APP_NAME', 'Safe Home Network API'),
    'version' => '1.0.0',
    'env' => Env::get('APP_ENV', 'production'),
    'debug' => Env::bool('APP_DEBUG', false),
    'url' => rtrim((string) Env::get('APP_URL', ''), '/'),
    'key' => $appKey,
    'timezone' => 'UTC',
    'log_dir' => Env::get('LOG_DIR', $storage . '/logs'),

    /* Public site used in canonical URLs, sitemaps and CORS. */
    'site' => [
        'url' => rtrim((string) Env::get('SITE_URL', 'https://safehomenetwork.com'), '/'),
        'admin_path' => '/admin',
    ],

    /* Uploads */
    'uploads' => [
        'path' => Env::get('UPLOAD_PATH', dirname(__DIR__) . '/uploads'),
        'url' => rtrim((string) Env::get('UPLOAD_URL', '/api/uploads'), '/'),
        'max_bytes' => Env::int('UPLOAD_MAX_BYTES', 5 * 1024 * 1024),
        'allowed_mime' => ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'],
        'allowed_ext' => ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg'],
    ],

    /* Security */
    'security' => [
        'bcrypt_cost' => Env::int('BCRYPT_COST', 12),
        'session_cookie' => Env::get('SESSION_COOKIE', 'shn_admin_session'),
        'csrf_cookie' => Env::get('CSRF_COOKIE', 'shn_csrf'),
        'session_lifetime' => Env::int('SESSION_LIFETIME', 8 * 3600),
        'session_idle' => Env::int('SESSION_IDLE', 2 * 3600),
        'cookie_secure' => Env::bool('COOKIE_SECURE', true),
        'cookie_domain' => Env::get('COOKIE_DOMAIN', ''),
        'remember_lifetime' => Env::int('REMEMBER_LIFETIME', 30 * 86400),
        'script_hosts' => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) Env::get('SCRIPT_HOSTS', '')),
        ))),
        'max_login_attempts' => Env::int('MAX_LOGIN_ATTEMPTS', 5),
        'login_lockout' => Env::int('LOGIN_LOCKOUT', 900),
        'password_min_length' => Env::int('PASSWORD_MIN_LENGTH', 12),
    ],

    /* CORS — the live frontend domains only. */
    'cors' => [
        'origins' => $originList !== ''
            ? array_values(array_filter(array_map('trim', explode(',', $originList))))
            : [
                'https://safehomenetwork.com',
                'https://www.safehomenetwork.com',
                'http://localhost:5173',
                'http://127.0.0.1:5173',
            ],
        'methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        'headers' => ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
        'max_age' => 86400,
    ],

    /* Coarse public-endpoint throttling (requests per window, seconds). */
    'rate_limits' => [
        'default' => [Env::int('RATE_DEFAULT_MAX', 120), 60],
        'read' => [Env::int('RATE_READ_MAX', 240), 60],
        'login_main' => [Env::int('RATE_LOGIN_MAX', 5), Env::int('RATE_LOGIN_WINDOW', 900)],
        'login' => [Env::int('RATE_LOGIN_MAX', 5), Env::int('RATE_LOGIN_WINDOW', 900)],
        'lead' => [Env::int('RATE_LEAD_MAX', 5), 600],
        'analytics' => [Env::int('RATE_ANALYTICS_MAX', 60), 60],
        'password_reset' => [Env::int('RATE_RESET_MAX', 3), 3600],
    ],

    /* Auth */
    'auth' => [
        'max_sessions_per_admin' => Env::int('MAX_SESSIONS', 10),
        'audit_retention_days' => Env::int('AUDIT_RETENTION', 365),
        'analytics_retention_days' => Env::int('ANALYTICS_RETENTION', 400),
    ],

    /* Scheduled publishing.
     * Timestamps are always stored in UTC (the whole API runs on UTC); the
     * timezone below only decides how a local wall-clock time typed in the
     * admin is converted to UTC, and how the admin renders it back. */
    'publishing' => [
        'timezone' => Env::get('PUBLISH_TIMEZONE', 'America/New_York'),
        'batch' => Env::int('PUBLISH_BATCH', 50),
    ],

    /* Where the regenerated XML sitemap is written. */
    'sitemap' => [
        'path' => Env::get('SITEMAP_PATH', dirname(__DIR__, 2) . '/public/sitemap.xml'),
    ],

    /* Public response caching hints (seconds, 0 = no cache). */
    'cache' => [
        'public_ttl' => Env::int('PUBLIC_CACHE_TTL', 0),
    ],

    /**
     * Push / email integrations must not be invented: leads are stored and
     * retrieved from the database until a real provider is configured.
     */
    'integrations' => [
        'lead_webhook' => Env::get('LEAD_WEBHOOK_URL', ''),
        'call_tracking_provider' => Env::get('CALL_TRACKING_PROVIDER', ''),
        'call_tracking_key' => Env::get('CALL_TRACKING_KEY', ''),
        'affiliate_network' => Env::get('AFFILIATE_NETWORK', ''),
    ],
];
