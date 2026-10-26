<?php
require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
admin_require_permission($pdo, $admin, 'manage_users');
$errorMessage = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $action = request_string($_POST, 'action', '');
    try {
        if ($action === 'create') {
            $email = strtolower(trim(substr(request_string($_POST, 'email', ''), 0, 254)));
            $name = trim(substr(strip_tags(request_string($_POST, 'display_name', '')), 0, 120));
            $password = request_string($_POST, 'password', '');
            $roleId = filter_var($_POST['role_id'] ?? null, FILTER_VALIDATE_INT);
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $name === '' || strlen($password) < 12 || !$roleId) throw new RuntimeException('Enter a valid email, display name, role, and password of at least 12 characters.');
            $roleCheck = $pdo->prepare('SELECT id FROM admin_roles WHERE id=:id LIMIT 1'); $roleCheck->execute(['id'=>$roleId]);
            if (!$roleCheck->fetchColumn()) throw new RuntimeException('Selected role does not exist.');
            $pdo->beginTransaction();
            $create = $pdo->prepare("INSERT INTO admin_users (email,display_name,password_hash,status) VALUES (:email,:name,:hash,'active')");
            $create->execute(['email'=>$email,'name'=>$name,'hash'=>password_hash($password,PASSWORD_DEFAULT)]);
            $userId = (int) $pdo->lastInsertId();
            $attach = $pdo->prepare('INSERT INTO admin_user_roles (user_id,role_id) VALUES (:user,:role)');
            $attach->execute(['user'=>$userId,'role'=>$roleId]);
            $pdo->commit();
            audit_log($pdo,(int)$admin['id'],'admin.created','admin_user',(string)$userId,'Account created in admin.');
            flash('success','Administrator account created. Share the password through a secure channel.');
            redirect_to('admin/users.php');
        } elseif ($action === 'role') {
            $targetId = filter_var($_POST['user_id'] ?? null,FILTER_VALIDATE_INT);
            $roleId = filter_var($_POST['role_id'] ?? null,FILTER_VALIDATE_INT);
            if (!$targetId || !$roleId) throw new RuntimeException('Choose a valid user and role.');
            $target = $pdo->prepare('SELECT id FROM admin_users WHERE id=:id'); $target->execute(['id'=>$targetId]);
            if (!$target->fetchColumn()) throw new RuntimeException('User not found.');
            $role = $pdo->prepare('SELECT role_key FROM admin_roles WHERE id=:id'); $role->execute(['id'=>$roleId]);
            $roleKey = $role->fetchColumn();
            if (!$roleKey) throw new RuntimeException('Role not found.');
            $pdo->beginTransaction();
            $pdo->prepare('DELETE FROM admin_user_roles WHERE user_id=:id')->execute(['id'=>$targetId]);
            $pdo->prepare('INSERT INTO admin_user_roles (user_id,role_id) VALUES (:user,:role)')->execute(['user'=>$targetId,'role'=>$roleId]);
            if ($roleKey !== 'super_admin') {
                $activeSupers = (int) $pdo->query("SELECT COUNT(*) FROM admin_users u JOIN admin_user_roles ur ON ur.user_id=u.id JOIN admin_roles r ON r.id=ur.role_id WHERE u.status='active' AND r.role_key='super_admin'")->fetchColumn();
                if ($activeSupers < 1) throw new RuntimeException('At least one active super administrator must remain.');
            }
            $pdo->commit();
            audit_log($pdo,(int)$admin['id'],'admin.role_changed','admin_user',(string)$targetId,'Role: ' . $roleKey);
            flash('success','User role updated.');
            redirect_to('admin/users.php');
        } elseif ($action === 'status') {
            $targetId = filter_var($_POST['user_id'] ?? null,FILTER_VALIDATE_INT);
            $newStatus = in_array(($_POST['status'] ?? ''),['active','disabled'],true) ? (string) $_POST['status'] : '';
            if (!$targetId || $newStatus === '') throw new RuntimeException('Choose a valid status.');
            if ($targetId === (int)$admin['id'] && $newStatus === 'disabled') throw new RuntimeException('You cannot disable your own account.');
            if ($newStatus === 'disabled') {
                $isSuper = $pdo->prepare("SELECT COUNT(*) FROM admin_user_roles ur JOIN admin_roles r ON r.id=ur.role_id WHERE ur.user_id=:id AND r.role_key='super_admin'");
                $isSuper->execute(['id'=>$targetId]);
                if ((int)$isSuper->fetchColumn() > 0) {
                    $activeSupers = (int)$pdo->query("SELECT COUNT(*) FROM admin_users u JOIN admin_user_roles ur ON ur.user_id=u.id JOIN admin_roles r ON r.id=ur.role_id WHERE u.status='active' AND r.role_key='super_admin'")->fetchColumn();
                    if ($activeSupers <= 1) throw new RuntimeException('At least one active super administrator must remain.');
                }
            }
            $pdo->prepare('UPDATE admin_users SET status=:status WHERE id=:id')->execute(['status'=>$newStatus,'id'=>$targetId]);
            audit_log($pdo,(int)$admin['id'],'admin.status_changed','admin_user',(string)$targetId,'Status: ' . $newStatus);
            flash('success','User status updated.');
            redirect_to('admin/users.php');
        }
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('Admin user action: ' . $error->getMessage());
        $errorMessage = $error instanceof RuntimeException ? $error->getMessage() : 'The user update could not be completed.';
    }
}
$roles = $pdo->query('SELECT id,role_key,label,description FROM admin_roles ORDER BY id')->fetchAll();
$users = $pdo->query('SELECT u.id,u.email,u.display_name,u.status,u.last_login_at,u.created_at,GROUP_CONCAT(r.id ORDER BY r.id) AS role_ids,GROUP_CONCAT(r.label ORDER BY r.label SEPARATOR \' · \') AS role_labels FROM admin_users u LEFT JOIN admin_user_roles ur ON ur.user_id=u.id LEFT JOIN admin_roles r ON r.id=ur.role_id GROUP BY u.id ORDER BY u.created_at DESC')->fetchAll();
$rolePermissions = $pdo->query('SELECT r.label,GROUP_CONCAT(p.label ORDER BY p.label SEPARATOR \' · \') AS permissions FROM admin_roles r LEFT JOIN admin_role_permissions rp ON rp.role_id=r.id LEFT JOIN admin_permissions p ON p.id=rp.permission_id GROUP BY r.id ORDER BY r.id')->fetchAll();
admin_header($pdo,$admin,'Users & roles');
?>
<?php if ($errorMessage !== ''): ?><div class="notice notice-error" role="alert"><?= e($errorMessage) ?></div><?php endif; ?>
<section class="admin-card"><h2>Create account</h2><p>Use a unique password of at least 12 characters. The CMS stores a one-way password hash.</p><form class="admin-form" method="post"><?= csrf_field() ?><input type="hidden" name="action" value="create"><div class="form-row three"><div class="field"><label for="new-name">Display name</label><input id="new-name" name="display_name" maxlength="120" required></div><div class="field"><label for="new-email">Email</label><input id="new-email" name="email" type="email" maxlength="254" required></div><div class="field"><label for="new-password">Temporary password</label><input id="new-password" name="password" type="password" minlength="12" autocomplete="new-password" required></div></div><div class="form-row"><div class="field"><label for="new-role">Role</label><select id="new-role" name="role_id" required><?php foreach ($roles as $role): ?><option value="<?= (int)$role['id'] ?>"><?= e($role['label']) ?></option><?php endforeach; ?></select></div><div class="field"><span>&nbsp;</span><button class="button button-primary" type="submit">Create user</button></div></div></form></section>
<section class="admin-card"><h2>Accounts</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>User</th><th>Last login</th><th>Role</th><th>Status</th></tr></thead><tbody><?php foreach ($users as $user): ?><tr><td><strong><?= e($user['display_name']) ?></strong><br><small><?= e($user['email']) ?> · created <?= e($user['created_at']) ?></small></td><td><?= e($user['last_login_at'] ?: 'Never') ?></td><td><form class="admin-inline-form" method="post"><?= csrf_field() ?><input type="hidden" name="action" value="role"><input type="hidden" name="user_id" value="<?= (int)$user['id'] ?>"><select name="role_id" aria-label="Role for <?= e($user['email']) ?>"><?php foreach ($roles as $role): ?><option value="<?= (int)$role['id'] ?>" <?= in_array((string)$role['id'],explode(',',(string)$user['role_ids']),true) ? 'selected' : '' ?>><?= e($role['label']) ?></option><?php endforeach; ?></select><button type="submit">Update</button></form></td><td><form class="admin-inline-form" method="post" data-confirm="Change this account's status?"><?= csrf_field() ?><input type="hidden" name="action" value="status"><input type="hidden" name="user_id" value="<?= (int)$user['id'] ?>"><select name="status" aria-label="Status for <?= e($user['email']) ?>"><option value="active" <?= $user['status']==='active'?'selected':'' ?>>Active</option><option value="disabled" <?= $user['status']==='disabled'?'selected':'' ?>>Disabled</option></select><button type="submit">Save</button></form></td></tr><?php endforeach; ?></tbody></table></div></section>
<section class="admin-card"><h2>Role permissions</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Role</th><th>Assigned areas</th></tr></thead><tbody><?php foreach ($rolePermissions as $role): ?><tr><td><?= e($role['label']) ?></td><td><?= e($role['permissions'] ?: 'No permissions') ?></td></tr><?php endforeach; ?></tbody></table></div><p>Roles and permissions are enforced server-side for every admin page and action.</p></section>
<?php admin_footer(); ?>
