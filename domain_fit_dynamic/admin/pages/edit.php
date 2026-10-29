<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/auth-check.php';
require_once __DIR__ . '/../../includes/admin-ui.php';
require_once __DIR__ . '/../../includes/analytics.php';
require_once __DIR__ . '/../../includes/cache.php';
admin_require_permission($pdo, $admin, 'manage_pages');

$id = filter_var(request_string($_GET, 'id', request_string($_POST, 'id')), FILTER_VALIDATE_INT) ?: 0;
$page = [
    'id' => 0, 'slug' => '', 'legacy_file' => null, 'title' => '', 'excerpt' => '', 'content_html' => '',
    'seo_title' => '', 'seo_description' => '', 'canonical_url' => '', 'og_image' => '', 'status' => 'draft', 'noindex' => 0,
];
if ($id) {
    $get = $pdo->prepare('SELECT * FROM site_pages WHERE id=:id');
    $get->execute(['id' => $id]);
    $page = $get->fetch() ?: null;
    if (!$page) { http_response_code(404); exit('Page not found.'); }
}
$errorMessage = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $title = trim(substr(strip_tags(request_string($_POST, 'title', '')), 0, 255));
    $slug = slugify(request_string($_POST, 'slug', $title));
    $excerpt = trim(substr(strip_tags(request_string($_POST, 'excerpt', '')), 0, 500));
    $content = sanitize_rich_html(request_string($_POST, 'content_html', ''));
    $seoTitle = trim(substr(strip_tags(request_string($_POST, 'seo_title', '')), 0, 255));
    $seoDescription = trim(substr(strip_tags(request_string($_POST, 'seo_description', '')), 0, 320));
    $canonical = trim(substr(request_string($_POST, 'canonical_url', ''), 0, 500));
    $ogImage = trim(substr(request_string($_POST, 'og_image', ''), 0, 500));
    $status = in_array(($_POST['status'] ?? ''), ['draft','published','archived'], true) ? (string) $_POST['status'] : 'draft';
    $noindex = isset($_POST['noindex']) ? 1 : 0;
    if ($title === '' || $slug === '' || $content === '') $errorMessage = 'Title, a valid URL slug and page content are required.';
    if (($page['slug'] ?? '') === 'contact' && $slug !== 'contact') $errorMessage = 'The built-in contact page slug is reserved for the working contact form.';
    if ($canonical !== '' && !(str_starts_with($canonical, '/') && !str_starts_with($canonical, '//')) && (!filter_var($canonical, FILTER_VALIDATE_URL) || !in_array(strtolower((string) parse_url($canonical, PHP_URL_SCHEME)), ['http','https'], true))) $errorMessage = 'Canonical URL must be a local path or valid HTTP/HTTPS URL.';
    if ($ogImage !== '' && !(str_starts_with($ogImage, '/') && !str_starts_with($ogImage, '//')) && (!filter_var($ogImage, FILTER_VALIDATE_URL) || strtolower((string) parse_url($ogImage, PHP_URL_SCHEME)) !== 'https')) $errorMessage = 'OpenGraph image must be a local path or HTTPS URL.';
    if ($slug !== '') {
        $duplicate = $pdo->prepare('SELECT id FROM site_pages WHERE slug=:slug AND id<>:id LIMIT 1');
        $duplicate->execute(['slug' => $slug, 'id' => $id]);
        if ($duplicate->fetchColumn()) $errorMessage = 'That page slug is already used.';
    }
    if ($errorMessage === '') {
        try {
            if (isset($_POST['clear_og_image'])) $ogImage = '';
            $upload = save_uploaded_image('og_image_file', 'uploads/pages');
            if ($upload !== null) $ogImage = $upload;
            $values = [
                'slug' => $slug, 'title' => $title, 'excerpt' => $excerpt, 'content' => $content,
                'seo_title' => $seoTitle, 'seo_description' => $seoDescription, 'canonical' => $canonical,
                'og_image' => $ogImage, 'status' => $status, 'noindex' => $noindex, 'updated_by' => (int) $admin['id'],
            ];
            $wasExisting = $id > 0;
            if ($id) {
                $values['id'] = $id;
                $save = $pdo->prepare('UPDATE site_pages SET slug=:slug,title=:title,excerpt=:excerpt,content_html=:content,seo_title=:seo_title,seo_description=:seo_description,canonical_url=:canonical,og_image=:og_image,status=:status,noindex=:noindex,updated_by=:updated_by WHERE id=:id');
                $save->execute($values);
            } else {
                $values['created_by'] = (int) $admin['id'];
                $save = $pdo->prepare('INSERT INTO site_pages(slug,title,excerpt,content_html,seo_title,seo_description,canonical_url,og_image,status,noindex,created_by,updated_by) VALUES(:slug,:title,:excerpt,:content,:seo_title,:seo_description,:canonical,:og_image,:status,:noindex,:created_by,:updated_by)');
                $save->execute($values);
                $id = (int) $pdo->lastInsertId();
            }
            audit_log($pdo, (int) $admin['id'], $wasExisting ? 'page.updated' : 'page.created', 'site_page', (string) $id, 'Page saved.');
            cache_clear_all();
            flash('success', 'Page saved.');
            redirect_to('admin/pages/edit?id=' . $id);
        } catch (Throwable $error) {
            error_log('Page save: ' . $error->getMessage());
            $errorMessage = 'Page could not be saved. Check the URL slug and uploaded image.';
        }
    }
    $page = array_merge($page, [
        'title' => $title, 'slug' => $slug, 'excerpt' => $excerpt, 'content_html' => $content,
        'seo_title' => $seoTitle, 'seo_description' => $seoDescription, 'canonical_url' => $canonical,
        'og_image' => $ogImage, 'status' => $status, 'noindex' => $noindex,
    ]);
}
$currentOgImage = public_image_url((string) ($page['og_image'] ?? ''));
admin_header($pdo, $admin, $id ? 'Edit page' : 'New page', ['vendor/quill/quill-2.0.3.snow.css']);
?>
<?php if ($errorMessage !== ''): ?><div class="notice notice-error" role="alert"><?= e($errorMessage) ?></div><?php endif; ?>
<form class="admin-form admin-publish-form" method="post" enctype="multipart/form-data" action="<?= e(app_url('admin/pages/edit' . ($id ? '?id=' . $id : ''))) ?>" data-publish-form data-editor-image-endpoint="<?= e(app_url('admin/editor-image')) ?>">
  <?= csrf_field() ?><?php if ($id): ?><input type="hidden" name="id" value="<?= (int) $id ?>"><?php endif; ?>
  <div class="admin-publish-layout">
    <div class="admin-publish-main">
      <section class="admin-card admin-card--editor">
        <p class="admin-card-eyebrow">Page workspace</p>
        <div class="field post-title-field"><label for="title">Page title</label><input id="title" name="title" maxlength="255" required value="<?= e($page['title']) ?>" placeholder="Write the page title" data-slug-source data-seo-title-source></div>
        <div class="slug-editor-row"><div class="field"><label for="slug">Permalink</label><div class="slug-control"><span aria-hidden="true"><?= e(app_url('pages/')) ?></span><input id="slug" name="slug" maxlength="180" pattern="[a-z0-9]+(-[a-z0-9]+)*" required value="<?= e($page['slug']) ?>" data-slug-target data-slug-mode="<?= $id ? 'manual' : 'auto' ?>" <?= $id ? '' : 'readonly' ?>><button class="button button-small" type="button" data-slug-manual-toggle><?= $id ? 'Keep current URL' : 'Edit manually' ?></button></div><small data-slug-preview data-url-prefix="<?= e(app_url('pages/')) ?>"><?= e(app_url('pages/' . ($page['slug'] ?: 'your-page'))) ?></small></div></div>
        <div class="field"><label for="excerpt">Short summary</label><textarea id="excerpt" name="excerpt" maxlength="500" rows="3" placeholder="A short page introduction for previews."><?= e($page['excerpt']) ?></textarea></div>
      </section>
      <section class="admin-card admin-card--editor">
        <div class="section-heading section-heading--admin"><div><p class="admin-card-eyebrow">Rich content</p><h2>Page body</h2></div><span class="editor-status" data-editor-status role="status">Loading local editor…</span></div>
        <div class="field rich-field" data-rich-field>
          <div class="editor-toolbar" data-quill-toolbar aria-label="Page formatting toolbar" hidden>
            <span class="ql-formats"><select class="ql-header" aria-label="Heading level"><option selected></option><option value="1">H1</option><option value="2">H2</option><option value="3">H3</option><option value="4">H4</option></select></span>
            <span class="ql-formats"><button class="ql-bold" type="button" aria-label="Bold">B</button><button class="ql-italic" type="button" aria-label="Italic">I</button><button class="ql-underline" type="button" aria-label="Underline">U</button><button class="ql-strike" type="button" aria-label="Strikethrough">S</button></span>
            <span class="ql-formats"><button class="ql-blockquote" type="button" aria-label="Blockquote">Quote</button><button class="ql-code-block" type="button" aria-label="Code block">Code</button><select class="ql-list" aria-label="List style"><option value="ordered">Numbered</option><option value="bullet">Bulleted</option></select></span>
            <span class="ql-formats"><button class="ql-link" type="button" aria-label="Insert link">Link</button><button class="ql-image" type="button" aria-label="Upload inline image">Image</button><button type="button" data-editor-action="table" aria-label="Insert table">Table</button></span>
            <span class="ql-formats"><button type="button" data-editor-action="undo" aria-label="Undo">Undo</button><button type="button" data-editor-action="redo" aria-label="Redo">Redo</button></span>
          </div>
          <div class="quill-editor" data-quill-editor hidden></div>
          <textarea id="content_html" name="content_html" class="code-input rich-source-fallback" rows="22" hidden data-quill-source><?= e(sanitize_rich_html((string) $page['content_html'])) ?></textarea>
          <small>H1–H4, code blocks, blockquotes, tables and inline image upload/paste are available. Saved content is sanitized server-side; scripts, iframes and unsafe URLs are removed.</small>
        </div>
      </section>
    </div>

    <aside class="admin-publish-sidebar" aria-label="Page publishing and SEO">
      <section class="admin-card publish-card"><p class="admin-card-eyebrow">Publishing</p><div class="field"><label for="status">Status</label><select id="status" name="status"><option value="draft" <?= $page['status'] === 'draft' ? 'selected' : '' ?>>Draft</option><option value="published" <?= $page['status'] === 'published' ? 'selected' : '' ?>>Published</option><option value="archived" <?= $page['status'] === 'archived' ? 'selected' : '' ?>>Archived</option></select></div><label class="inline-check"><input type="checkbox" name="noindex" value="1" <?= $page['noindex'] ? 'checked' : '' ?>><span>Noindex, nofollow and omit from sitemap</span></label><button class="button button-primary button-full" type="submit">Save page</button><a class="button button-small button-full" href="<?= e(app_url('admin/pages')) ?>">Back to pages</a><p class="publish-preview-url" data-preview-url><?= e(app_url('pages/' . ($page['slug'] ?: 'your-page'))) ?></p></section>
      <section class="admin-card"><p class="admin-card-eyebrow">Search &amp; social</p><div class="field"><label for="seo_title">SEO title</label><input id="seo_title" name="seo_title" maxlength="255" value="<?= e($page['seo_title']) ?>" data-seo-title><small><span data-seo-title-count>0</span> characters</small></div><div class="field"><label for="seo_description">Meta description</label><textarea id="seo_description" name="seo_description" maxlength="320" rows="4" data-seo-description><?= e($page['seo_description']) ?></textarea><small><span data-seo-description-count>0</span> characters</small></div><div class="field"><label for="canonical_url">Canonical URL (optional)</label><input id="canonical_url" name="canonical_url" maxlength="500" value="<?= e($page['canonical_url']) ?>"></div><div class="serp-preview" data-serp-preview><strong data-serp-title><?= e($page['seo_title'] ?: ($page['title'] ?: 'Page title preview')) ?></strong><span data-serp-url><?= e(app_url('pages/' . ($page['slug'] ?: 'your-page'))) ?></span><p data-serp-description><?= e($page['seo_description'] ?: ($page['excerpt'] ?: 'Search description preview')) ?></p></div></section>
      <section class="admin-card"><p class="admin-card-eyebrow">Social image</p><div class="featured-image-manager" data-og-manager data-current-image="<?= e((string) ($page['og_image'] ?? '')) ?>"><div class="featured-image-preview" data-og-preview><?php if ($currentOgImage !== ''): ?><img src="<?= e($currentOgImage) ?>" alt="OpenGraph preview" loading="lazy"><?php else: ?><span>No social image</span><?php endif; ?></div><label class="button button-small" for="og_image_file">Upload or replace</label><input id="og_image_file" class="visually-hidden-input" type="file" name="og_image_file" accept="image/jpeg,image/png,image/webp" data-og-upload><input type="hidden" name="clear_og_image" value="" data-clear-og-image><button class="text-button text-button--danger" type="button" data-clear-og-button <?= $currentOgImage === '' ? 'hidden' : '' ?>>Remove image</button></div><small>JPEG, PNG or WebP; maximum 5 MB.</small><div class="field"><label for="og_image">OpenGraph image path or HTTPS URL</label><input id="og_image" name="og_image" maxlength="500" value="<?= e($page['og_image']) ?>"></div></section>
    </aside>
  </div>
</form>
<script src="<?= e(asset_url('vendor/quill/quill-2.0.3.js')) ?>" defer></script>
<script src="<?= e(asset_url('js/admin-editor.js')) ?>" defer></script>
<script>
window.setTimeout(function () {
  document.querySelectorAll('[data-rich-field]').forEach(function (field) {
    var status = field.closest('form')?.querySelector('[data-editor-status]');
    if (!status || status.textContent.trim() !== 'Loading local editor…') return;
    status.textContent = 'Editor scripts did not initialize. Verify the local Quill and admin-editor.js assets are uploaded; the HTML fallback is open below.';
    status.dataset.state = 'error';
    var source = field.querySelector('[data-quill-source]');
    var toolbar = field.querySelector('[data-quill-toolbar]');
    var host = field.querySelector('[data-quill-editor]');
    if (source) { source.hidden = false; source.required = true; }
    if (toolbar) toolbar.hidden = true;
    if (host) host.hidden = true;
  });
}, 8000);
</script>
<?php admin_footer(); ?>
