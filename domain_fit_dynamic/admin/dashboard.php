<?php
require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
admin_require_permission($pdo, $admin, 'view_dashboard');
$counts = [];
$counts['published_posts'] = (int) $pdo->query("SELECT COUNT(*) FROM blog_posts WHERE status='published' AND published_at <= UTC_TIMESTAMP()")->fetchColumn();
$counts['draft_posts'] = (int) $pdo->query("SELECT COUNT(*) FROM blog_posts WHERE status IN ('draft','review','scheduled')")->fetchColumn();
$counts['pages'] = (int) $pdo->query("SELECT COUNT(*) FROM site_pages WHERE status='published'")->fetchColumn();
$counts['unread_contacts'] = (int) $pdo->query("SELECT COUNT(*) FROM contact_messages WHERE status='unread'")->fetchColumn();
$counts['page_views_7d'] = (int) $pdo->query("SELECT COUNT(*) FROM site_events WHERE event_type='page_view' AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)")->fetchColumn();
$counts['generator_runs_7d'] = (int) $pdo->query("SELECT COUNT(*) FROM site_events WHERE event_type='generator_run' AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)")->fetchColumn();
$counts['affiliate_clicks_7d'] = (int) $pdo->query("SELECT COUNT(*) FROM affiliate_clicks WHERE clicked_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)")->fetchColumn();
$siteAnalyticsEnabled = (bool) setting($pdo, 'site_analytics_enabled', false);
$daily = $pdo->query("SELECT DATE(created_at) AS event_day, SUM(event_type='page_view') AS page_views, SUM(event_type='generator_run') AS generator_runs FROM site_events WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY) GROUP BY DATE(created_at) ORDER BY event_day")->fetchAll();
admin_header($pdo, $admin, 'Dashboard');
?>
<div class="admin-stats">
  <article class="admin-stat"><span>Published articles</span><strong><?= number_format($counts['published_posts']) ?></strong><small>Currently public</small></article>
  <article class="admin-stat"><span>Draft / review</span><strong><?= number_format($counts['draft_posts']) ?></strong><small>Includes gated editorial days</small></article>
  <article class="admin-stat"><span>Unread contacts</span><strong><?= number_format($counts['unread_contacts']) ?></strong><small><a href="<?= e(app_url('admin/contact.php')) ?>">Open inbox</a></small></article>
  <article class="admin-stat"><span>Published pages</span><strong><?= number_format($counts['pages']) ?></strong><small>Custom CMS pages</small></article>
</div>
<div class="admin-stats">
  <article class="admin-stat"><span>Page views · 7 days</span><strong><?= number_format($counts['page_views_7d']) ?></strong><small><?= $siteAnalyticsEnabled ? 'First-party event collection is on' : 'First-party event collection is off' ?></small></article>
  <article class="admin-stat"><span>Generator runs · 7 days</span><strong><?= number_format($counts['generator_runs_7d']) ?></strong><small>Aggregate events only</small></article>
  <article class="admin-stat"><span>Affiliate redirects · 7 days</span><strong><?= number_format($counts['affiliate_clicks_7d']) ?></strong><small>Ad clicks are never tracked here</small></article>
  <article class="admin-stat"><span>Database status</span><strong>Connected</strong><small>PDO prepared statements enabled</small></article>
</div>
<div class="admin-columns">
  <section class="admin-card"><h2>Recent site activity</h2>
    <?php if (!$siteAnalyticsEnabled): ?><p>First-party analytics is currently disabled. Enable it in <a href="<?= e(app_url('admin/settings.php')) ?>">Site settings</a> only after reviewing your privacy notice and local requirements.</p><?php elseif (!$daily): ?><p>No event data yet. Page-view and generator-run counts are approximate aggregate metrics.</p><?php else: ?>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date (UTC)</th><th>Page views</th><th>Generator runs</th></tr></thead><tbody><?php foreach ($daily as $row): ?><tr><td><?= e($row['event_day']) ?></td><td><?= number_format((int) $row['page_views']) ?></td><td><?= number_format((int) $row['generator_runs']) ?></td></tr><?php endforeach; ?></tbody></table></div><?php endif; ?>
  </section>
  <section class="admin-card"><h2>Setup checklist</h2><ul><li>Set the database and secret environment variables.</li><li>Review the imported 32 published guides and day 31–50 drafts.</li><li>Set the production site origin and update the privacy/legal content.</li><li>Keep analytics and ad integrations off until IDs and notices are configured.</li><li>Back up the MySQL database and uploaded logo/hero images.</li></ul></section>
</div>
<?php admin_footer(); ?>
