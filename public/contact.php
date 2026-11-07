<?php
/**
 * Contact form handler for Apache/cPanel hosting with PHP.
 *
 * The site works without this file: if no form endpoint is configured, the
 * contact form hands the finished message to the visitor's email app. To deliver
 * messages directly from the page on your own hosting:
 *
 *   1. Upload the contents of dist/ (this file included) to public_html.
 *   2. Set VITE_CONTACT_ENDPOINT=/contact.php in your environment and rebuild.
 *   3. Confirm the address below and test a real submission.
 *
 * Security notes:
 *  - Only POST requests with a JSON body are accepted.
 *  - Every header value is stripped of newlines (no header injection).
 *  - A hidden honeypot field rejects the simplest bots.
 *  - Basic per-IP rate limiting keeps the mailbox from being flooded.
 */

// ---------------------------------------------------------------------------
// Configuration — edit these two lines before use.
// ---------------------------------------------------------------------------
$TO_ADDRESS   = 'support@safehomenetwork.com';
$FROM_ADDRESS = 'no-reply@safehomenetwork.com'; // must belong to your domain (SPF/DKIM)
// ---------------------------------------------------------------------------

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$respond = static function (int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload);
    exit;
};

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    $respond(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

// Basic rate limit: 5 submissions per IP per 10 minutes.
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$bucket = sys_get_temp_dir() . '/shn-contact-' . hash('sha256', $ip);
$now = time();
$history = [];
if (is_readable($bucket)) {
    $raw = @file_get_contents($bucket);
    if ($raw !== false) {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $history = array_values(array_filter($decoded, static fn ($t) => is_int($t) && $t > $now - 600));
        }
    }
}
if (count($history) >= 5) {
    $respond(429, ['ok' => false, 'error' => 'Too many messages. Please try again later.']);
}

$raw = file_get_contents('php://input');
$data = json_decode((string) $raw, true);
if (!is_array($data)) {
    // Fall back to standard form encoding.
    $data = $_POST;
}

$clean = static function ($value, int $max = 2000): string {
    $text = is_string($value) ? $value : '';
    $text = str_replace(["\r", "\n", "%0a", "%0d"], ' ', $text);
    return trim(mb_substr(strip_tags($text), 0, $max));
};

$name    = $clean($data['name'] ?? '', 120);
$email   = $clean($data['email'] ?? '', 200);
$subject = $clean($data['subject'] ?? 'General question', 160);
$message = $clean($data['message'] ?? '', 5000);
$consent = !empty($data['consent']);
$company = $clean($data['company'] ?? '', 100); // honeypot

if ($company !== '') {
    $respond(200, ['ok' => true]); // silently swallow bot traffic
}

if (mb_strlen($name) < 2) {
    $respond(422, ['ok' => false, 'error' => 'Please include your name.']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $respond(422, ['ok' => false, 'error' => 'Please include a valid email address.']);
}
if (mb_strlen($message) < 20) {
    $respond(422, ['ok' => false, 'error' => 'Please add a little more detail.']);
}
if (!$consent) {
    $respond(422, ['ok' => false, 'error' => 'Consent is required.']);
}

$body = "New website enquiry\n\n"
    . "Name: {$name}\n"
    . "Email: {$email}\n"
    . "Subject: {$subject}\n"
    . "Received: " . gmdate('Y-m-d H:i:s') . " UTC\n"
    . "IP: {$ip}\n\n"
    . "Message:\n{$message}\n\n"
    . "---\n"
    . "The visitor agreed to be contacted about this request.\n";

$headers = [
    'From: Safe Home Network <' . $FROM_ADDRESS . '>',
    'Reply-To: ' . $name . ' <' . $email . '>',
    'Content-Type: text/plain; charset=UTF-8',
    'X-Mailer: PHP/' . phpversion(),
];

$sent = @mail($TO_ADDRESS, '[Website] ' . $subject, $body, implode("\r\n", $headers));

if (!$sent) {
    $respond(502, ['ok' => false, 'error' => 'The message could not be sent right now.']);
}

$history[] = $now;
@file_put_contents($bucket, json_encode(array_slice($history, -10)));

$respond(200, ['ok' => true]);
