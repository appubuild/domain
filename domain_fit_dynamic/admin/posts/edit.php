<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/auth-check.php';
require_once __DIR__ . '/../../includes/admin-ui.php';
require_once __DIR__ . '/../../includes/public-content.php';
require_once __DIR__ . '/../../includes/analytics.php';
require_once __DIR__ . '/../../includes/cache.php';
admin_require_permission($pdo, $admin, 'manage_posts');

$id = filter_var(request_string($_GET, 'id', request_string($_POST, 'id')), FILTER_VALIDATE_INT) ?: 0;
$post = [
    'id' => 0, 'slug' => '', 'legacy_day' => null, 'title' => '', 'excerpt' => '', 'body_html' => '',
    'category' => '', 'tags_json' => '[]', 'featured_image' => '', 'featured_image_alt' => '',
    'seo_title' => '', 'seo_description' => '', 'canonical_url' => '', 'og_image' => '',
    'schema_type' => 'BlogPosting', 'status' => 'draft', 'published_at' => null, 'scheduled_at' => null,
    'is_featured' => 0, 'publication_reviewed' => 0,
];
if ($id) {
    $get = $pdo->prepare('SELECT * FROM blog_posts WHERE id=:id LIMIT 1');
    $get->execute(['id' => $id]);
    $post = $get->fetch() ?: null;
    if (!$post) { http_response_code(404); exit('Post not found.'); }
}

$categorySchemaReady = false;
$categories = [];
try {
    $categories = $pdo->query('SELECT id,name,slug FROM categories ORDER BY name')->fetchAll();
    $pdo->query('SELECT post_id,category_id FROM blog_post_categories LIMIT 0');
    $categorySchemaReady = true;
} catch (Throwable $error) {
    error_log('Relational post categories unavailable; showing legacy category input: ' . $error->getMessage());
    try {
        $legacyNames = $pdo->query("SELECT DISTINCT category FROM blog_posts WHERE category <> '' ORDER BY category")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($legacyNames as $name) $categories[] = ['id' => 0, 'name' => (string) $name, 'slug' => ''];
    } catch (Throwable $ignored) {
        $categories = [];
    }
}
$selectedCategoryIds = [];
if ($id && $categorySchemaReady) {
    try {
        $getCategories = $pdo->prepare('SELECT category_id FROM blog_post_categories WHERE post_id=:post');
        $getCategories->execute(['post' => $id]);
        $selectedCategoryIds = array_map('intval', $getCategories->fetchAll(PDO::FETCH_COLUMN));
    } catch (Throwable $error) {
        error_log('Post category links unavailable: ' . $error->getMessage());
    }
    if (!$selectedCategoryIds && (string) ($post['category'] ?? '') !== '') {
        foreach ($categories as $category) {
            if (strcasecmp((string) $category['name'], (string) $post['category']) === 0) {
                $selectedCategoryIds[] = (int) $category['id'];
                break;
            }
        }
    }
}

