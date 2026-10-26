<?php
declare(strict_types=1);

require_once __DIR__ . '/functions.php';

function encrypt_private_secret(string $plaintext): string
{
    if (!function_exists('openssl_encrypt')) {
        throw new RuntimeException('OpenSSL is required to securely store the Gemini key.');
    }
    $masterKey = (string) (getenv('APP_SECRET') ?: '');
    if (strlen($masterKey) < 32) {
        throw new RuntimeException('Set a strong APP_SECRET of at least 32 characters before storing an API key.');
    }
    $iv = random_bytes(12);
    $tag = '';
    $key = hash('sha256', $masterKey, true);
    $ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    if (!is_string($ciphertext) || strlen($tag) !== 16) {
        throw new RuntimeException('The Gemini API key could not be encrypted.');
    }
    return 'enc:v1:' . base64_encode($iv . $tag . $ciphertext);
}

function decrypt_private_secret(string $stored): string
{
    if (!str_starts_with($stored, 'enc:v1:') || !function_exists('openssl_decrypt')) {
        return '';
    }
    $masterKey = (string) (getenv('APP_SECRET') ?: '');
    if (strlen($masterKey) < 32) {
        return '';
    }
    $payload = base64_decode(substr($stored, 7), true);
    if (!is_string($payload) || strlen($payload) < 29) {
        return '';
    }
    $iv = substr($payload, 0, 12);
    $tag = substr($payload, 12, 16);
    $ciphertext = substr($payload, 28);
    $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', hash('sha256', $masterKey, true), OPENSSL_RAW_DATA, $iv, $tag);
    return is_string($plaintext) ? $plaintext : '';
}

function gemini_api_key(PDO $pdo): string
{
    $environmentKey = trim((string) (getenv('GEMINI_API_KEY') ?: ''));
    if ($environmentKey !== '') {
        return strlen($environmentKey) <= 512 && preg_match('/[\r\n\x00]/', $environmentKey) !== 1 ? $environmentKey : '';
    }
    $stored = private_setting($pdo, 'gemini_api_key', '');
    return is_string($stored) ? decrypt_private_secret($stored) : '';
}

function gemini_api_key_configured(PDO $pdo): bool
{
    return gemini_api_key($pdo) !== '';
}

