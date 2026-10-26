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

function admin_header(PDO $pdo, array $admin, string $title): void
{
    apply_security_headers();
    $links = [
        ['view_dashboard','Dashboard','admin/dashboard.php'],
        ['manage_posts','Posts','admin/posts/index.php'],
        ['manage_pages','Pages','admin/pages/index.php'],
        ['manage_wordbank','Domain brain','admin/domain-brain/index.php'],
        ['manage_contacts','Contact inbox','admin/contact.php'],
        ['manage_ads','Ads & integrations','admin/ads.php'],
        ['manage_affiliates','Affiliate links','admin/affiliates.php'],
        ['manage_analytics','Traffic report','admin/analytics.php'],
        ['manage_users','Users & roles','admin/users.php'],
        ['manage_settings','Navigation menus','admin/navigation.php'],
        ['manage_settings','Site settings','admin/settings.php'],
    ];
    ?>
    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title><?= e($title) ?> · Admin</title><link rel="stylesheet" href="<?= e(asset_url('css/style.css')) ?>"><link rel="stylesheet" href="<?= e(asset_url('css/dynamic.css')) ?>"><script src="<?= e(asset_url('js/admin.js')) ?>" defer></script></head><body class="admin-body">
    <div class="admin-shell"><aside class="admin-sidebar"><a class="brand" href="<?= e(app_url('admin/dashboard.php')) ?>"><img src="<?= e(asset_url('img/logo.svg')) ?>" width="36" height="36" alt=""><span>DomainFits CMS</span></a><nav aria-label="Admin navigation">
    <?php foreach ($links as [$permission, $label, $path]): if (has_permission($pdo, (int) $admin['id'], $permission)): ?><a href="<?= e(app_url($path)) ?>"><?= e($label) ?></a><?php endif; endforeach; ?>
    </nav><div class="admin-user"><strong><?= e($admin['display_name']) ?></strong><span><?= e($admin['email']) ?></span><form method="post" action="<?= e(app_url('admin/logout.php')) ?>"><?= csrf_field() ?><button class="admin-logout" type="submit">Log out</button></form></div></aside><main class="admin-main"><div class="admin-topbar"><a href="<?= e(app_url('index.php')) ?>" target="_blank" rel="noopener">Open public site ↗</a><span>Admin workspace</span></div><div class="admin-content"><h1><?= e($title) ?></h1>
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
