<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/auth-check.php';
require_once __DIR__ . '/../../includes/admin-ui.php';
require_once __DIR__ . '/../../includes/public-content.php';
require_once __DIR__ . '/../../includes/analytics.php';
require_once __DIR__ . '/../../includes/cache.php';
admin_require_permission($pdo, $admin, 'manage_posts');

$search = trim(substr(request_string($_GET, 'q', request_string($_POST, 'return_q', '')), 0, 100));
$statusOptions = ['draft', 'review', 'scheduled', 'published', 'archived'];
$status = in_array(request_string($_GET, 'status', request_string($_POST, 'return_status', '')), $statusOptions, true)
    ? request_string($_GET, 'status', request_string($_POST, 'return_status', ''))
    : '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    if (request_string($_POST, 'action', '') !== 'quick_update') {
        http_response_code(400);
        exit('Invalid post action.');
    }

    $postId = filter_var($_POST['id'] ?? null, FILTER_VALIDATE_INT);
    if (!$postId || $postId < 1) {
        flash('error', 'The selected post is invalid.');
        redirect_to('admin/posts');
    }

    $getPost = $pdo->prepare('SELECT id,slug,title,status,published_at,scheduled_at,legacy_day,publication_reviewed FROM blog_posts WHERE id=:id LIMIT 1');
    $getPost->execute(['id' => $postId]);
    $postToUpdate = $getPost->fetch();
    if (!$postToUpdate) {
        flash('error', 'Post not found.');
        redirect_to('admin/posts');
    }

    $nextStatus = request_string($_POST, 'status', '');
    $dateInput = trim(request_string($_POST, 'publication_date', ''));
    $parsedDate = $dateInput === '' ? null : parse_datetime_local_utc($dateInput);
    $isGatedDay = $postToUpdate['legacy_day'] !== null
        && (int) $postToUpdate['legacy_day'] >= 31
        && (int) $postToUpdate['legacy_day'] <= 50;

    if (!in_array($nextStatus, $statusOptions, true)) {
        flash('error', 'Choose a valid post status.');
    } elseif ($dateInput !== '' && $parsedDate === null) {
        flash('error', 'Enter a valid publication or schedule date and time in UTC.');
    } elseif ($isGatedDay && in_array($nextStatus, ['published', 'scheduled'], true) && !(bool) $postToUpdate['publication_reviewed']) {
        flash('error', 'Editorial days 31–50 stay locked until their review gate is explicitly cleared in the editor.');
    } elseif ($nextStatus === 'scheduled' && $parsedDate === null) {
        flash('error', 'A valid UTC date and time is required for a scheduled post.');
    } else {
        $publishedAt = null;
        $scheduledAt = null;
        if ($nextStatus === 'published') {
            $publishedAt = $parsedDate ?? gmdate('Y-m-d H:i:s');
        } elseif ($nextStatus === 'scheduled') {
            $scheduledAt = $parsedDate;
        }

        $update = $pdo->prepare('UPDATE blog_posts SET status=:status,published_at=:published_at,scheduled_at=:scheduled_at,updated_by=:updated_by WHERE id=:id');
        $update->execute([
            'status' => $nextStatus,
            'published_at' => $publishedAt,
            'scheduled_at' => $scheduledAt,
            'updated_by' => (int) $admin['id'],
            'id' => (int) $postToUpdate['id'],
        ]);
        audit_log(
            $pdo,
            (int) $admin['id'],
            'post.quick_status_changed',
            'blog_post',
            (string) $postToUpdate['id'],
            'Status: ' . $nextStatus . '; date: ' . ($publishedAt ?? $scheduledAt ?? '—')
        );
        cache_clear_all();
        flash('success', 'Post status and publication date updated.');
    }

    $returnQuery = [];
    if ($search !== '') $returnQuery['q'] = $search;
    if ($status !== '') $returnQuery['status'] = $status;
    redirect_to('admin/posts' . ($returnQuery ? '?' . http_build_query($returnQuery) : ''));
}

$sql = 'SELECT id,slug,title,category,status,featured_image,featured_image_alt,published_at,scheduled_at,legacy_day,publication_reviewed,updated_at FROM blog_posts WHERE 1=1';
$params = [];
if ($status !== '') {
    $sql .= ' AND status=:status';
    $params['status'] = $status;
}
if ($search !== '') {
    $sql .= ' AND (title LIKE :title_q OR slug LIKE :slug_q)';
    $searchValue = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $search) . '%';
    $params['title_q'] = $searchValue;
    $params['slug_q'] = $searchValue;
}
$sql .= ' ORDER BY CASE status WHEN \'draft\' THEN 0 WHEN \'review\' THEN 1 WHEN \'scheduled\' THEN 2 WHEN \'published\' THEN 3 ELSE 4 END, updated_at DESC LIMIT 250';
$query = $pdo->prepare($sql);
$query->execute($params);
$posts = $query->fetchAll();

$toDateTimeLocal = static function (?string $value): string {
    if ($value === null || trim($value) === '') return '';
    try {
        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d\\TH:i');
    } catch (Throwable $error) {
        return '';
    }
};

admin_header($pdo, $admin, 'Blog posts');
?>
<div class="post-list-toolbar">
  <a class="button button-primary" href="<?= e(app_url('admin/posts/edit')) ?>">＋ New post</a>
  <span class="admin-badge"><?= count($posts) ?> shown · maximum 250</span>
