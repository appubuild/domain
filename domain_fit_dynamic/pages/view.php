<?php
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/public-content.php';
require_once __DIR__ . '/../includes/ads-helper.php';
$pdo = db();
$slug = strtolower(trim(request_string($_GET, 'slug')));
if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug)) not_found_page($pdo);
$query = $pdo->prepare("SELECT * FROM site_pages WHERE slug=:slug AND status='published' LIMIT 1");
$query->execute(['slug' => $slug]);
$page = $query->fetch();
if (!$page) not_found_page($pdo);
$page_title = trim((string) $page['seo_title']) ?: ((string) $page['title'] . ' | ' . setting($pdo, 'site_title', 'DomainFits'));
$page_description = trim((string) $page['seo_description']) ?: (string) $page['excerpt'];
$shortPageSlugs = ['about', 'privacy-policy', 'terms-and-conditions', 'disclaimer'];
$pageRoute = in_array($slug, $shortPageSlugs, true) ? $slug : 'pages/' . $page['slug'];
$canonical_url = trim((string) $page['canonical_url']) ?: $pageRoute;
$og_image = (string) $page['og_image'];
$noindex = (bool) $page['noindex'];
$structured_data = [
    '@context' => 'https://schema.org',
    '@type' => 'WebPage',
    'name' => $page['title'],
    'description' => $page_description,
    'url' => absolute_public_url(app_url($pageRoute)),
];
require __DIR__ . '/../includes/header.php';
?>
<?= render_ad_slot($pdo, 'header_banner') ?>
<main id="main-content" class="page-main cms-page-main"><div class="container cms-page-content"><?= public_content((string) $page['content_html']) ?></div></main>
<?php require __DIR__ . '/../includes/footer.php'; ?>
