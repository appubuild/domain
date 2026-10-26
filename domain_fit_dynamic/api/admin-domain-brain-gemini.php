<?php
declare(strict_types=1);

ob_start();
require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/gemini.php';
require_once __DIR__ . '/../includes/analytics.php';
require_once __DIR__ . '/../includes/cache.php';

function gemini_admin_json(array $payload, int $status = 200): never
{
    while (ob_get_level() > 0) ob_end_clean();
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
    }
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

if (!has_permission($pdo, (int) $admin['id'], 'manage_wordbank')) {
    gemini_admin_json(['error' => 'You do not have permission to manage the wordbank.'], 403);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    gemini_admin_json(['error' => 'Use POST.'], 405);
}
$origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
$fetchSite = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
if ($fetchSite === 'cross-site') gemini_admin_json(['error' => 'Cross-origin requests are not accepted.'], 403);
if ($origin !== '') {
    $originParts = parse_url($origin);
    $hostHeader = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $requestParts = $hostHeader !== '' ? parse_url('http://' . $hostHeader) : false;
    $requestScheme = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') ? 'https' : 'http';
    $originScheme = is_array($originParts) ? strtolower((string) ($originParts['scheme'] ?? '')) : '';
    $originHost = is_array($originParts) ? strtolower((string) ($originParts['host'] ?? '')) : '';
    $requestHost = is_array($requestParts) ? strtolower((string) ($requestParts['host'] ?? '')) : '';
    $originPort = is_array($originParts) ? (int) ($originParts['port'] ?? ($originScheme === 'https' ? 443 : 80)) : 0;
    $requestPort = is_array($requestParts) ? (int) ($requestParts['port'] ?? ($requestScheme === 'https' ? 443 : 80)) : 0;
    $originHasExtraParts = is_array($originParts) && (isset($originParts['path']) || isset($originParts['query']) || isset($originParts['fragment']) || isset($originParts['user']) || isset($originParts['pass']));
    if (preg_match('~\\Ahttps?://[^/\\s]+\\z~i', $origin) !== 1 || $originHasExtraParts || $originScheme !== $requestScheme || $originHost === '' || $originHost !== $requestHost || $originPort !== $requestPort) {
        gemini_admin_json(['error' => 'Cross-origin requests are not accepted.'], 403);
    }
}
$contentLength = filter_var($_SERVER['CONTENT_LENGTH'] ?? null, FILTER_VALIDATE_INT);
if ($contentLength !== false && $contentLength !== null && $contentLength > 262144) {
    gemini_admin_json(['error' => 'The request is too large.'], 413);
}
$rawBody = file_get_contents('php://input');
$input = is_string($rawBody) ? json_decode($rawBody, true) : null;
if (!is_array($input)) gemini_admin_json(['error' => 'Send a valid JSON object.'], 400);
$knownToken = (string) ($_SESSION['_csrf'] ?? '');
$postedToken = is_scalar($input['_csrf'] ?? null) ? (string) $input['_csrf'] : '';
if ($knownToken === '' || $postedToken === '' || !hash_equals($knownToken, $postedToken)) {
    gemini_admin_json(['error' => 'Your session expired. Refresh the page and try again.'], 419);
}

$action = is_string($input['action'] ?? null) ? (string) $input['action'] : '';
if (!in_array($action, ['preview','insert'], true)) gemini_admin_json(['error' => 'Choose a supported action.'], 422);
if ($action === 'preview') {
    $now = time();
    $requests = array_filter((array) ($_SESSION['_gemini_preview_times'] ?? []), static fn($time): bool => is_int($time) && $time > $now - 3600);
    if (count($requests) >= 8) gemini_admin_json(['error' => 'Gemini preview limit reached for this session. Try again later.'], 429);
    if ($requests && $now - max($requests) < 4) gemini_admin_json(['error' => 'Please wait a few seconds before generating another list.'], 429);
    $requests[] = $now;
    $_SESSION['_gemini_preview_times'] = array_values($requests);
}

