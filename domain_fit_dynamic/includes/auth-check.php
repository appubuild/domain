<?php
declare(strict_types=1);

require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/admin-ui.php';
apply_security_headers();
start_app_session();
$pdo = db();
$admin = admin_user($pdo);
if (!$admin) {
    unset($_SESSION['admin_id']);
    redirect_to('admin/index.php');
}
