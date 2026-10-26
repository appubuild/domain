<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/functions.php';
header('Content-Type: text/plain; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=300');
try {
    $text = (string) private_setting(db(), 'ads_txt', '');
    $lines = [];
    foreach (preg_split('/\r\n|\r|\n/', $text) ?: [] as $line) {
        $line = trim($line);
        if ($line === '') continue;
        if (preg_match('/^[A-Za-z0-9.-]+\s*,\s*(?:pub-[0-9]{16}|[A-Za-z0-9-]{1,80})\s*,\s*(?:DIRECT|RESELLER)(?:\s*,\s*[A-Fa-f0-9-]{8,64})?$/i', $line)) {
            $lines[] = $line;
        }
    }
    echo $lines ? implode("\n", $lines) . "\n" : '';
} catch (Throwable $error) {
    http_response_code(503);
    echo '';
}
