<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
apply_security_headers();
start_app_session();
if (isset($_SESSION['admin_id'])) {
    try {
        $existingPdo = db();
        if (admin_user($existingPdo)) redirect_to('admin/dashboard.php');
    } catch (Throwable $error) {
        // Render a generic configuration message below.
    }
}
$errorMessage = '';
$pdo = null;
try {
    $pdo = db();
} catch (Throwable $error) {
    error_log('Admin login database: ' . $error->getMessage());
    $errorMessage = 'The site database is not ready. Check the environment variables and import database.sql.';
}
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $pdo instanceof PDO) {
    $posted = request_string($_POST, '_csrf', '');
    $known = (string) ($_SESSION['_csrf'] ?? '');
    $email = strtolower(trim(substr(request_string($_POST, 'email', ''), 0, 254)));
    $password = request_string($_POST, 'password', '');
    if ($posted === '' || $known === '' || !hash_equals($known, $posted)) {
        $errorMessage = 'Your sign-in session expired. Refresh and try again.';
    } elseif (getenv('APP_SECRET') === false || strlen((string) getenv('APP_SECRET')) < 32) {
        $errorMessage = 'Admin sign-in is disabled until a unique APP_SECRET of at least 32 characters is configured.';
    } else {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        $rateKey = hash_hmac('sha256', $ip, (string) getenv('APP_SECRET'));
        $limitQuery = $pdo->prepare('SELECT failures, locked_until, (locked_until > UTC_TIMESTAMP()) AS is_locked, (window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)) AS is_expired FROM admin_login_limits WHERE ip_hash=:ip LIMIT 1');
        $limitQuery->execute(['ip' => $rateKey]);
        $limit = $limitQuery->fetch();
        if ($limit && (int) $limit['is_locked'] === 1) {
            $errorMessage = 'Invalid email or password. Please wait before trying again.';
        } else {
            $userQuery = $pdo->prepare("SELECT id,email,display_name,password_hash,status FROM admin_users WHERE email=:email AND status='active' LIMIT 1");
            $userQuery->execute(['email' => $email]);
            $user = $userQuery->fetch();
            $dummyHash = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
            $passwordOk = password_verify($password, $user ? (string) $user['password_hash'] : $dummyHash);
            if ($user && $passwordOk) {
                if (password_needs_rehash((string) $user['password_hash'], PASSWORD_DEFAULT)) {
                    $rehash = $pdo->prepare('UPDATE admin_users SET password_hash=:hash WHERE id=:id');
                    $rehash->execute(['hash' => password_hash($password, PASSWORD_DEFAULT), 'id' => $user['id']]);
                }
                session_regenerate_id(true);
                unset($_SESSION['_csrf']);
                $_SESSION['admin_id'] = (int) $user['id'];
                $pdo->prepare('UPDATE admin_users SET last_login_at=UTC_TIMESTAMP() WHERE id=:id')->execute(['id' => $user['id']]);
                $pdo->prepare('DELETE FROM admin_login_limits WHERE ip_hash=:ip')->execute(['ip' => $rateKey]);
                audit_log($pdo, (int) $user['id'], 'admin.login', 'admin_user', (string) $user['id']);
                redirect_to('admin/dashboard.php');
            }
            $nowSql = 'UTC_TIMESTAMP()';
            if (!$limit) {
                $insert = $pdo->prepare("INSERT INTO admin_login_limits (ip_hash,failures,window_started_at) VALUES (:ip,1,$nowSql)");
                $insert->execute(['ip' => $rateKey]);
            } elseif ((int) $limit['is_expired'] === 1) {
                $reset = $pdo->prepare("UPDATE admin_login_limits SET failures=1,window_started_at=$nowSql,locked_until=NULL WHERE ip_hash=:ip");
                $reset->execute(['ip' => $rateKey]);
            } else {
                $failures = (int) $limit['failures'] + 1;
                if ($failures >= 5) {
                    $update = $pdo->prepare("UPDATE admin_login_limits SET failures=:failures,locked_until=DATE_ADD($nowSql,INTERVAL 15 MINUTE) WHERE ip_hash=:ip");
                } else {
                    $update = $pdo->prepare('UPDATE admin_login_limits SET failures=:failures WHERE ip_hash=:ip');
                }
                $update->execute(['failures' => $failures, 'ip' => $rateKey]);
            }
            $errorMessage = 'Invalid email or password.';
        }
    }
}
?>
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Admin sign in · DomainFits</title><link rel="stylesheet" href="<?= e(asset_url('css/style.css')) ?>"><link rel="stylesheet" href="<?= e(asset_url('css/dynamic.css')) ?>"></head><body class="admin-body"><main class="login-wrap"><section class="login-card"><a class="brand" href="<?= e(app_url('index.php')) ?>"><img src="<?= e(asset_url('img/logo.svg')) ?>" alt=""><span><?= e($pdo instanceof PDO ? setting($pdo, 'site_title', 'DomainFits') : 'DomainFits') ?></span></a><h1>Sign in</h1><p>Use an administrator account created through the command line.</p>
<?php if ($errorMessage !== ''): ?><div class="notice notice-error" role="alert"><?= e($errorMessage) ?></div><?php endif; ?>
<?php if ($pdo instanceof PDO): ?><form class="admin-form" method="post" action="<?= e(app_url('admin/index.php')) ?>"><?= csrf_field() ?><div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required value="<?= e(request_string($_POST, 'email')) ?>"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><button class="button button-primary" type="submit">Sign in</button></form><?php endif; ?>
</section></main></body></html>