$nicheRaw = trim(strip_tags(is_scalar($input['niche'] ?? null) ? (string) $input['niche'] : ''));
$niche = preg_match('/^.{0,100}/us', $nicheRaw, $nicheMatch) === 1 ? $nicheMatch[0] : substr($nicheRaw, 0, 100);
$seedInput = $input['seeds'] ?? [];
if (is_string($seedInput)) $seedInput = preg_split('/[,\r\n]+/', $seedInput) ?: [];
$seeds = [];
if (is_array($seedInput)) {
    foreach ($seedInput as $seed) {
        if (!is_scalar($seed)) continue;
        $seed = strtolower(trim(substr(strip_tags((string) $seed), 0, 48)));
        if ($seed !== '' && preg_match('/^[a-z0-9]+(?:[ -][a-z0-9]+)*$/', $seed) === 1) $seeds[] = $seed;
    }
}
$seeds = array_values(array_unique($seeds));
if ($niche === '' || count($seeds) < 3 || count($seeds) > 5) {
    gemini_admin_json(['error' => 'Enter a niche and between three and five seed keywords.'], 422);
}

if ($action === 'preview') {
    try {
        $items = gemini_word_suggestions($pdo, $niche, $seeds);
        gemini_admin_json([
            'items' => $items,
            'count' => count($items),
            'message' => 'Gemini suggestions are unverified ideas. No English-dictionary, availability, trademark or legal verification is implied.',
        ]);
    } catch (Throwable $error) {
        error_log('Gemini wordbank preview: ' . $error->getMessage());
        $message = $error instanceof RuntimeException ? $error->getMessage() : 'The Gemini request failed. Check the private error log.';
        $status = str_contains(strtolower($message), 'not configured') ? 503 : 422;
        gemini_admin_json(['error' => $message], $status);
    }
}

$rawItems = $input['items'] ?? null;
if (!is_array($rawItems) || !$rawItems || count($rawItems) > 250) {
    gemini_admin_json(['error' => 'Select at least one and no more than 250 previewed terms.'], 422);
}
$items = [];
$seen = [];
foreach ($rawItems as $rawItem) {
    if (!is_array($rawItem)) continue;
    $word = strtolower(trim(substr((string) ($rawItem['word'] ?? ''), 0, 8)));
    $length = filter_var($rawItem['partner_length'] ?? null, FILTER_VALIDATE_INT);
    if (!is_int($length) || $length < 2 || $length > 6 || strlen($word) !== $length || preg_match('/^[a-z]{2,6}$/', $word) !== 1 || isset($seen[$word])) continue;
    $seen[$word] = true;
    $items[] = ['word' => $word, 'length' => $length];
}
if (!$items) gemini_admin_json(['error' => 'No valid 2L–6L terms were selected. Generate a fresh preview and try again.'], 422);

