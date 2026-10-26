<?php
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/public-content.php';
require_once __DIR__ . '/../includes/ads-helper.php';
$pdo = db();
start_app_session();
$query = $pdo->prepare("SELECT * FROM site_pages WHERE slug='contact' AND status='published' LIMIT 1");
$query->execute();
$page = $query->fetch() ?: ['title' => 'Contact DomainFits', 'excerpt' => 'Send a question, technical issue, correction or privacy request.', 'content_html' => '<p>Send a correction, report a technical issue, or ask a question about DomainFits. Please do not include sensitive personal or financial information.</p>', 'seo_title' => '', 'seo_description' => '', 'canonical_url' => '', 'og_image' => '', 'noindex' => 0];
$page_title = trim((string) $page['seo_title']) ?: ((string) $page['title'] . ' | ' . setting($pdo, 'site_title', 'DomainFits'));
$page_description = trim((string) $page['seo_description']) ?: (string) $page['excerpt'];
$canonical_url = trim((string) $page['canonical_url']) ?: 'contact';
$og_image = (string) $page['og_image'];
$noindex = (bool) $page['noindex'];
$successMessage = flash('contact_success');
$errorMessage = flash('contact_error');
$structured_data = ['@context' => 'https://schema.org', '@type' => 'ContactPage', 'name' => $page['title'], 'url' => absolute_public_url(app_url('contact'))];
require __DIR__ . '/../includes/header.php';
?>
<?= render_ad_slot($pdo, 'header_banner') ?>
<main id="main-content" class="page-main contact-main">
  <section class="container page-heading"><p class="eyebrow">Get in touch</p><h1><?= e($page['title']) ?></h1><p><?= e($page['excerpt']) ?></p></section>
  <section class="container contact-grid">
    <div class="contact-card"><h2>Send a message</h2><p class="form-help">Required fields are marked. Please do not include sensitive personal or financial information.</p>
      <?php if ($successMessage): ?><div class="notice notice-success" role="status"><?= e($successMessage) ?></div><?php endif; ?>
      <?php if ($errorMessage): ?><div class="notice notice-error" role="alert"><?= e($errorMessage) ?></div><?php endif; ?>
      <form class="contact-form" id="contact-form" data-cms-contact-form data-endpoint="<?= e(app_url('api/contact')) ?>" action="<?= e(app_url('api/contact')) ?>" method="post">
        <?= csrf_field() ?>
        <div class="honeypot" aria-hidden="true"><label for="companyWebsite">Leave this field empty</label><input id="companyWebsite" name="company_website" type="text" tabindex="-1" autocomplete="off"></div>
        <div class="field"><label for="contactName">Name <span aria-hidden="true">*</span></label><input id="contactName" name="name" type="text" autocomplete="name" maxlength="100" required></div>
        <div class="field"><label for="contactEmail">Email address <span aria-hidden="true">*</span></label><input id="contactEmail" name="email" type="email" autocomplete="email" maxlength="254" required></div>
        <div class="field"><label for="contactTopic">Topic <span aria-hidden="true">*</span></label><select id="contactTopic" name="topic" required><option value="" selected disabled>Choose a topic</option><option>General question</option><option>Technical issue</option><option>Correction or feedback</option><option>Privacy request</option></select></div>
        <div class="field"><label for="contactMessage">Message <span aria-hidden="true">*</span></label><textarea id="contactMessage" name="message" minlength="10" maxlength="5000" required></textarea></div>
        <p class="form-help">Messages are stored in the site’s CMS inbox. No automatic email is sent. See the <a href="<?= e(app_url('privacy-policy')) ?>">Privacy Policy</a>.</p>
        <button class="button button-primary" type="submit">Send message <span aria-hidden="true">→</span></button><p class="form-status" data-form-status aria-live="polite"></p>
      </form>
    </div>
    <aside class="contact-aside"><h2>Before you send</h2><p>For a technical issue, mention the page and steps that caused it. For a correction, include the section and a reliable source if available. For a privacy request, include only the details needed to identify your request.</p><div class="cms-rich-content"><?= public_content((string) $page['content_html']) ?></div><p>For information about this project, visit <a href="<?= e(app_url('about')) ?>">About DomainFits</a>.</p></aside>
  </section>
</main>
<?php require __DIR__ . '/../includes/footer.php'; ?>
