<?php
require_once __DIR__ . '/../../includes/auth-check.php';
require_once __DIR__ . '/../../includes/admin-ui.php';
admin_require_permission($pdo, $admin, 'manage_posts');
$search = trim(substr(request_string($_GET, 'q', ''), 0, 100));
$status = in_array(($_GET['status'] ?? ''), ['draft','review','scheduled','published','archived'], true) ? (string) $_GET['status'] : '';
$sql = 'SELECT id,slug,title,category,status,published_at,legacy_day,publication_reviewed,updated_at FROM blog_posts WHERE 1=1';
$params = [];
if ($status !== '') { $sql .= ' AND status=:status'; $params['status'] = $status; }
if ($search !== '') { $sql .= ' AND (title LIKE :title_q OR slug LIKE :slug_q)'; $searchValue = '%' . str_replace(['%','_'], ['\\%','\\_'], $search) . '%'; $params['title_q'] = $searchValue; $params['slug_q'] = $searchValue; }
$sql .= ' ORDER BY CASE status WHEN \'draft\' THEN 0 WHEN \'review\' THEN 1 WHEN \'scheduled\' THEN 2 WHEN \'published\' THEN 3 ELSE 4 END, updated_at DESC LIMIT 250';
$query = $pdo->prepare($sql);
$query->execute($params);
$posts = $query->fetchAll();
admin_header($pdo, $admin, 'Blog posts');
?>
<div class="admin-actions" style="margin-bottom:1rem"><a class="button button-primary" href="<?= e(app_url('admin/posts/edit.php')) ?>">＋ New post</a><span class="admin-badge"><?= count($posts) ?> shown · max 250</span></div>
<form class="admin-filter" method="get"><input type="search" name="q" value="<?= e($search) ?>" placeholder="Search title or slug"><select name="status"><option value="">All statuses</option><?php foreach (['draft','review','scheduled','published','archived'] as $option): ?><option value="<?= e($option) ?>" <?= $status === $option ? 'selected' : '' ?>><?= e(ucfirst($option)) ?></option><?php endforeach; ?></select><button class="button button-small" type="submit">Filter</button></form>
<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Post</th><th>Category</th><th>Status / gate</th><th>Publish date</th><th>Actions</th></tr></thead><tbody>
<?php foreach ($posts as $post): ?><tr><td><strong><?= e($post['title']) ?></strong><br><small>/blog/<?= e($post['slug']) ?></small><?php if ($post['legacy_day']): ?><br><small>Editorial day <?= (int) $post['legacy_day'] ?></small><?php endif; ?></td><td><?= e($post['category']) ?></td><td><span class="admin-badge admin-badge--<?= e($post['status']) ?>"><?= e(ucfirst($post['status'])) ?></span><?php if ($post['legacy_day'] >= 31 && $post['legacy_day'] <= 50): ?><br><small><?= $post['publication_reviewed'] ? 'Review gate cleared' : 'Review gate: locked' ?></small><?php endif; ?></td><td><?= e($post['published_at'] ?: '—') ?></td><td><div class="admin-actions"><a href="<?= e(app_url('admin/posts/edit.php?id=' . $post['id'])) ?>">Edit</a><?php if ($post['status'] === 'published'): ?><a href="<?= e(app_url('blog/' . $post['slug'])) ?>" target="_blank" rel="noopener">View</a><?php endif; ?><form class="admin-inline-form" data-confirm="Delete this post and its content?" method="post" action="<?= e(app_url('admin/posts/delete.php')) ?>"><?= csrf_field() ?><input type="hidden" name="id" value="<?= (int) $post['id'] ?>"><button class="admin-danger" type="submit">Delete</button></form></div></td></tr><?php endforeach; ?>
<?php if (!$posts): ?><tr><td colspan="5">No posts match these filters.</td></tr><?php endif; ?></tbody></table></div>
<?php admin_footer(); ?>
