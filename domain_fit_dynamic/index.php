<?php
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/cache.php';
require_once __DIR__ . '/includes/public-content.php';
require_once __DIR__ . '/includes/ads-helper.php';
$pdo = db();
$requestPath = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/');
$basePath = app_base_path();
if ($basePath !== '' && ($requestPath === $basePath || str_starts_with($requestPath, $basePath . '/'))) $requestPath = substr($requestPath, strlen($basePath)) ?: '/';
if (!in_array($requestPath, ['/', '/index.php', '/index.html'], true)) not_found_page($pdo);
$page_title = (string) setting($pdo, 'site_title', 'DomainFits') . ' — Domain name ideas that fit';
$page_description = (string) setting($pdo, 'site_description', 'Explore domain-name ideas and naming guides. Availability and legal status are not checked.');
$canonical_url = 'index.php';
$heroTitle = (string) setting($pdo, 'hero_title', 'Find a name that fits what you are building.');
$heroSubtitle = (string) setting($pdo, 'hero_subtitle', 'Explore domain-name combinations, save a shortlist, and verify promising ideas independently.');
$heroCta = (string) setting($pdo, 'hero_cta', 'Generate domain ideas');
$heroSecondary = (string) setting($pdo, 'hero_secondary', 'Read the guides');
$heroImage = public_image_url((string) setting($pdo, 'hero_image_path', ''));
$posts = cache_get('home_latest_posts_v1');
if (!is_array($posts)) {
    $query = $pdo->query("SELECT slug,title,excerpt,category,featured_image,featured_image_alt,published_at FROM blog_posts WHERE status='published' AND published_at <= UTC_TIMESTAMP() ORDER BY is_featured DESC,published_at DESC,id DESC LIMIT 6");
    $posts = $query->fetchAll();
    cache_set('home_latest_posts_v1', $posts, 300);
}
$structured_data = [
    '@context' => 'https://schema.org',
    '@type' => 'WebSite',
    'name' => setting($pdo, 'site_title', 'DomainFits'),
    'description' => $page_description,
    'url' => absolute_public_url(app_url('')),
];
require __DIR__ . '/includes/header.php';
?>
<?= render_ad_slot($pdo, 'header_banner') ?>
<main id="main-content" class="page-main home-main">
  <section class="container hero-section">
    <div class="hero-copy">
      <p class="eyebrow">Name exploration, made practical</p>
      <h1><?= e($heroTitle) ?></h1>
      <p class="hero-lede"><?= e($heroSubtitle) ?></p>
      <form class="hero-quick-form" action="<?= e(app_url('tools/domain-generator')) ?>" method="get">
        <label class="visually-hidden" for="heroRoot">Enter a keyword</label>
        <input id="heroRoot" name="root" type="text" maxlength="40" placeholder="Try a word like Bloom, Pay or Cloud" autocomplete="off">
        <button class="button button-primary" type="submit"><?= e($heroCta) ?> <span aria-hidden="true">→</span></button>
      </form>
      <div class="hero-secondary"><a href="<?= e(app_url('blog/')) ?>"><?= e($heroSecondary) ?> <span aria-hidden="true">↗</span></a><span>Suggestions are ideas, not live availability results.</span></div>
    </div>
    <div class="hero-art <?= $heroImage !== '' ? 'has-hero-image' : '' ?>">
      <?php if ($heroImage !== ''): ?><img src="<?= e($heroImage) ?>" alt="" loading="eager"><?php else: ?>
        <div class="hero-orbit hero-orbit-one"></div><div class="hero-orbit hero-orbit-two"></div><div class="hero-orbit hero-orbit-three"></div>
        <div class="name-chip name-chip-main"><span class="chip-dot"></span>Bloom<span class="chip-light">ly</span><small>.com</small></div>
        <div class="name-chip name-chip-a">◈ &nbsp; NEXORA <small>.io</small></div><div class="name-chip name-chip-b">◆ &nbsp; CloudMint <small>.com</small></div>
        <div class="hero-spark hero-spark-a">✦</div><div class="hero-spark hero-spark-b">✳</div><div class="hero-spark hero-spark-c">·</div>
      <?php endif; ?>
    </div>
  </section>
  <?= render_ad_slot($pdo, 'generator_inline') ?>
  <section class="container home-feature-grid" aria-label="How DomainFits helps">
    <article class="home-feature-card"><span class="feature-icon">✳</span><h2>Start with a useful root</h2><p>Explore short and descriptive word combinations around an idea, product or audience.</p></article>
    <article class="home-feature-card"><span class="feature-icon">◈</span><h2>Shape a shortlist</h2><p>Filter by partner length, placement and naming style, then copy or export ideas.</p></article>
    <article class="home-feature-card"><span class="feature-icon">✓</span><h2>Verify before use</h2><p>Check domain registration, pricing, existing businesses and relevant trademarks independently.</p></article>
  </section>
  <section class="container home-generator-promo"><div><p class="eyebrow">Free naming tool</p><h2>Make room for better possibilities.</h2><p>Use the local word bank or allow creative syllables. No account is needed to brainstorm.</p></div><a class="button button-primary" href="<?= e(app_url('tools/domain-generator')) ?>">Open the generator <span aria-hidden="true">→</span></a></section>
  <section class="container home-latest section-tight" aria-labelledby="latest-title">
    <div class="section-heading"><div><p class="eyebrow">From the library</p><h2 id="latest-title">Naming and domain guides</h2></div><a class="text-link" href="<?= e(app_url('blog/')) ?>">View all articles <span aria-hidden="true">↗</span></a></div>
    <?php if ($posts): ?><div class="cms-post-grid">
      <?php foreach ($posts as $post): $image = public_image_url((string) $post['featured_image']); ?>
      <article class="cms-post-card">
        <a class="cms-post-image" href="<?= e(app_url('blog/' . $post['slug'])) ?>" aria-label="Read <?= e($post['title']) ?>">
          <?php if ($image !== ''): ?><img src="<?= e($image) ?>" alt="<?= e($post['featured_image_alt']) ?>" loading="lazy"><?php else: ?><span class="post-placeholder" aria-hidden="true">DF</span><?php endif; ?>
        </a>
        <div class="cms-post-card-body"><p class="eyebrow"><?= e($post['category']) ?> · <?= e(format_public_date($post['published_at'])) ?></p><h3><a href="<?= e(app_url('blog/' . $post['slug'])) ?>"><?= e($post['title']) ?></a></h3><p><?= e($post['excerpt']) ?></p><a class="text-link" href="<?= e(app_url('blog/' . $post['slug'])) ?>">Read guide <span aria-hidden="true">→</span></a></div>
      </article>
      <?php endforeach; ?>
    </div><?php else: ?><div class="empty-state">Published guides will appear here.</div><?php endif; ?>
  </section>
  <section class="container trust-note"><div class="trust-icon">!</div><div><strong>Important:</strong> Generator results do not confirm domain availability, registrar prices, business-name status or trademark rights. Review each name with the relevant registrars and authorities before using it.</div></section>
</main>
<?php require __DIR__ . '/includes/footer.php'; ?>
