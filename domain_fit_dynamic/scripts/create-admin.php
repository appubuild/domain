<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || !defined('STDIN') || !stream_isatty(STDIN)) {
    fwrite(STDERR, "Run this command from an interactive SSH terminal.\n");
    exit(1);
}
require_once dirname(__DIR__) . '/includes/functions.php';
require_once dirname(__DIR__) . '/includes/analytics.php';

function prompt(string $label): string
{
    fwrite(STDOUT, $label);
    return trim((string) fgets(STDIN));
}
function prompt_hidden(string $label): string
{
    fwrite(STDOUT, $label);
    $canHide = PHP_OS_FAMILY !== 'Windows' && function_exists('shell_exec');
    if ($canHide) @shell_exec('stty -echo 2>/dev/null');
    try {
        return rtrim((string) fgets(STDIN), "\r\n");
    } finally {
        if ($canHide) {
            @shell_exec('stty echo 2>/dev/null');
            fwrite(STDOUT, PHP_EOL);
        }
    }
}
$email = strtolower(prompt('Admin email: '));
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
    fwrite(STDERR, "Invalid email address.\n");
    exit(1);
}
$name = prompt('Display name: ');
if ($name === '' || strlen($name) > 120) {
    fwrite(STDERR, "Display name is required (up to 120 characters).\n");
    exit(1);
}
$password = prompt_hidden('Password (minimum 12 characters): ');
$confirmation = prompt_hidden('Confirm password: ');
if (strlen($password) < 12 || !hash_equals($password, $confirmation)) {
    fwrite(STDERR, "Passwords must match and contain at least 12 characters.\n");
    exit(1);
}
try {
    $pdo = db();
    $pdo->beginTransaction();
    $check = $pdo->prepare('SELECT id FROM admin_users WHERE email = :email LIMIT 1');
    $check->execute(['email' => $email]);
    if ($check->fetchColumn()) {
        throw new RuntimeException('An admin account with this email already exists.');
    }
    $insert = $pdo->prepare('INSERT INTO admin_users (email,display_name,password_hash,status) VALUES (:email,:name,:hash,\'active\')');
    $insert->execute(['email' => $email, 'name' => $name, 'hash' => password_hash($password, PASSWORD_DEFAULT)]);
    $userId = (int) $pdo->lastInsertId();
    $role = $pdo->query("SELECT id FROM admin_roles WHERE role_key = 'super_admin' LIMIT 1")->fetchColumn();
    if (!$role) throw new RuntimeException('The super_admin role is missing; import database.sql first.');
    $attach = $pdo->prepare('INSERT INTO admin_user_roles (user_id,role_id) VALUES (:user,:role)');
    $attach->execute(['user' => $userId, 'role' => $role]);
    audit_log($pdo, $userId, 'admin.created', 'admin_user', (string) $userId, 'Initial administrator created through CLI.');
    $pdo->commit();
    fwrite(STDOUT, "Administrator created. Sign in at " . app_url('admin/login') . PHP_EOL);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, 'Admin creation failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
} finally {
    unset($password, $confirmation);
}