</div>
<form class="admin-filter post-list-filter" method="get" action="<?= e(app_url('admin/posts')) ?>">
  <label class="visually-hidden" for="post-search">Search posts</label>
  <input id="post-search" type="search" name="q" value="<?= e($search) ?>" placeholder="Search title or slug">
  <label class="visually-hidden" for="post-status-filter">Filter by status</label>
  <select id="post-status-filter" name="status">
    <option value="">All statuses</option>
    <?php foreach ($statusOptions as $option): ?><option value="<?= e($option) ?>" <?= $status === $option ? 'selected' : '' ?>><?= e(ucfirst($option)) ?></option><?php endforeach; ?>
  </select>
  <button class="button button-small" type="submit">Filter</button>
</form>
<div class="admin-table-wrap post-list-table-wrap">
  <table class="admin-table post-list-table">
    <thead><tr><th>Post</th><th>Category / status</th><th>Quick publish controls</th><th>Actions</th><th>Thumbnail</th></tr></thead>
    <tbody>
    <?php foreach ($posts as $post):
        $postId = (int) $post['id'];
        $isGatedDay = $post['legacy_day'] !== null && (int) $post['legacy_day'] >= 31 && (int) $post['legacy_day'] <= 50;
        $dateValue = $post['status'] === 'scheduled'
            ? $toDateTimeLocal($post['scheduled_at'] !== null ? (string) $post['scheduled_at'] : null)
            : $toDateTimeLocal($post['published_at'] !== null ? (string) $post['published_at'] : null);
        $thumbnailUrl = public_image_url((string) ($post['featured_image'] ?? ''));
        $thumbnailAlt = trim((string) ($post['featured_image_alt'] ?? '')) ?: (string) $post['title'];
    ?>
      <tr>
        <td class="post-list-title-cell">
          <strong><?= e($post['title']) ?></strong>
          <small class="post-list-slug">/blog/<?= e($post['slug']) ?></small>
          <?php if ($post['legacy_day']): ?><small>Editorial day <?= (int) $post['legacy_day'] ?></small><?php endif; ?>
        </td>
        <td class="post-list-category-cell">
          <span><?= e($post['category'] ?: 'Uncategorized') ?></span>
          <span class="admin-badge admin-badge--<?= e($post['status']) ?>"><?= e(ucfirst($post['status'])) ?></span>
          <?php if ($isGatedDay): ?><small class="post-list-gate <?= $post['publication_reviewed'] ? 'is-cleared' : 'is-locked' ?>"><?= $post['publication_reviewed'] ? 'Review gate cleared' : 'Review gate locked' ?></small><?php endif; ?>
        </td>
        <td class="post-list-quick-cell">
          <form class="post-quick-form" method="post" action="<?= e(app_url('admin/posts')) ?>">
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="quick_update">
            <input type="hidden" name="id" value="<?= $postId ?>">
            <input type="hidden" name="return_q" value="<?= e($search) ?>">
            <input type="hidden" name="return_status" value="<?= e($status) ?>">
            <label class="post-quick-field">
              <span>Status</span>
              <select name="status" aria-label="Status for <?= e($post['title']) ?>">
                <?php foreach ($statusOptions as $option): ?><option value="<?= e($option) ?>" <?= $post['status'] === $option ? 'selected' : '' ?>><?= e(ucfirst($option)) ?></option><?php endforeach; ?>
              </select>
            </label>
            <label class="post-quick-field">
              <span><?= $post['status'] === 'scheduled' ? 'Schedule date' : 'Publish date' ?> <small>(UTC)</small></span>
              <input type="datetime-local" name="publication_date" value="<?= e($dateValue) ?>" aria-label="Publication or schedule date in UTC for <?= e($post['title']) ?>">
            </label>
            <button class="button button-small" type="submit">Save</button>
          </form>
        </td>
        <td class="post-list-actions-cell">
          <div class="admin-actions">
            <a href="<?= e(app_url('admin/posts/edit?id=' . $postId)) ?>">Edit</a>
            <?php if ($post['status'] === 'published'): ?><a href="<?= e(app_url('blog/' . $post['slug'])) ?>" target="_blank" rel="noopener">View</a><?php endif; ?>
            <form class="admin-inline-form" data-confirm="Delete this post and its content?" method="post" action="<?= e(app_url('admin/posts/delete')) ?>">
              <?= csrf_field() ?><input type="hidden" name="id" value="<?= $postId ?>">
              <button class="admin-danger" type="submit">Delete</button>
            </form>
          </div>
        </td>
        <td class="post-list-thumbnail-cell">
          <?php if ($thumbnailUrl !== ''): ?><a href="<?= e(app_url('admin/posts/edit?id=' . $postId)) ?>" aria-label="Edit <?= e($post['title']) ?>"><img class="post-list-thumbnail" src="<?= e($thumbnailUrl) ?>" alt="<?= e($thumbnailAlt) ?>" width="88" height="60" loading="lazy"></a><?php else: ?><a class="post-list-thumbnail-empty" href="<?= e(app_url('admin/posts/edit?id=' . $postId)) ?>">Add image</a><?php endif; ?>
        </td>
      </tr>
    <?php endforeach; ?>
    <?php if (!$posts): ?><tr><td colspan="5" class="post-list-empty">No posts match these filters.</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<p class="post-list-help">Quick status and date edits use UTC. Days 31–50 cannot be published or scheduled until their editorial gate is cleared in the post editor.</p>
<?php admin_footer(); ?>