$errorMessage = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $title = trim(substr(strip_tags(request_string($_POST, 'title', '')), 0, 255));
    $slug = slugify(request_string($_POST, 'slug', $title));
    $excerpt = trim(substr(strip_tags(request_string($_POST, 'excerpt', '')), 0, 500));
    $tags = array_slice(array_values(array_unique(array_filter(array_map(
        static fn($tag): string => trim(substr(strip_tags((string) $tag), 0, 60)),
        preg_split('/[,\r\n]+/', request_string($_POST, 'tags', '')) ?: []
    )))), 0, 20);
    $bodyHtml = sanitize_rich_html(request_string($_POST, 'body_html', ''));
    $status = in_array(($_POST['status'] ?? 'draft'), ['draft','review','scheduled','published','archived'], true) ? (string) $_POST['status'] : 'draft';
    $seoTitle = trim(substr(strip_tags(request_string($_POST, 'seo_title', '')), 0, 255));
    $seoDescription = trim(substr(strip_tags(request_string($_POST, 'seo_description', '')), 0, 320));
    $canonicalUrl = trim(substr(request_string($_POST, 'canonical_url', ''), 0, 500));
    $ogImage = trim(substr(request_string($_POST, 'og_image', ''), 0, 500));
    $imageAlt = trim(substr(strip_tags(request_string($_POST, 'featured_image_alt', '')), 0, 255));
    $schemaType = in_array(($_POST['schema_type'] ?? 'BlogPosting'), ['BlogPosting','Article'], true) ? (string) $_POST['schema_type'] : 'BlogPosting';
    $isFeatured = isset($_POST['is_featured']) ? 1 : 0;
    $legacyDay = $post['legacy_day'] !== null ? (int) $post['legacy_day'] : null;
    $isGatedDay = $legacyDay !== null && $legacyDay >= 31 && $legacyDay <= 50;
    $reviewed = $isGatedDay && isset($_POST['publication_reviewed']);

    $selectedCategoryIds = [];
    $category = '';
    if ($categorySchemaReady) {
        $rawCategoryIds = is_array($_POST['category_ids'] ?? null) ? $_POST['category_ids'] : [];
        foreach ($rawCategoryIds as $rawId) {
            $parsed = filter_var($rawId, FILTER_VALIDATE_INT);
            if ($parsed !== false && $parsed > 0) $selectedCategoryIds[] = (int) $parsed;
        }
        $selectedCategoryIds = array_values(array_unique($selectedCategoryIds));
        if ($selectedCategoryIds) {
            $placeholders = [];
            $params = [];
            foreach ($selectedCategoryIds as $index => $categoryId) {
                $key = 'category_' . $index;
                $placeholders[] = ':' . $key;
                $params[$key] = $categoryId;
            }
            $lookup = $pdo->prepare('SELECT id,name FROM categories WHERE id IN (' . implode(',', $placeholders) . ') ORDER BY name');
            $lookup->execute($params);
            $selectedCategories = $lookup->fetchAll();
            if (count($selectedCategories) !== count($selectedCategoryIds)) {
                $errorMessage = 'One or more selected categories are no longer available. Refresh and try again.';
                $selectedCategoryIds = array_map('intval', array_column($selectedCategories, 'id'));
            }
            $category = (string) ($selectedCategories[0]['name'] ?? '');
        }
    } else {
        $category = trim(substr(strip_tags(request_string($_POST, 'category_legacy', '')), 0, 120));
    }

    $scheduledInput = trim(request_string($_POST, 'scheduled_at', ''));
    $scheduledAt = $scheduledInput === '' ? null : parse_datetime_local_utc($scheduledInput);
    if ($scheduledInput !== '' && $scheduledAt === null) $errorMessage = 'Enter a valid schedule date and time in UTC.';
    if ($status === 'scheduled' && $scheduledAt === null) $errorMessage = 'A valid schedule date and time is required for scheduled posts.';
    $publishedInput = trim(request_string($_POST, 'published_at', ''));
    $publishedAt = null;
    if ($status === 'published') {
        if ($publishedInput !== '') {
            $publishedAt = parse_datetime_local_utc($publishedInput);
            if ($publishedAt === null) $errorMessage = 'Enter a valid publication date and time in UTC.';
        } else {
            $publishedAt = gmdate('Y-m-d H:i:s');
        }
    }
    if ($canonicalUrl !== '' && !(str_starts_with($canonicalUrl, '/') && !str_starts_with($canonicalUrl, '//')) && (!filter_var($canonicalUrl, FILTER_VALIDATE_URL) || !in_array(strtolower((string) parse_url($canonicalUrl, PHP_URL_SCHEME)), ['http','https'], true))) {
        $errorMessage = 'Canonical URL must be a local path or a valid HTTP/HTTPS URL.';
    }
    if ($ogImage !== '' && !(str_starts_with($ogImage, '/') && !str_starts_with($ogImage, '//')) && (!filter_var($ogImage, FILTER_VALIDATE_URL) || strtolower((string) parse_url($ogImage, PHP_URL_SCHEME)) !== 'https')) {
        $errorMessage = 'OpenGraph image must be a local path or an HTTPS URL.';
    }
    if ($title === '' || $slug === '' || $bodyHtml === '') {
        $errorMessage = 'Title, a valid slug and article content are required.';
    }
    if ($isGatedDay && in_array($status, ['published','scheduled'], true) && !$reviewed) {
        $errorMessage = 'Editorial day 31–50 remains gated. Review the draft and explicitly clear the editorial gate before scheduling or publishing.';
    }
    if ($slug !== '') {
        $slugCheck = $pdo->prepare('SELECT id FROM blog_posts WHERE slug=:slug AND id<>:id LIMIT 1');
        $slugCheck->execute(['slug' => $slug, 'id' => $id]);
        if ($slugCheck->fetchColumn()) $errorMessage = 'That URL slug is already used by another post.';
    }

    $imagePath = (string) ($post['featured_image'] ?? '');
    if (isset($_POST['remove_featured_image'])) $imagePath = '';
    if ($errorMessage === '') {
        try {
            $uploadPath = save_uploaded_image('featured_image_file', 'uploads/blog');
            if ($uploadPath !== null) $imagePath = $uploadPath;
        } catch (Throwable $error) {
            $errorMessage = $error->getMessage();
        }
    }
    if ($errorMessage === '') {
        $ogImage = $ogImage !== '' ? $ogImage : $imagePath;
        $reviewedAt = $reviewed ? gmdate('Y-m-d H:i:s') : null;
        $reviewedBy = $reviewed ? (int) $admin['id'] : null;
        $wasExisting = $id > 0;
        try {
            $pdo->beginTransaction();
            $values = [
                'slug' => $slug, 'title' => $title, 'excerpt' => $excerpt, 'body_html' => $bodyHtml, 'category' => $category,
                'tags_json' => json_encode($tags, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'featured_image' => $imagePath,
                'featured_image_alt' => $imageAlt, 'seo_title' => $seoTitle, 'seo_description' => $seoDescription,
                'canonical_url' => $canonicalUrl, 'og_image' => $ogImage, 'schema_type' => $schemaType, 'status' => $status,
                'published_at' => $publishedAt, 'scheduled_at' => $status === 'scheduled' ? $scheduledAt : null,
                'is_featured' => $isFeatured, 'publication_reviewed' => $reviewed ? 1 : 0, 'publication_reviewed_at' => $reviewedAt,
                'publication_reviewed_by' => $reviewedBy, 'updated_by' => (int) $admin['id'],
            ];
            if ($id) {
                $values['id'] = $id;
                $save = $pdo->prepare('UPDATE blog_posts SET slug=:slug,title=:title,excerpt=:excerpt,body_html=:body_html,category=:category,tags_json=:tags_json,featured_image=:featured_image,featured_image_alt=:featured_image_alt,seo_title=:seo_title,seo_description=:seo_description,canonical_url=:canonical_url,og_image=:og_image,schema_type=:schema_type,status=:status,published_at=:published_at,scheduled_at=:scheduled_at,is_featured=:is_featured,publication_reviewed=:publication_reviewed,publication_reviewed_at=:publication_reviewed_at,publication_reviewed_by=:publication_reviewed_by,updated_by=:updated_by WHERE id=:id');
                $save->execute($values);
            } else {
                $values['created_by'] = (int) $admin['id'];
                $save = $pdo->prepare('INSERT INTO blog_posts (slug,title,excerpt,body_html,category,tags_json,featured_image,featured_image_alt,seo_title,seo_description,canonical_url,og_image,schema_type,status,published_at,scheduled_at,is_featured,publication_reviewed,publication_reviewed_at,publication_reviewed_by,created_by,updated_by) VALUES (:slug,:title,:excerpt,:body_html,:category,:tags_json,:featured_image,:featured_image_alt,:seo_title,:seo_description,:canonical_url,:og_image,:schema_type,:status,:published_at,:scheduled_at,:is_featured,:publication_reviewed,:publication_reviewed_at,:publication_reviewed_by,:created_by,:updated_by)');
                $save->execute($values);
                $id = (int) $pdo->lastInsertId();
            }
            if ($categorySchemaReady) {
                $delete = $pdo->prepare('DELETE FROM blog_post_categories WHERE post_id=:post');
                $delete->execute(['post' => $id]);
                $link = $pdo->prepare('INSERT INTO blog_post_categories (post_id,category_id) VALUES (:post,:category)');
                foreach ($selectedCategoryIds as $categoryId) $link->execute(['post' => $id, 'category' => $categoryId]);
            }
            audit_log($pdo, (int) $admin['id'], $wasExisting ? 'post.updated' : 'post.created', 'blog_post', (string) $id, 'Post saved.');
            $pdo->commit();
            cache_clear_all();
            flash('success', 'Post saved.');
            redirect_to('admin/posts/edit?id=' . $id);
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('Post save: ' . $error->getMessage());
            $errorMessage = 'The post could not be saved. Check the slug, image, migration status and database fields.';
        }
    }
    $post = array_merge($post, [
        'title' => $title, 'slug' => $slug, 'excerpt' => $excerpt, 'body_html' => $bodyHtml, 'category' => $category,
        'tags_json' => json_encode($tags), 'featured_image' => $imagePath, 'featured_image_alt' => $imageAlt,
        'seo_title' => $seoTitle, 'seo_description' => $seoDescription, 'canonical_url' => $canonicalUrl,
        'og_image' => $ogImage, 'schema_type' => $schemaType, 'status' => $status, 'published_at' => $publishedAt,
        'scheduled_at' => $scheduledAt, 'is_featured' => $isFeatured, 'publication_reviewed' => $reviewed ? 1 : 0,
    ]);
}