/** Generate suggestions server-side. API credentials and request URLs are never returned or logged. */
function gemini_word_suggestions(PDO $pdo, string $niche, array $seeds): array
{
    $apiKey = gemini_api_key($pdo);
    if ($apiKey === '') {
        throw new RuntimeException('Gemini is not configured. Add an encrypted key in Site settings or set GEMINI_API_KEY in the server environment.');
    }

    $model = trim((string) (getenv('GEMINI_MODEL') ?: 'gemini-2.5-flash'));
    if (!preg_match('/^[a-zA-Z0-9._-]{3,80}$/', $model)) {
        $model = 'gemini-2.5-flash';
    }

    $seedList = array_values(array_unique(array_slice(array_map(static fn($seed): string => trim((string) $seed), $seeds), 0, 5)));
    $prompt = "You are a careful naming brainstorm assistant. Return JSON only. Generate 100 distinct, lowercase, alphabetic partner words for a domain-name wordbank. "
        . "The niche is: " . $niche . ". Seed keywords: " . implode(', ', $seedList) . ". "
        . "Every word must be 2 to 6 English letters long; distribute suggestions across the exact length categories 2L, 3L, 4L, 5L and 6L. "
        . "Mix ordinary vocabulary candidates and coined/brandable strings. Do not include spaces, hyphens, digits, domains, TLDs, company names or intentionally recognizable trademarks. "
        . "For each item return word, partner_length (2L through 6L), term_type_hint (curated or brandable), model_claimed_english (boolean), and a short context note. "
        . "A model claim is not proof that a term is valid English or legally available. Do not state or imply verification.";

    $schema = [
        'type' => 'OBJECT',
        'properties' => [
            'words' => [
                'type' => 'ARRAY',
                'items' => [
                    'type' => 'OBJECT',
                    'properties' => [
                        'word' => ['type' => 'STRING'],
                        'partner_length' => ['type' => 'STRING', 'enum' => ['2L','3L','4L','5L','6L']],
                        'term_type_hint' => ['type' => 'STRING', 'enum' => ['curated','brandable']],
                        'model_claimed_english' => ['type' => 'BOOLEAN'],
                        'note' => ['type' => 'STRING'],
                    ],
                    'required' => ['word','partner_length','term_type_hint','model_claimed_english','note'],
                ],
            ],
        ],
        'required' => ['words'],
    ];
    $requestBody = json_encode([
        'contents' => [['role' => 'user', 'parts' => [['text' => $prompt]]]],
        'generationConfig' => [
            'temperature' => 0.7,
            'maxOutputTokens' => 8192,
            'responseMimeType' => 'application/json',
            'responseSchema' => $schema,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent?key=' . rawurlencode($apiKey);
    $status = 0;
    $responseBody = false;
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $requestBody,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 45,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $responseBody = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $curlFailed = $responseBody === false;
        curl_close($curl);
        if ($curlFailed) {
            error_log('Gemini API request failed before receiving a response.');
            throw new RuntimeException('The Gemini service could not be reached. Check hosting outbound HTTPS and try again.');
        }
    } else {
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
            'content' => $requestBody,
            'timeout' => 45,
            'ignore_errors' => true,
        ]]);
        $responseBody = @file_get_contents($url, false, $context);
        foreach (($http_response_header ?? []) as $header) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', (string) $header, $match)) $status = (int) $match[1];
        }
    }

    if (!is_string($responseBody) || $status < 200 || $status >= 300) {
        error_log('Gemini API returned HTTP status ' . $status . '.');
        throw new RuntimeException($status === 429
            ? 'Gemini request quota was reached. Wait and try again.'
            : 'Gemini did not return a usable response. Check the API key, model and server network configuration.');
    }
    $decoded = json_decode($responseBody, true);
    $textParts = $decoded['candidates'][0]['content']['parts'] ?? null;
    if (!is_array($textParts)) {
        error_log('Gemini response did not contain a candidate text payload.');
        throw new RuntimeException('Gemini returned no word list. Try a shorter niche description.');
    }
    $responseText = '';
    foreach ($textParts as $part) {
        if (is_array($part) && isset($part['text']) && is_string($part['text'])) $responseText .= $part['text'];
    }
    $wordData = json_decode($responseText, true);
    $rawItems = is_array($wordData) ? ($wordData['words'] ?? []) : [];
    if (!is_array($rawItems)) {
        throw new RuntimeException('Gemini returned an unexpected list format. Try generating again.');
    }

    $items = [];
    $seen = [];
    foreach ($rawItems as $item) {
        if (!is_array($item)) continue;
        $word = strtolower(trim((string) ($item['word'] ?? '')));
        $length = strlen($word);
        if ($length < 2 || $length > 6 || preg_match('/^[a-z]{2,6}$/', $word) !== 1 || isset($seen[$word])) continue;
        $seen[$word] = true;
        $hint = in_array(($item['term_type_hint'] ?? ''), ['curated','brandable'], true) ? (string) $item['term_type_hint'] : 'brandable';
        $note = trim(substr(strip_tags((string) ($item['note'] ?? '')), 0, 160));
        $items[] = [
            'word' => $word,
            'partner_length' => $length,
            'length_category' => $length . 'L',
            'term_type_hint' => $hint,
            'model_claimed_english' => filter_var($item['model_claimed_english'] ?? false, FILTER_VALIDATE_BOOLEAN),
            'note' => $note,
        ];
        if (count($items) >= 250) break;
    }
    if (!$items) {
        error_log('Gemini response contained no valid 2L-6L lowercase alphabetic terms.');
        throw new RuntimeException('Gemini did not return valid 2L–6L terms. Try again with different seeds.');
    }
    return $items;
}
