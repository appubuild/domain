<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/analytics.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$isAjax = str_contains((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json') || (string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') === 'XMLHttpRequest';
if ($isAjax) header('Content-Type: application/json; charset=utf-8');

function contact_respond(bool $ok, string $message, int $status = 200): never
{
    global $isAjax;
    if (!$isAjax) {
        flash($ok ? 'contact_success' : 'contact_error', $message);
        redirect_to('pages/contact#contact-form', 303);
    }
    http_response_code($status);
    echo json_encode(['ok' => $ok, 'message' => $message], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    contact_respond(false, 'Method not allowed.', 405);
}
if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
    contact_respond(false, 'Request not accepted.', 403);
}
start_app_session();
$postedToken = is_string($_POST['_csrf'] ?? null) ? $_POST['_csrf'] : '';
$sessionToken = is_string($_SESSION['_csrf'] ?? null) ? $_SESSION['_csrf'] : '';
if ($postedToken === '' || $sessionToken === '' || !hash_equals($sessionToken, $postedToken)) {
    contact_respond(false, 'Your form session expired. Refresh and try again.', 419);
}
if (trim(is_string($_POST['company_website'] ?? null) ? $_POST['company_website'] : '') !== '') {
    contact_respond(true, 'Thanks. Your message has been received.');
}
$now = time();
if (isset($_SESSION['contact_last_submit']) && ($now - (int) $_SESSION['contact_last_submit']) < 15) {
    contact_respond(false, 'Please wait a moment before sending another message.', 429);
}
$nameInput = $_POST['name'] ?? '';
$emailInput = $_POST['email'] ?? '';
$topicInput = $_POST['topic'] ?? '';
$messageInput = $_POST['message'] ?? '';
$name = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', is_scalar($nameInput) ? (string) $nameInput : '') ?? '');
$email = trim(is_scalar($emailInput) ? (string) $emailInput : '');
$topic = trim(is_scalar($topicInput) ? (string) $topicInput : '');
$message = trim(preg_replace('/\r\n?/', "\n", is_scalar($messageInput) ? (string) $messageInput : '') ?? '');
$topics = ['General question','Technical issue','Correction or feedback','Privacy request'];
if ($name === '' || strlen($name) > 100 || strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL) || !in_array($topic, $topics, true) || strlen($message) < 10 || strlen($message) > 5000) {
    contact_respond(false, 'Please check the required fields and try again.', 422);
}
$message = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $message) ?? '';
try {
    $pdo = db();
    if (!allow_public_request($pdo, 'contact-submit', 5, 3600)) {
        header('Retry-After: 3600');
        contact_respond(false, 'Too many messages were sent from this network. Please try again later.', 429);
    }
    $query = $pdo->prepare('INSERT INTO contact_messages (name,email,topic,subject,message) VALUES (:name,:email,:topic,:subject,:message)');
    $query->execute(['name' => $name, 'email' => $email, 'topic' => $topic, 'subject' => $topic, 'message' => $message]);
    $_SESSION['contact_last_submit'] = $now;
    contact_respond(true, 'Thanks — your message has been received.');
} catch (Throwable $error) {
    error_log('Contact submission: ' . $error->getMessage());
    contact_respond(false, 'We could not save your message just now. Please try again later.', 503);
}
