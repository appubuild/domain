<?php
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/cache.php';
require_once __DIR__ . '/../includes/public-content.php';
require_once __DIR__ . '/../includes/ads-helper.php';
$pdo = db();
$search = trim(substr(request_string($_GET, 'q'), 0, 100));
$category = trim(substr(request_string($_GET, 'category'), 0, 120));
$pageNumber = max(1, min(500, (int) request_string($_GET, 'page', '1')));
$perPage = 12;
$filtersActive = $search !== '' || $category !== '' || $pageNumber > 1;
$page_title = 'Blog: domain names, naming and website guides | ' . setting($pdo, 'site_title', 'DomainFits');
$page_description = 'Practical guides to domain names, DNS, hosting, naming, and website operations.';
$canonical_url = $filtersActive ? '' : 'blog/';
$noindex = $filtersActive;
$relationalCategoriesReady = false;
try {
    $categories = $pdo->query("SELECT DISTINCT c.name FROM categories c JOIN blog_post_categories pc ON pc.category_id=c.id JOIN blog_posts p ON p.id=pc.post_id WHERE p.status='published' AND p.published_at <= UTC_TIMESTAMP() ORDER BY c.name")->fetchAll(PDO::FETCH_COLUMN);
    $relationalCategoriesReady = true;
} catch (Throwable $error) {
    error_log('Relational blog categories unavailable; using legacy values: ' . $error->getMessage());
    $categories = [];
}
if (!$categories) $categories = $pdo->query("SELECT DISTINCT category FROM blog_posts WHERE status='published' AND published_at <= UTC_TIMESTAMP() AND category <> '' ORDER BY category")->fetchAll(PDO::FETCH_COLUMN);
$cacheKey = 'blog_index_' . hash('sha256', json_encode([$search, $category, $pageNumber]));
$data = cache_get($cacheKey);
if (!is_array($data)) {
    $where = "status='published' AND published_at <= UTC_TIMESTAMP()";
    $params = [];
    if ($category !== '') {
        if ($relationalCategoriesReady) {
            $where .= ' AND (category = :category_legacy OR EXISTS (SELECT 1 FROM blog_post_categories pc JOIN categories c ON c.id=pc.category_id WHERE pc.post_id=blog_posts.id AND c.name=:category_relational))';
            $params['category_legacy'] = $category;
            $params['category_relational'] = $category;
        } else {
            $where .= ' AND category = :category';
            $params['category'] = $category;
        }
    }
    if ($search !== '') {
        $where .= ' AND (title LIKE :title_query OR excerpt LIKE :excerpt_query)';
        $queryValue = '%' . str_replace(['%','_'], ['\\%','\\_'], $search) . '%';
        $params['title_query'] = $queryValue;
        $params['excerpt_query'] = $queryValue;
    }
    $countQuery = $pdo->prepare("SELECT COUNT(*) FROM blog_posts WHERE $where");
    $countQuery->execute($params);
    $total = (int) $countQuery->fetchColumn();
    $offset = ($pageNumber - 1) * $perPage;
    $postsQuery = $pdo->prepare("SELECT slug,title,excerpt,category,tags_json,featured_image,featured_image_alt,published_at FROM blog_posts WHERE $where ORDER BY is_featured DESC,published_at DESC,id DESC LIMIT $perPage OFFSET $offset");
    $postsQuery->execute($params);
    $data = ['total' => $total, 'posts' => $postsQuery->fetchAll()];
    cache_set($cacheKey, $data, 180);
}
$totalPages = max(1, (int) ceil(((int) $data['total']) / $perPage));
$structured_data = [
    '@context' => 'https://schema.org',
    '@type' => 'CollectionPage',
    'name' => 'DomainFits blog',
    'description' => $page_description,
    'url' => absolute_public_url(app_url('blog/')),
];
require __DIR__ . '/../includes/header.php';
?>
<?= render_ad_slot($pdo, 'header_banner') ?>
<main id="main-content" class="page-main blog-main">
  <section class="container page-heading blog-heading"><p class="eyebrow">The DomainFits library</p><h1>Domain and naming guides</h1><p>Clear, practical context for exploring names, domains, DNS and the systems behind websites.</p></section>
  <section class="container blog-filters" aria-label="Search and filter articles">
    <form class="blog-filter-form" method="get" action="<?= e(app_url('blog/')) ?>">
      <label class="blog-search"><span class="visually-hidden">Search articles</span><input type="search" name="q" value="<?= e($search) ?>" maxlength="100" placeholder="Search guides…"><button class="button button-primary" type="submit">Search</button></label>
      <label class="blog-category-select"><span class="visually-hidden">Filter by category</span><select name="category" onchange="this.form.submit()"><option value="">All topics</option><?php foreach ($categories as $availableCategory): ?><option value="<?= e($availableCategory) ?>" <?= $category === $availableCategory ? 'selected' : '' ?>><?= e($availableCategory) ?></option><?php endforeach; ?></select></label>
    </form>
    <?php if ($search !== '' || $category !== ''): ?><a class="text-link" href="<?= e(app_url('blog/')) ?>">Clear filters</a><?php endif; ?>
  </section>
  <section class="container section-tight" aria-label="Articles">
    <p class="blog-result-count"><?= number_format((int) $data['total']) ?> <?= (int) $data['total'] === 1 ? 'guide' : 'guides' ?><?= $search !== '' ? ' matching “' . e($search) . '”' : '' ?></p>
    <?php if ($data['posts']): ?><div class="cms-post-grid">
      <?php foreach ($data['posts'] as $post): $image = public_image_url((string) $post['featured_image']); ?>
      <article class="cms-post-card">
        <a class="cms-post-image" href="<?= e(app_url('blog/' . $post['slug'])) ?>" aria-label="Read <?= e($post['title']) ?>">
          <?php if ($image !== ''): ?><img src="<?= e($image) ?>" alt="<?= e($post['featured_image_alt']) ?>" loading="lazy"><?php else: ?><span class="post-placeholder" aria-hidden="true">DF</span><?php endif; ?>
        </a>
        <div class="cms-post-card-body"><p class="eyebrow"><?= e($post['category']) ?> · <?= e(format_public_date($post['published_at'])) ?></p><h2><a href="<?= e(app_url('blog/' . $post['slug'])) ?>"><?= e($post['title']) ?></a></h2><p><?= e($post['excerpt']) ?></p><a class="text-link" href="<?= e(app_url('blog/' . $post['slug'])) ?>">Read guide <span aria-hidden="true">→</span></a></div>
      </article>
      <?php endforeach; ?>
    </div><?php else: ?><div class="empty-state"><h2>No guides found</h2><p>Try a different phrase or clear the current filters.</p></div><?php endif; ?>
    <?= render_ad_slot($pdo, 'blog_in_article') ?>
    <?php if ($totalPages > 1): ?><nav class="pagination" aria-label="Blog pages">
      <?php if ($pageNumber > 1): $query = array_filter(['q'=>$search,'category'=>$category,'page'=>$pageNumber-1], static fn($v) => $v !== '' && $v !== null); ?><a href="<?= e(app_url('blog/') . '?' . http_build_query($query)) ?>" rel="prev">← Previous</a><?php endif; ?>
      <span>Page <?= $pageNumber ?> of <?= $totalPages ?></span>
      <?php if ($pageNumber < $totalPages): $query = array_filter(['q'=>$search,'category'=>$category,'page'=>$pageNumber+1], static fn($v) => $v !== '' && $v !== null); ?><a href="<?= e(app_url('blog/') . '?' . http_build_query($query)) ?>" rel="next">Next →</a><?php endif; ?>
    </nav><?php endif; ?>
  </section>
</main>
<?php require __DIR__ . '/../includes/footer.php'; ?>
