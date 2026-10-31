<?php
require_once __DIR__ . '/functions.php';

function apply_security_headers(): void
{
    if (headers_sent()) {
        return;
    }
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
}

function admin_header(PDO $pdo, array $admin, string $title, array $extraStyles = []): void
{
    apply_security_headers();
    $requestPath = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/');
    $basePath = app_base_path();
    if ($basePath !== '' && str_starts_with($requestPath, $basePath)) $requestPath = substr($requestPath, strlen($basePath));
    $activePath = trim($requestPath, '/');
    if ($activePath === 'admin') $activePath = 'admin/dashboard';
    if (preg_match('~^admin/posts(?:/|$)~', $activePath)) $activePath = 'admin/posts';
    if (preg_match('~^admin/pages(?:/|$)~', $activePath)) $activePath = 'admin/pages';
    if (preg_match('~^admin/domain-brain(?:/|$)~', $activePath)) $activePath = 'admin/domain-brain';
    $links = [

        ['view_dashboard','Dashboard','admin/dashboard'],
        ['manage_posts','Posts','admin/posts'],
        ['manage_pages','Pages','admin/pages'],
        ['manage_wordbank','Domain brain','admin/domain-brain'],
        ['manage_contacts','Contact inbox','admin/contact'],
        ['manage_ads','Ads & integrations','admin/ads'],
        ['manage_affiliates','Affiliate links','admin/affiliates'],
        ['manage_analytics','Traffic report','admin/analytics'],
        ['manage_users','Users & roles','admin/users'],
        ['manage_settings','Navigation menus','admin/navigation'],
        ['manage_settings','Site settings','admin/site-settings'],
        ['manage_settings','Extensions','admin/extensions'],
    ];
    if (function_exists('df_apply_filters')) {
        $filteredLinks = df_apply_filters('admin.navigation_links', $links, $pdo, $admin);
        if (is_array($filteredLinks)) $links = $filteredLinks;
    }
    ?>
    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title><?= e($title) ?> · Admin</title><link rel="stylesheet" href="<?= e(asset_url('css/style.css')) ?>"><link rel="stylesheet" href="<?= e(asset_url('css/dynamic.css')) ?>"><?php foreach ($extraStyles as $style): ?><link rel="stylesheet" href="<?= e(asset_url((string) $style)) ?>"><?php endforeach; ?><script src="<?= e(asset_url('js/admin.js')) ?>" defer></script></head><body class="admin-body">
    <div class="admin-shell"><aside class="admin-sidebar"><a class="brand" href="<?= e(app_url('admin/dashboard')) ?>"><img src="<?= e(asset_url('img/logo.svg')) ?>" width="36" height="36" alt=""><span>DomainFits CMS</span></a><nav aria-label="Admin navigation">
    <?php foreach ($links as $link):
        if (!is_array($link) || count($link) < 3) continue;
        [$permission, $label, $path] = array_values($link);
        $permission = (string) $permission; $label = (string) $label; $path = (string) $path;
        if (!has_permission($pdo, (int) $admin['id'], $permission)) continue;
        $linkPath = trim((string) (parse_url('/' . ltrim($path, '/'), PHP_URL_PATH) ?: ''), '/');
        $active = $activePath === $linkPath;
        if ($active && $linkPath === 'admin/extensions') {
            $expectedQuery = []; $actualQuery = [];
            parse_str((string) (parse_url($path, PHP_URL_QUERY) ?? ''), $expectedQuery);
            parse_str((string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_QUERY) ?? ''), $actualQuery);
            $expectedPlugin = (string) ($expectedQuery['plugin'] ?? '');
            $actualPlugin = (string) ($actualQuery['plugin'] ?? '');
            $active = $expectedPlugin !== '' ? $actualPlugin === $expectedPlugin : $actualPlugin === '';
        }
    ?><a href="<?= e(app_url($path)) ?>" class="<?= $active ? 'is-active' : '' ?>" <?= $active ? 'aria-current="page"' : '' ?>><?= e($label) ?></a><?php endforeach; ?>
    </nav><div class="admin-user"><strong><?= e($admin['display_name']) ?></strong><span><?= e($admin['email']) ?></span><form method="post" action="<?= e(app_url('admin/logout')) ?>"><?= csrf_field() ?><button class="admin-logout" type="submit">Log out</button></form></div></aside><main class="admin-main"><div class="admin-topbar"><a href="<?= e(app_url('')) ?>" target="_blank" rel="noopener">Open public site ↗</a><span>Admin workspace</span></div><div class="admin-content"><h1><?= e($title) ?></h1>
    <?php if ($message = flash('success')): ?><div class="notice notice-success" role="status"><?= e($message) ?></div><?php endif; ?>
    <?php if ($message = flash('error')): ?><div class="notice notice-error" role="alert"><?= e($message) ?></div><?php endif; ?>
    <?php
}

function admin_footer(): void
{
    echo '</div></main></div></body></html>';
}

function admin_require_permission(PDO $pdo, array $admin, string $permission): void
{
    require_permission($pdo, $admin, $permission);
}