$categoryMode = is_string($input['category_mode'] ?? null) ? (string) $input['category_mode'] : 'create';
$categoryId = null;
$categoryLabel = '';
try {
    $pdo->beginTransaction();
    if ($categoryMode === 'create') {
        $categoryKeyBase = strtolower(str_replace('-', '_', slugify($niche)));
        $categoryKeyBase = preg_replace('/[^a-z0-9_]/', '', $categoryKeyBase) ?? '';
        if ($categoryKeyBase === '' || !preg_match('/^[a-z]/', $categoryKeyBase)) $categoryKeyBase = 'niche_' . $categoryKeyBase;
        $categoryKey = 'ai_' . substr($categoryKeyBase, 0, 56);
        $categoryKey = rtrim($categoryKey, '_');
        if (strlen($categoryKey) < 3) $categoryKey = 'ai_niche';
        $keywordSet = [];
        foreach ($seeds as $seed) {
            foreach (preg_split('/[ -]+/', $seed) ?: [] as $part) {
                if (strlen($part) >= 2 && preg_match('/^[a-z0-9-]{2,48}$/', $part)) $keywordSet[$part] = true;
            }
        }
        $preferred = array_slice(array_column($items, 'word'), 0, 100);
        $find = $pdo->prepare('SELECT id,label,detection_keywords_json,preferred_words_json FROM wordbank_categories WHERE category_key=:key LIMIT 1');
        $find->execute(['key' => $categoryKey]);
        $found = $find->fetch();
        if ($found) {
            $categoryId = (int) $found['id'];
            $categoryLabel = (string) $found['label'];
            foreach (json_decode((string) $found['detection_keywords_json'], true) ?: [] as $existingKeyword) $keywordSet[(string) $existingKeyword] = true;
            $preferred = array_values(array_unique(array_merge(json_decode((string) $found['preferred_words_json'], true) ?: [], $preferred)));
            $updateCategory = $pdo->prepare('UPDATE wordbank_categories SET detection_keywords_json=:keywords,preferred_words_json=:preferred,updated_by=:admin WHERE id=:id');
            $updateCategory->execute([
                'keywords' => json_encode(array_slice(array_keys($keywordSet), 0, 150), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'preferred' => json_encode(array_slice($preferred, 0, 150), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'admin' => (int) $admin['id'], 'id' => $categoryId,
            ]);
        } else {
            $categoryLabel = $niche;
            $description = 'AI-assisted wordbank suggestions from Gemini. Terms remain unverified until human review.';
            $create = $pdo->prepare('INSERT INTO wordbank_categories (category_key,label,description,detection_keywords_json,preferred_words_json,display_order,is_active,updated_by) VALUES (:key,:label,:description,:keywords,:preferred,1000,1,:admin)');
            $create->execute([
                'key' => $categoryKey,
                'label' => $categoryLabel,
                'description' => $description,
                'keywords' => json_encode(array_keys($keywordSet), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'preferred' => json_encode($preferred, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'admin' => (int) $admin['id'],
            ]);
            $categoryId = (int) $pdo->lastInsertId();
        }
    } else {
        $candidateId = filter_var($input['category_id'] ?? null, FILTER_VALIDATE_INT);
        if ($candidateId === false || $candidateId < 1) throw new RuntimeException('Choose a valid Domain Brain category.');
        $find = $pdo->prepare('SELECT id,label FROM wordbank_categories WHERE id=:id AND is_active=1 LIMIT 1');
        $find->execute(['id' => $candidateId]);
        $found = $find->fetch();
        if (!$found) throw new RuntimeException('The selected Domain Brain category is unavailable.');
        $categoryId = (int) $found['id'];
        $categoryLabel = (string) $found['label'];
    }

    $insert = $pdo->prepare("INSERT IGNORE INTO wordbank_terms (word,term_type,english_reviewed,category_id,partner_length,verification_status,source,is_active,note,created_by,updated_by)
        VALUES (:word,'brandable',0,:category,:length,'unverified','gemini',1,:note,:created,:updated)");
    $inserted = 0;
    foreach ($items as $item) {
        $note = 'Gemini suggestion; unverified; human review required.';
        $insert->execute([
            'word' => $item['word'],
            'category' => $categoryId,
            'length' => $item['length'],
            'note' => substr($note, 0, 255),
            'created' => (int) $admin['id'],
            'updated' => (int) $admin['id'],
        ]);
        $inserted += $insert->rowCount() > 0 ? 1 : 0;
    }
    $duplicates = count($items) - $inserted;
    audit_log($pdo, (int) $admin['id'], 'wordbank.gemini_bulk_inserted', 'wordbank_category', (string) $categoryId, $inserted . ' inserted; ' . $duplicates . ' duplicate terms skipped.');
    $pdo->commit();
    cache_clear_all();
    gemini_admin_json([
        'inserted' => $inserted,
        'duplicates' => $duplicates,
        'category_id' => $categoryId,
        'category_label' => $categoryLabel,
        'message' => 'Inserted as unverified brandable suggestions. Human review is required before classifying any term as reviewed English vocabulary.',
    ]);
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('Gemini wordbank bulk insert: ' . $error->getMessage());
    $message = $error instanceof RuntimeException ? $error->getMessage() : 'The wordbank could not be updated. Check for a database constraint or duplicate category.';
    gemini_admin_json(['error' => $message], 422);
}
