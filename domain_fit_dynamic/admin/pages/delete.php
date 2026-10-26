<?php
require_once __DIR__ . '/../../includes/auth-check.php';
require_once __DIR__ . '/../../includes/analytics.php';
require_once __DIR__ . '/../../includes/cache.php';
admin_require_permission($pdo,$admin,'manage_pages');
if($_SERVER['REQUEST_METHOD']!=='POST'){http_response_code(405);header('Allow: POST');exit('Method not allowed.');}
verify_csrf();$id=filter_var($_POST['id']??null,FILTER_VALIDATE_INT);if(!$id){http_response_code(400);exit('Invalid page ID.');}
$query=$pdo->prepare('SELECT title,slug FROM site_pages WHERE id=:id');$query->execute(['id'=>$id]);$page=$query->fetch();if(!$page){flash('error','Page not found.');redirect_to('admin/pages');}
$pdo->prepare('DELETE FROM site_pages WHERE id=:id')->execute(['id'=>$id]);audit_log($pdo,(int)$admin['id'],'page.deleted','site_page',(string)$id,(string)$page['slug']);cache_clear_all();flash('success','Page deleted.');redirect_to('admin/pages');
