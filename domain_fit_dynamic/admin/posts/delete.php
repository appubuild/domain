<?php
require_once __DIR__ . '/../../includes/auth-check.php';
require_once __DIR__ . '/../../includes/analytics.php';
require_once __DIR__ . '/../../includes/cache.php';
admin_require_permission($pdo, $admin, 'manage_posts');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); header('Allow: POST'); exit('Method not allowed.'); }
verify_csrf();
$id = filter_var($_POST['id'] ?? null, FILTER_VALIDATE_INT);
if (!$id) { http_response_code(400); exit('Invalid post ID.'); }
$query = $pdo->prepare('SELECT title,slug FROM blog_posts WHERE id=:id LIMIT 1');
$query->execute(['id'=>$id]);
$post = $query->fetch();
if (!$post) { flash('error','Post not found.'); redirect_to('admin/posts/index.php'); }
$delete = $pdo->prepare('DELETE FROM blog_posts WHERE id=:id');
$delete->execute(['id'=>$id]);
audit_log($pdo, (int) $admin['id'], 'post.deleted', 'blog_post', (string) $id, (string) $post['slug']);
cache_clear_all();
flash('success','Post deleted.');
redirect_to('admin/posts/index.php');
