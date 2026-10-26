<?php
require_once __DIR__ . '/ads-helper.php';
$footerGroups = [];
try {
    $statement = $pdo->query("SELECT label, href, group_label FROM navigation_items WHERE menu_location = 'footer' AND is_active = 1 ORDER BY sort_order, id");
    foreach ($statement->fetchAll() as $item) {
        $group = trim((string) ($item['group_label'] ?? '')) ?: 'Explore';
        $footerGroups[$group][] = $item;
    }
} catch (Throwable $error) {
    $footerGroups = [];
}
$footerCopy = (string) setting($pdo, 'footer_text', 'Thoughtful domain ideas for what comes next.');
$copyright = trim((string) setting($pdo, 'copyright_text', '')) ?: ('© ' . date('Y') . ' ' . setting($pdo, 'site_title', 'DomainFits') . '. All rights reserved.');
?>
<?= render_ad_slot($pdo, 'footer_banner') ?>
<footer class="site-footer"><div class="container footer-top">
  <div class="footer-brand">
    <a class="brand" href="<?= e(app_url('index.php')) ?>"><img src="<?= e($logoPath !== '' ? $logoPath : asset_url('img/logo.svg')) ?>" width="38" height="38" alt=""><span><?= e(setting($pdo, 'site_title', 'DomainFits')) ?></span></a>
    <p><?= e($footerCopy) ?></p>
  </div>
  <?php if ($footerGroups): foreach ($footerGroups as $group => $items): ?>
    <div class="footer-links"><h2><?= e($group) ?></h2><?php foreach ($items as $item): ?><a href="<?= e(site_href((string) $item['href'])) ?>"><?= e($item['label']) ?></a><?php endforeach; ?></div>
  <?php endforeach; else: ?>
    <div class="footer-links"><h2>Explore</h2><a href="<?= e(app_url('tools/domain-generator')) ?>">Domain generator</a><a href="<?= e(app_url('blog/')) ?>">Blog</a></div>
    <div class="footer-links"><h2>Company</h2><a href="<?= e(app_url('pages/about')) ?>">About</a><a href="<?= e(app_url('pages/contact')) ?>">Contact</a><a href="<?= e(app_url('pages/privacy-policy')) ?>">Privacy policy</a></div>
  <?php endif; ?>
</div><div class="container footer-bottom"><p><?= e($copyright) ?></p><a href="#top">Back to top ↑</a></div></footer>
</body>
</html>
