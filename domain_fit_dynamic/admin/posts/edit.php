<?php
require_once __DIR__ . '/../../includes/auth-check.php';
require_once __DIR__ . '/../../includes/admin-ui.php';
require_once __DIR__ . '/../../includes/public-content.php';
require_once __DIR__ . '/../../includes/analytics.php';
require_once __DIR__ . '/../../includes/cache.php';
admin_require_permission($pdo, $admin, 'manage_posts');
$id = filter_var(request_string($_GET, 'id', request_string($_POST, 'id')), FILTER_VALIDATE_INT) ?: 0;
$post = ['id'=>0,'slug'=>'','legacy_day'=>null,'title'=>'','excerpt'=>'','body_html'=>'','category'=>'','tags_json'=>'[]','featured_image'=>'','featured_image_alt'=>'','seo_title'=>'','seo_description'=>'','canonical_url'=>'','og_image'=>'','schema_type'=>'BlogPosting','status'=>'draft','published_at'=>null,'scheduled_at'=>null,'is_featured'=>0,'publication_reviewed'=>0];
if ($id) {
    $get = $pdo->prepare('SELECT * FROM blog_posts WHERE id=:id LIMIT 1');
    $get->execute(['id'=>$id]);
    $post = $get->fetch() ?: null;
    if (!$post) { http_response_code(404); exit('Post not found.'); }
}
$categories = $pdo->query("SELECT DISTINCT category FROM blog_posts WHERE category <> '' ORDER BY category")->fetchAll(PDO::FETCH_COLUMN);
$errorMessage = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $title = trim(substr(strip_tags(request_string($_POST, 'title', '')), 0, 255));
    $slug = slugify((string) ($_POST['slug'] ?? $title));
    $excerpt = trim(substr(strip_tags(request_string($_POST, 'excerpt', '')), 0, 500));
    $category = trim(substr(strip_tags(request_string($_POST, 'category', '')), 0, 120));
    $tags = array_slice(array_values(array_unique(array_filter(array_map(static fn($tag) => trim(substr(strip_tags((string) $tag), 0, 60)), explode(',', request_string($_POST, 'tags', '')))))), 0, 20);
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
    $slugCheck = $pdo->prepare('SELECT id FROM blog_posts WHERE slug=:slug AND id<>:id LIMIT 1');
    $slugCheck->execute(['slug'=>$slug,'id'=>$id]);
    if ($slugCheck->fetchColumn()) $errorMessage = 'That URL slug is already used by another post.';

    $imagePath = (string) ($post['featured_image'] ?? '');
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
        try {
            $values = [
                'slug'=>$slug,'title'=>$title,'excerpt'=>$excerpt,'body_html'=>$bodyHtml,'category'=>$category,
                'tags_json'=>json_encode($tags, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),'featured_image'=>$imagePath,
                'featured_image_alt'=>$imageAlt,'seo_title'=>$seoTitle,'seo_description'=>$seoDescription,
                'canonical_url'=>$canonicalUrl,'og_image'=>$ogImage,'schema_type'=>$schemaType,'status'=>$status,
                'published_at'=>$publishedAt,'scheduled_at'=>$status === 'scheduled' ? $scheduledAt : null,
                'is_featured'=>$isFeatured,'publication_reviewed'=>$reviewed ? 1 : 0,'publication_reviewed_at'=>$reviewedAt,
                'publication_reviewed_by'=>$reviewedBy,'updated_by'=>(int) $admin['id']
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
            audit_log($pdo, (int) $admin['id'], $post['id'] ? 'post.updated' : 'post.created', 'blog_post', (string) $id, 'Post saved.');
            cache_clear_all();
            flash('success', 'Post saved.');
            redirect_to('admin/posts/edit?id=' . $id);
        } catch (Throwable $error) {
            error_log('Post save: ' . $error->getMessage());
            $errorMessage = 'The post could not be saved. Check the slug, image and database fields.';
        }
    }
    $post = array_merge($post, ['title'=>$title,'slug'=>$slug,'excerpt'=>$excerpt,'body_html'=>$bodyHtml,'category'=>$category,'tags_json'=>json_encode($tags),'featured_image'=>$imagePath,'featured_image_alt'=>$imageAlt,'seo_title'=>$seoTitle,'seo_description'=>$seoDescription,'canonical_url'=>$canonicalUrl,'og_image'=>$ogImage,'schema_type'=>$schemaType,'status'=>$status,'published_at'=>$publishedAt,'scheduled_at'=>$scheduledAt,'is_featured'=>$isFeatured,'publication_reviewed'=>$reviewed ? 1 : 0]);
}
$tagsValue = json_decode((string) ($post['tags_json'] ?? '[]'), true);
$tagsValue = is_array($tagsValue) ? implode(', ', $tagsValue) : '';
$inputDate = static function (?string $date): string { $stamp = $date ? strtotime($date) : false; return $stamp ? gmdate('Y-m-d\\TH:i', $stamp) : ''; };
$isGatedDay = isset($post['legacy_day']) && (int) $post['legacy_day'] >= 31 && (int) $post['legacy_day'] <= 50;
admin_header($pdo, $admin, $id ? 'Edit post' : 'New post');
?>
<?php if ($errorMessage !== ''): ?><div class="notice notice-error" role="alert"><?= e($errorMessage) ?></div><?php endif; ?>
<form class="admin-form" method="post" enctype="multipart/form-data" action="<?= e(app_url('admin/posts/edit' . ($id ? '?id=' . $id : ''))) ?>">
  <?= csrf_field() ?><?php if ($id): ?><input type="hidden" name="id" value="<?= (int) $id ?>"><?php endif; ?>
  <section class="admin-card"><h2>Post content</h2><div class="form-row"><div class="field"><label for="title">Title</label><input id="title" name="title" maxlength="255" required value="<?= e($post['title']) ?>"></div><div class="field"><label for="slug">URL slug</label><input id="slug" name="slug" maxlength="180" pattern="[a-z0-9]+(-[a-z0-9]+)*" required value="<?= e($post['slug']) ?>"><small>Public URL: /blog/<?= e($post['slug'] ?: 'your-post') ?></small></div></div>
  <div class="field"><label for="excerpt">Excerpt</label><textarea id="excerpt" name="excerpt" maxlength="500" rows="3"><?= e($post['excerpt']) ?></textarea></div>
  <div class="form-row"><div class="field"><label for="category">Category</label><input id="category" name="category" list="post-categories" maxlength="120" value="<?= e($post['category']) ?>"><datalist id="post-categories"><?php foreach ($categories as $categoryName): ?><option value="<?= e($categoryName) ?>"><?php endforeach; ?></datalist></div><div class="field"><label for="tags">Tags (comma separated)</label><input id="tags" name="tags" maxlength="1000" value="<?= e($tagsValue) ?>"></div></div>
  <?php if ($isGatedDay): ?><div class="notice notice-warning"><strong>Editorial gate — Day <?= (int) $post['legacy_day'] ?>.</strong> This item is a draft and remains unavailable to public pages and the sitemap until editorial review is explicitly recorded.<?php if ($post['publication_reviewed']): ?> Current gate is cleared; unchecking below will clear it again.<?php endif; ?></div><label class="inline-check"><input type="checkbox" name="publication_reviewed" value="1" <?= $post['publication_reviewed'] ? 'checked' : '' ?>><span>I have reviewed this draft and explicitly clear its editorial publication gate.</span></label><?php endif; ?>
  <div class="field"><label for="bodyHtml">Article body (rich text)</label><div class="editor-toolbar" data-editor-toolbar hidden><button type="button" data-command="bold" title="Bold"><strong>B</strong></button><button type="button" data-command="italic" title="Italic"><em>I</em></button><button type="button" data-command="formatBlock" data-value="h2" title="Heading">H2</button><button type="button" data-command="formatBlock" data-value="blockquote" title="Quote">❞</button><button type="button" data-command="insertUnorderedList" title="Bulleted list">• List</button><button type="button" data-command="createLink" title="Insert link">Link</button><button type="button" data-command="removeFormat" title="Clear formatting">Clear</button></div><div class="rich-editor" contenteditable="true" data-rich-editor hidden></div><textarea id="bodyHtml" name="body_html" class="code-input" rows="16" required><?= e(sanitize_rich_html((string) $post['body_html'])) ?></textarea><small>Allowed semantic HTML is sanitized on save. If JavaScript is disabled, edit the HTML source in this field. Imported posts retain their original source-file metadata.</small></div></section>
  <section class="admin-card"><h2>Publishing &amp; discoverability</h2><div class="form-row three"><div class="field"><label for="status">Status</label><select id="status" name="status"><?php foreach (['draft','review','scheduled','published','archived'] as $option): ?><option value="<?= e($option) ?>" <?= $post['status'] === $option ? 'selected' : '' ?>><?= e(ucfirst($option)) ?></option><?php endforeach; ?></select></div><div class="field"><label for="published_at">Publish date (UTC)</label><input id="published_at" type="datetime-local" name="published_at" value="<?= e($inputDate($post['published_at'] ?? null)) ?>"><small>Used when status is Published. Blank means publish now.</small></div><div class="field"><label for="scheduled_at">Schedule date (UTC)</label><input id="scheduled_at" type="datetime-local" name="scheduled_at" value="<?= e($inputDate($post['scheduled_at'] ?? null)) ?>"><small>For scheduled status, an external cron should publish due content.</small></div></div><label class="inline-check"><input type="checkbox" name="is_featured" value="1" <?= $post['is_featured'] ? 'checked' : '' ?>><span>Feature this post at the top of listings</span></label><div class="form-row"><div class="field"><label for="seo_title">SEO title</label><input id="seo_title" name="seo_title" maxlength="255" value="<?= e($post['seo_title']) ?>"></div><div class="field"><label for="seo_description">SEO description</label><textarea id="seo_description" name="seo_description" maxlength="320" rows="2"><?= e($post['seo_description']) ?></textarea></div></div><div class="form-row"><div class="field"><label for="canonical_url">Canonical URL (optional)</label><input id="canonical_url" name="canonical_url" maxlength="500" value="<?= e($post['canonical_url']) ?>"></div><div class="field"><label for="schema_type">Structured-data type</label><select id="schema_type" name="schema_type"><option value="BlogPosting" <?= $post['schema_type'] === 'BlogPosting' ? 'selected' : '' ?>>BlogPosting</option><option value="Article" <?= $post['schema_type'] === 'Article' ? 'selected' : '' ?>>Article</option></select></div></div></section>
  <section class="admin-card"><h2>Featured image</h2><?php if ($post['featured_image'] !== ''): ?><p>Current: <a href="<?= e(public_image_url((string) $post['featured_image'])) ?>" target="_blank" rel="noopener">View image</a></p><?php endif; ?><div class="form-row"><div class="field"><label for="featured_image_file">Upload JPEG, PNG or WebP (max 5 MB)</label><input id="featured_image_file" type="file" name="featured_image_file" accept="image/jpeg,image/png,image/webp"></div><div class="field"><label for="featured_image_alt">Image alternative text</label><input id="featured_image_alt" name="featured_image_alt" maxlength="255" value="<?= e($post['featured_image_alt']) ?>"></div></div><div class="field"><label for="og_image">OpenGraph image URL (optional)</label><input id="og_image" name="og_image" maxlength="500" value="<?= e($post['og_image']) ?>"><small>Use an uploaded local path or HTTPS URL. Leave blank to use the featured image.</small></div></section>
  <div class="admin-actions"><button class="button button-primary" type="submit">Save post</button><a class="button button-small" href="<?= e(app_url('admin/posts')) ?>">Back to posts</a></div>
</form>
<script src="<?= e(asset_url('js/admin-editor.js')) ?>" defer></script>
<?php admin_footer(); ?>