$tagsValue = json_decode((string) ($post['tags_json'] ?? '[]'), true);
$tagsValue = is_array($tagsValue) ? implode(', ', $tagsValue) : '';
$inputDate = static function (?string $date): string {
    $stamp = $date ? strtotime($date) : false;
    return $stamp ? gmdate('Y-m-d\\TH:i', $stamp) : '';
};
$isGatedDay = isset($post['legacy_day']) && (int) $post['legacy_day'] >= 31 && (int) $post['legacy_day'] <= 50;
$currentFeaturedImage = public_image_url((string) ($post['featured_image'] ?? ''));
admin_header($pdo, $admin, $id ? 'Edit post' : 'New post', ['vendor/quill/quill-2.0.3.snow.css']);
?>
<?php if ($errorMessage !== ''): ?><div class="notice notice-error" role="alert"><?= e($errorMessage) ?></div><?php endif; ?>
<?php if (!$categorySchemaReady): ?><div class="notice notice-warning" role="status">Relational categories are not migrated yet. The legacy category field remains available. Run <code>php scripts/migrate-enterprise-cms.php</code> from the CMS directory to enable ID-backed categories.</div><?php endif; ?>
<form class="admin-form admin-publish-form" method="post" enctype="multipart/form-data" action="<?= e(app_url('admin/posts/edit' . ($id ? '?id=' . $id : ''))) ?>" data-publish-form data-editor-image-endpoint="<?= e(app_url('admin/editor-image')) ?>">
  <?= csrf_field() ?><?php if ($id): ?><input type="hidden" name="id" value="<?= (int) $id ?>"><?php endif; ?>
  <div class="admin-publish-layout">
    <div class="admin-publish-main">
      <section class="admin-card admin-card--editor">
        <p class="admin-card-eyebrow">Editorial workspace</p>
        <div class="field post-title-field"><label for="title">Post title</label><input id="title" name="title" maxlength="255" required value="<?= e($post['title']) ?>" placeholder="Write a clear, reader-first title" data-slug-source data-seo-title-source></div>
        <div class="slug-editor-row"><div class="field"><label for="slug">Permalink</label><div class="slug-control"><span aria-hidden="true"><?= e(app_url('blog/')) ?></span><input id="slug" name="slug" maxlength="180" pattern="[a-z0-9]+(-[a-z0-9]+)*" required value="<?= e($post['slug']) ?>" data-slug-target data-slug-mode="<?= $id ? 'manual' : 'auto' ?>" <?= $id ? '' : 'readonly' ?>><button class="button button-small" type="button" data-slug-manual-toggle><?= $id ? 'Keep current URL' : 'Edit manually' ?></button></div><small data-slug-preview data-url-prefix="<?= e(app_url('blog/')) ?>"><?= e(app_url('blog/' . ($post['slug'] ?: 'your-post'))) ?></small></div></div>
        <div class="field"><label for="excerpt">Excerpt</label><textarea id="excerpt" name="excerpt" maxlength="500" rows="3" placeholder="A concise summary for cards and search previews."><?= e($post['excerpt']) ?></textarea><small>Up to 500 characters.</small></div>
        <div class="form-row">
          <?php if ($categorySchemaReady): ?><fieldset class="field category-picker"><legend>Categories</legend><div class="category-checklist" data-category-list><?php foreach ($categories as $categoryOption): ?><label class="category-check"><input type="checkbox" name="category_ids[]" value="<?= (int) $categoryOption['id'] ?>" <?= in_array((int) $categoryOption['id'], $selectedCategoryIds, true) ? 'checked' : '' ?>><span><?= e($categoryOption['name']) ?></span></label><?php endforeach; ?></div><button class="text-button" type="button" data-open-category-dialog>+ Add category</button><small>Pick one or more. The first alphabetical selection remains in the legacy primary-category field for older templates.</small></fieldset><?php else: ?><div class="field"><label for="category_legacy">Category (legacy text)</label><input id="category_legacy" name="category_legacy" list="post-categories" maxlength="120" value="<?= e($post['category']) ?>"><datalist id="post-categories"><?php foreach ($categories as $categoryOption): ?><option value="<?= e($categoryOption['name']) ?>"><?php endforeach; ?></datalist></div><?php endif; ?>
          <div class="field"><label for="tags-input">Tags</label><div class="tag-entry" data-tag-entry><div class="tag-chip-list" data-tag-chip-list aria-live="polite"></div><input id="tags-input" type="text" autocomplete="off" placeholder="Type a tag and press Enter"><input type="hidden" id="tags" name="tags" value="<?= e($tagsValue) ?>" data-tags-hidden></div><small>Press Enter or comma to add; up to 20 tags.</small></div>
        </div>
      </section>

      <section class="admin-card admin-card--editor">
        <div class="section-heading section-heading--admin"><div><p class="admin-card-eyebrow">Rich content</p><h2>Article body</h2></div><span class="editor-status" data-editor-status role="status">Loading local editor…</span></div>
        <div class="field rich-field" data-rich-field>
          <div class="editor-toolbar" data-quill-toolbar aria-label="Article formatting toolbar">
            <span class="ql-formats"><select class="ql-header" aria-label="Heading level"><option selected></option><option value="1">H1</option><option value="2">H2</option><option value="3">H3</option><option value="4">H4</option></select></span>
            <span class="ql-formats"><button class="ql-bold" type="button" aria-label="Bold">B</button><button class="ql-italic" type="button" aria-label="Italic">I</button><button class="ql-underline" type="button" aria-label="Underline">U</button><button class="ql-strike" type="button" aria-label="Strikethrough">S</button></span>
            <span class="ql-formats"><button class="ql-blockquote" type="button" aria-label="Blockquote">Quote</button><button class="ql-code-block" type="button" aria-label="Code block">Code</button><select class="ql-list" aria-label="List style"><option value="ordered">Numbered</option><option value="bullet">Bulleted</option></select></span>
            <span class="ql-formats"><button class="ql-link" type="button" aria-label="Insert link">Link</button><button class="ql-image" type="button" aria-label="Upload inline image">Image</button><button type="button" data-editor-action="table" aria-label="Insert table">Table</button></span>
            <span class="ql-formats"><button type="button" data-editor-action="undo" aria-label="Undo">Undo</button><button type="button" data-editor-action="redo" aria-label="Redo">Redo</button></span>
          </div>
          <div class="quill-editor" data-quill-editor hidden></div>
          <textarea id="bodyHtml" name="body_html" class="code-input rich-source-fallback" rows="20" required data-quill-source><?= e(sanitize_rich_html((string) $post['body_html'])) ?></textarea>
          <small>H1–H4, code blocks, blockquotes, tables and inline images are available. Images pasted from the clipboard upload to this CMS and are revalidated on the server. Scripts, unsafe links and active HTML are stripped when saving.</small>
        </div>
        <?php if ($isGatedDay): ?><div class="notice notice-warning"><strong>Editorial gate — Day <?= (int) $post['legacy_day'] ?>.</strong> This item stays unavailable publicly until reviewed and explicitly cleared.<?php if ($post['publication_reviewed']): ?> The current gate is cleared; unchecking below will clear it again.<?php endif; ?></div><label class="inline-check"><input type="checkbox" name="publication_reviewed" value="1" <?= $post['publication_reviewed'] ? 'checked' : '' ?>><span>I reviewed this draft and explicitly clear its editorial publication gate.</span></label><?php endif; ?>
      </section>
    </div>

    <aside class="admin-publish-sidebar" aria-label="Publishing options">
      <section class="admin-card publish-card"><p class="admin-card-eyebrow">Publishing</p><div class="field"><label for="status">Status</label><select id="status" name="status" data-publish-status><?php foreach (['draft','review','scheduled','published','archived'] as $option): ?><option value="<?= e($option) ?>" <?= $post['status'] === $option ? 'selected' : '' ?>><?= e(ucfirst($option)) ?></option><?php endforeach; ?></select></div><div class="field schedule-field" data-schedule-fields><label for="scheduled_at">Schedule date &amp; time (UTC)</label><input id="scheduled_at" type="datetime-local" name="scheduled_at" value="<?= e($inputDate($post['scheduled_at'] ?? null)) ?>"><small>Set status to Scheduled. The host must run the scheduled-publishing cron.</small></div><div class="field" data-published-fields><label for="published_at">Published at (UTC)</label><input id="published_at" type="datetime-local" name="published_at" value="<?= e($inputDate($post['published_at'] ?? null)) ?>"><small>Blank publishes now when status is Published.</small></div><label class="inline-check"><input type="checkbox" name="is_featured" value="1" <?= $post['is_featured'] ? 'checked' : '' ?>><span>Feature in listings</span></label><button class="button button-primary button-full" type="submit">Save post</button><a class="button button-small button-full" href="<?= e(app_url('admin/posts')) ?>">Back to posts</a><p class="publish-preview-url" data-preview-url><?= e(app_url('blog/' . ($post['slug'] ?: 'your-post'))) ?></p></section>

      <section class="admin-card"><p class="admin-card-eyebrow">Featured media</p><div class="featured-image-manager" data-featured-manager data-current-image="<?= e((string) ($post['featured_image'] ?? '')) ?>"><div class="featured-image-preview" data-featured-preview><?php if ($currentFeaturedImage !== ''): ?><img src="<?= e($currentFeaturedImage) ?>" alt="<?= e($post['featured_image_alt']) ?>" loading="lazy"><?php else: ?><span>No featured image</span><?php endif; ?></div><label class="button button-small" for="featured_image_file">Upload or replace</label><input id="featured_image_file" class="visually-hidden-input" type="file" name="featured_image_file" accept="image/jpeg,image/png,image/webp" data-featured-upload><input type="hidden" name="remove_featured_image" value="" data-remove-featured><button class="text-button text-button--danger" type="button" data-remove-featured-button <?= $currentFeaturedImage === '' ? 'hidden' : '' ?>>Remove image</button></div><div class="field"><label for="featured_image_alt">Image alt text</label><input id="featured_image_alt" name="featured_image_alt" maxlength="255" value="<?= e($post['featured_image_alt']) ?>"></div><small>JPEG, PNG or WebP; maximum 5 MB.</small><div class="field"><label for="og_image">Social image URL (optional)</label><input id="og_image" name="og_image" maxlength="500" value="<?= e($post['og_image']) ?>"><small>Use a local path or HTTPS URL. Blank uses the featured image.</small></div></section>

      <section class="admin-card"><p class="admin-card-eyebrow">SEO &amp; social</p><div class="field"><label for="seo_title">SEO title</label><input id="seo_title" name="seo_title" maxlength="255" value="<?= e($post['seo_title']) ?>" data-seo-title><small><span data-seo-title-count>0</span> characters</small></div><div class="field"><label for="seo_description">Meta description</label><textarea id="seo_description" name="seo_description" maxlength="320" rows="4" data-seo-description><?= e($post['seo_description']) ?></textarea><small><span data-seo-description-count>0</span> characters</small></div><div class="field"><label for="canonical_url">Canonical URL</label><input id="canonical_url" name="canonical_url" maxlength="500" value="<?= e($post['canonical_url']) ?>"><small>Optional local path or HTTP/HTTPS URL.</small></div><div class="field"><label for="schema_type">Structured-data type</label><select id="schema_type" name="schema_type"><option value="BlogPosting" <?= $post['schema_type'] === 'BlogPosting' ? 'selected' : '' ?>>BlogPosting</option><option value="Article" <?= $post['schema_type'] === 'Article' ? 'selected' : '' ?>>Article</option></select></div><div class="serp-preview" data-serp-preview><strong data-serp-title><?= e($post['seo_title'] ?: ($post['title'] ?: 'Post title preview')) ?></strong><span data-serp-url><?= e(app_url('blog/' . ($post['slug'] ?: 'your-post'))) ?></span><p data-serp-description><?= e($post['seo_description'] ?: ($post['excerpt'] ?: 'Search description preview')) ?></p></div></section>
    </aside>
  </div>
</form>
<?php if ($categorySchemaReady): ?><dialog class="admin-dialog" data-category-dialog><form method="dialog" class="dialog-close-row"><button type="submit" aria-label="Close">×</button></form><h2>Create category</h2><p>New category IDs are stored in the relational taxonomy and can be selected immediately.</p><form data-category-create-form data-endpoint="<?= e(app_url('admin/categories-create')) ?>"><input type="hidden" name="_csrf" value="<?= e(csrf_token()) ?>"><div class="field"><label for="new-category-name">Category name</label><input id="new-category-name" name="name" maxlength="120" required autofocus></div><div class="dialog-message" data-category-message role="status"></div><div class="admin-actions"><button class="button button-primary" type="submit">Create category</button><button class="button button-small" type="button" data-close-category-dialog>Cancel</button></div></form></dialog><?php endif; ?>
<script src="<?= e(asset_url('vendor/quill/quill-2.0.3.js')) ?>" defer></script>
<script src="<?= e(asset_url('js/admin-editor.js')) ?>" defer></script>
<?php admin_footer(); ?>
