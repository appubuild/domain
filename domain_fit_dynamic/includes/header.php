<?php
require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/public-content.php';
$pdo = $pdo ?? db();
$siteTitle = (string) setting($pdo, 'site_title', 'DomainFits');
$logoPath = public_image_url((string) setting($pdo, 'logo_path', ''));
$themeMode = setting($pdo, 'theme_mode', 'light') === 'dark' ? 'dark' : 'light';
$primaryColor = (string) setting($pdo, 'primary_color', '#5746e8');
$accentColor = (string) setting($pdo, 'accent_color', '#16a085');
$pageTitle = isset($page_title) && $page_title !== '' ? (string) $page_title : $siteTitle;
$metaDescription = (string) ($page_description ?? setting($pdo, 'site_description', 'Explore domain-name ideas with DomainFits.'));
$canonicalUrl = (string) ($canonical_url ?? '');
$ogImage = (string) ($og_image ?? '');
$siteOrigin = rtrim((string) (getenv('SITE_ORIGIN') ?: ''), '/');
if ($canonicalUrl !== '' && !preg_match('~^https?://~i', $canonicalUrl)) {
    $basePath = app_base_path();
    $canonicalPath = str_starts_with($canonicalUrl, '/') ? $canonicalUrl : app_url($canonicalUrl);
    if ($basePath !== '' && $canonicalPath !== $basePath && !str_starts_with($canonicalPath, $basePath . '/')) {
        $canonicalPath = $basePath . $canonicalPath;
    }
    $canonicalUrl = $siteOrigin !== '' ? $siteOrigin . $canonicalPath : '';
}
if ($ogImage !== '') {
    if (preg_match('~^https://~i', $ogImage) !== 1) {
        $localOgImage = public_image_url($ogImage);
        $ogImage = ($siteOrigin !== '' && $localOgImage !== '') ? $siteOrigin . $localOgImage : '';
    }
}
$analyticsEnabled = (bool) setting($pdo, 'site_analytics_enabled', false);
$ga4Id = (string) private_setting($pdo, 'ga4_measurement_id', '');
$ga4Enabled = (bool) private_setting($pdo, 'ga4_enabled', false) && preg_match('/^G-[A-Z0-9]{6,12}$/', $ga4Id) === 1;
$gtmId = (string) private_setting($pdo, 'gtm_container_id', '');
$gtmEnabled = (bool) private_setting($pdo, 'gtm_enabled', false) && preg_match('/^GTM-[A-Z0-9]{4,12}$/', $gtmId) === 1;
$generatorMode = setting($pdo, 'generator_controls_mode', 'drawer') === 'accordion' ? 'accordion' : 'drawer';
$searchVerification = (string) setting($pdo, 'google_site_verification', '');
$customHeadCode = private_setting($pdo, 'custom_head_code', '');
$customHeadCode = is_string($customHeadCode) && strlen($customHeadCode) <= 20000 ? $customHeadCode : '';
$navItems = [];
try {
    $navItems = $pdo->query("SELECT label, href FROM navigation_items WHERE menu_location = 'header' AND is_active = 1 ORDER BY sort_order, id")->fetchAll();
} catch (Throwable $error) {
    $navItems = [];
}
if (!$navItems) {
    $navItems = [
        ['label' => 'Home', 'href' => ''],
        ['label' => 'Generator', 'href' => 'tools/domain-generator'],
        ['label' => 'Blog', 'href' => 'blog/'],
        ['label' => 'About', 'href' => 'about'],
        ['label' => 'Contact', 'href' => 'contact'],
    ];
}
$themeHex = $themeMode === 'dark' ? '#10121b' : '#f7f8fc';
?>
<!doctype html>
<html lang="en" data-theme="<?= e($themeMode) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="<?= e($themeHex) ?>">
  <title><?= e($pageTitle) ?></title>
  <meta name="description" content="<?= e($metaDescription) ?>">
  <?php if (preg_match('/^[A-Za-z0-9_-]{8,200}$/', $searchVerification)): ?><meta name="google-site-verification" content="<?= e($searchVerification) ?>"><?php endif; ?>
  <meta name="robots" content="<?= !empty($noindex) ? 'noindex,nofollow' : 'index,follow,max-image-preview:large' ?>">
  <?php if ($canonicalUrl !== ''): ?><link rel="canonical" href="<?= e($canonicalUrl) ?>"><?php endif; ?>
  <meta property="og:type" content="<?= e($og_type ?? 'website') ?>">
  <meta property="og:site_name" content="<?= e($siteTitle) ?>">
  <meta property="og:title" content="<?= e($pageTitle) ?>">
  <meta property="og:description" content="<?= e($metaDescription) ?>">
  <?php if ($canonicalUrl !== ''): ?><meta property="og:url" content="<?= e($canonicalUrl) ?>"><?php endif; ?>
  <?php if ($ogImage !== ''): ?><meta property="og:image" content="<?= e($ogImage) ?>"><?php endif; ?>
  <meta name="twitter:card" content="<?= $ogImage !== '' ? 'summary_large_image' : 'summary' ?>">
  <link rel="icon" href="<?= e(asset_url('img/favicon.svg')) ?>" type="image/svg+xml">
  <link rel="stylesheet" href="<?= e(asset_url('css/style.css')) ?>">
  <link rel="stylesheet" href="<?= e(asset_url('css/dynamic.css')) ?>">
  <style>:root{--primary:<?= e($primaryColor) ?>;--accent:<?= e($accentColor) ?>}</style>
  <script>window.DOMAINFIT_SITE_CONFIG = { generatorControlsMode: <?= json_encode($generatorMode) ?> }; window.DOMAINFIT_CONFIG = { basePath: <?= json_encode(app_base_path()) ?>, analyticsEnabled: <?= json_encode($analyticsEnabled) ?> };</script>
  <?php if ($ga4Enabled): ?>
  <script async src="https://www.googletagmanager.com/gtag/js?id=<?= e($ga4Id) ?>"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',<?= json_encode($ga4Id) ?>);</script>
  <?php endif; ?>
  <?php if ($gtmEnabled): ?>
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!=='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',<?= json_encode($gtmId) ?>);</script>
  <?php endif; ?>
  <?php if (isset($structured_data) && is_array($structured_data)): ?><script type="application/ld+json"><?= json_encode($structured_data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script><?php endif; ?>
  <script src="<?= e(asset_url('js/main.js')) ?>" defer></script>
  <script src="<?= e(asset_url('js/dynamic-cms.js')) ?>" defer></script>
  <?php if ($customHeadCode !== ''): ?><?= $customHeadCode ?><?php endif; ?>
  <?php if (function_exists('df_do_action')) df_do_action('public.head', $pdo, ['title' => $pageTitle, 'canonical_url' => $canonicalUrl]); ?>
</head>
<body id="top">
<?php if (function_exists('df_do_action')) df_do_action('public.body.start', $pdo); ?>
<?php if ($gtmEnabled): ?><noscript><iframe src="https://www.googletagmanager.com/ns.html?id=<?= e($gtmId) ?>" height="0" width="0" style="display:none;visibility:hidden" title="Tag Manager"></iframe></noscript><?php endif; ?>
<a class="skip-link" href="#main-content">Skip to content</a>
<header class="site-header"><div class="container header-inner">
  <a class="brand" href="<?= e(app_url('')) ?>" aria-label="<?= e($siteTitle) ?> home">
    <?php if ($logoPath !== ''): ?><img src="<?= e($logoPath) ?>" width="38" height="38" alt="<?= e($siteTitle) ?> logo"><?php else: ?><img src="<?= e(asset_url('img/logo.svg')) ?>" width="38" height="38" alt="<?= e($siteTitle) ?> logo"><?php endif; ?>
    <span><?= e($siteTitle) ?></span>
  </a>
  <button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="site-navigation" aria-label="Open navigation"><span></span><span></span><span></span></button>
  <nav class="site-nav" id="site-navigation" aria-label="Main navigation">
    <?php foreach ($navItems as $item): ?><a href="<?= e(site_href((string) $item['href'])) ?>"><?= e($item['label']) ?></a><?php endforeach; ?>
  </nav>
  <div class="header-actions">
    <a class="button button-small button-primary" href="<?= e(app_url('tools/domain-generator')) ?>">Start generating <span aria-hidden="true">↓</span></a>
    <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch theme" title="Switch theme"><span aria-hidden="true">◐</span></button>
  </div>
</div></header>
