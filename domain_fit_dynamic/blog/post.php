<?php
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/public-content.php';
require_once __DIR__ . '/../includes/ads-helper.php';
$pdo = db();
$slug = strtolower(trim(request_string($_GET, 'slug')));
if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug)) not_found_page($pdo);
$query = $pdo->prepare("SELECT * FROM blog_posts WHERE slug=:slug AND status='published' AND published_at <= UTC_TIMESTAMP() LIMIT 1");
$query->execute(['slug' => $slug]);
$post = $query->fetch();
if (!$post) not_found_page($pdo);
$tags = json_decode((string) $post['tags_json'], true);
$tags = is_array($tags) ? $tags : [];
$page_title = trim((string) $post['seo_title']) ?: ((string) $post['title'] . ' | ' . setting($pdo, 'site_title', 'DomainFits'));
$page_description = trim((string) $post['seo_description']) ?: (string) $post['excerpt'];
$canonical_url = trim((string) $post['canonical_url']) ?: 'blog/' . $post['slug'];
$og_type = 'article';
$og_image = trim((string) $post['og_image']) ?: (string) $post['featured_image'];
$articleUrl = absolute_public_url(app_url('blog/' . $post['slug']));
$authorName = (string) setting($pdo, 'site_author', 'DomainFits Editorial');
$structured_data = [
    '@context' => 'https://schema.org',
    '@type' => $post['schema_type'] === 'Article' ? 'Article' : 'BlogPosting',
    'headline' => $post['title'],
    'description' => $page_description,
    'datePublished' => $post['published_at'] ? gmdate(DATE_ATOM, strtotime($post['published_at'])) : null,
    'dateModified' => gmdate(DATE_ATOM, strtotime($post['updated_at'])),
    'author' => ['@type' => 'Organization', 'name' => $authorName],
    'publisher' => ['@type' => 'Organization', 'name' => setting($pdo, 'site_title', 'DomainFits')],
    'mainEntityOfPage' => $articleUrl,
];
if ($og_image !== '') {
    $structured_data['image'] = [public_image_url($og_image) !== '' ? absolute_public_url(public_image_url($og_image)) : $og_image];
}
$bodyHtml = (string) $post['body_html'];
$bodyHtml = preg_replace('~<header\b[^>]*>[\s\S]*?</header>~i', '', $bodyHtml, 1) ?? $bodyHtml;
$image = public_image_url((string) $post['featured_image']);
require __DIR__ . '/../includes/header.php';
?>
<?= render_ad_slot($pdo, 'header_banner') ?>
<main id="main-content" class="page-main article-main">
  <div class="container breadcrumbs"><a href="<?= e(app_url('')) ?>">Home</a><span aria-hidden="true">/</span><a href="<?= e(app_url('blog/')) ?>">Blog</a><span aria-hidden="true">/</span><span><?= e($post['title']) ?></span></div>
  <article class="container article-shell">
    <header class="article-page-header"><p class="eyebrow"><?= e($post['category']) ?><?= $post['published_at'] ? ' · ' . e(format_public_date($post['published_at'])) : '' ?></p><h1><?= e($post['title']) ?></h1><p class="article-excerpt"><?= e($post['excerpt']) ?></p>
      <?php if ($tags): ?><div class="article-tags" aria-label="Article tags"><?php foreach ($tags as $tag): ?><span><?= e($tag) ?></span><?php endforeach; ?></div><?php endif; ?>
      <?php if ($image !== ''): ?><img class="article-featured-image" src="<?= e($image) ?>" alt="<?= e($post['featured_image_alt']) ?>" loading="eager"><?php endif; ?>
    </header>
    <div class="article-reading-layout"><div class="article-body cms-rich-content"><?= public_content($bodyHtml) ?></div><aside class="article-sidebar"><h2>Explore next</h2><a href="<?= e(app_url('tools/domain-generator')) ?>">Try the domain generator</a><a href="<?= e(app_url('blog/')) ?>">Browse all guides</a><a href="<?= e(app_url('pages/disclaimer')) ?>">Editorial disclaimer</a><hr><p>Domain availability, pricing and legal status are not checked by this site.</p></aside></div>
    <section class="article-end-cta"><h2>Build a shortlist, then verify every name.</h2><p>Use the generator for brainstorming and check registration, pricing and legal details independently.</p><a class="button button-primary" href="<?= e(app_url('tools/domain-generator')) ?>">Explore domain ideas <span aria-hidden="true">→</span></a></section>
  </article>
  <?= render_ad_slot($pdo, 'blog_in_article') ?>
</main>
<?php require __DIR__ . '/../includes/footer.php'; ?>
