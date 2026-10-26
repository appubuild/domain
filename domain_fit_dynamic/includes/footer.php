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
    error_log('Footer navigation query failed: ' . $error->getMessage());
    $footerGroups = [];
}
$footerCopy = (string) setting($pdo, 'footer_text', 'Thoughtful domain ideas for what comes next.');
$copyright = trim((string) setting($pdo, 'copyright_text', '')) ?: ('© ' . date('Y') . ' ' . setting($pdo, 'site_title', 'DomainFits') . '. All rights reserved.');
$footerColumnsClass = count($footerGroups) > 2 ? ' blog-footer-main' : '';
$customFooterCode = private_setting($pdo, 'custom_footer_code', '');
$customFooterCode = is_string($customFooterCode) && strlen($customFooterCode) <= 20000 ? $customFooterCode : '';
?>
<?= render_ad_slot($pdo, 'footer_banner') ?>
<footer class="site-footer" aria-label="Site footer">
  <div class="container footer-main<?= e($footerColumnsClass) ?>">
    <div class="footer-brand-block">
      <a class="brand brand-footer" href="<?= e(app_url('')) ?>">
        <img src="<?= e($logoPath !== '' ? $logoPath : asset_url('img/logo.svg')) ?>" width="38" height="38" alt="">
        <span><?= e(setting($pdo, 'site_title', 'DomainFits')) ?></span>
      </a>
      <p><?= e($footerCopy) ?></p>
    </div>
    <?php if ($footerGroups): foreach ($footerGroups as $group => $items): ?>
      <nav class="footer-links-group" aria-label="<?= e($group) ?>">
        <h2><?= e($group) ?></h2>
        <?php foreach ($items as $item): ?>
          <a href="<?= e(site_href((string) $item['href'])) ?>"><?= e($item['label']) ?></a>
        <?php endforeach; ?>
      </nav>
    <?php endforeach; else: ?>
      <nav class="footer-links-group" aria-label="Explore">
        <h2>Explore</h2>
        <a href="<?= e(app_url('tools/domain-generator')) ?>">Domain generator</a>
        <a href="<?= e(app_url('blog/')) ?>">Blog</a>
      </nav>
      <nav class="footer-links-group" aria-label="Company">
        <h2>Company</h2>
        <a href="<?= e(app_url('about')) ?>">About</a>
        <a href="<?= e(app_url('contact')) ?>">Contact</a>
        <a href="<?= e(app_url('privacy-policy')) ?>">Privacy policy</a>
      </nav>
    <?php endif; ?>
  </div>
  <div class="container footer-bottom">
    <p><?= e($copyright) ?></p>
    <a href="#top">Back to top <span aria-hidden="true">↑</span></a>
  </div>
</footer>
<?php if ($customFooterCode !== ''): ?><?= $customFooterCode ?><?php endif; ?>
</body>
</html>
