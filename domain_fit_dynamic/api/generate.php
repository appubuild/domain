<?php
declare(strict_types=1);
ob_start();
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Vary: Origin');
require_once __DIR__ . '/../includes/domain-brain.php';
require_once __DIR__ . '/../includes/analytics.php';

function generator_json(array $payload, int $status = 200): never
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
        header('Vary: Origin');
    }
    http_response_code($status);
    $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    echo is_string($json) ? $json : '{"error":"The response could not be encoded as JSON."}';
    exit;
}

$origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
$fetchSite = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
$hostHeader = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
$hostParts = $hostHeader !== '' ? parse_url('http://' . $hostHeader) : false;
$originParts = $origin !== '' ? parse_url($origin) : false;
$requestHost = is_array($hostParts) ? strtolower((string) ($hostParts['host'] ?? '')) : '';
$requestScheme = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') ? 'https' : 'http';
$requestPort = is_array($hostParts) ? (int) ($hostParts['port'] ?? ($requestScheme === 'https' ? 443 : 80)) : 0;
$originHost = is_array($originParts) ? strtolower((string) ($originParts['host'] ?? '')) : '';
$originScheme = is_array($originParts) ? strtolower((string) ($originParts['scheme'] ?? '')) : '';
$originPort = is_array($originParts) ? (int) ($originParts['port'] ?? ($originScheme === 'https' ? 443 : 80)) : 0;
$originHasExtraParts = is_array($originParts) && (isset($originParts['path']) || isset($originParts['query']) || isset($originParts['fragment']) || isset($originParts['user']) || isset($originParts['pass']));
$originHeaderSafe = $origin === '' || (preg_match('~\\Ahttps?://[^/\\s]+\\z~i', $origin) === 1 && !$originHasExtraParts);
$sameOrigin = $origin === '' || ($originHeaderSafe && $originHost !== '' && $originHost === $requestHost && $originScheme === $requestScheme && $originPort === $requestPort);
if ($fetchSite === 'cross-site' || !$sameOrigin) {
    generator_json(['error' => 'Cross-origin requests are not accepted.'], 403);
}
if ($origin !== '' && $originHeaderSafe && !headers_sent()) {
    header('Access-Control-Allow-Origin: ' . $origin);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    generator_json(['error' => 'Use POST with a JSON request body.'], 405);
}
$contentLength = filter_var($_SERVER['CONTENT_LENGTH'] ?? null, FILTER_VALIDATE_INT);
if ($contentLength !== false && $contentLength !== null && $contentLength > 32768) {
    generator_json(['error' => 'The request body is too large.'], 413);
}
$contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
if ($contentType === 'application/json') {
    $rawInput = file_get_contents('php://input');
    $input = is_string($rawInput) ? json_decode($rawInput, true) : null;
    if (!is_array($input)) {
        generator_json(['error' => 'Send a valid JSON object.'], 400);
    }
} elseif (in_array($contentType, ['application/x-www-form-urlencoded', 'multipart/form-data'], true)) {
    $input = $_POST;
    if (!is_array($input)) {
        generator_json(['error' => 'Send a JSON or form-encoded request.'], 400);
    }
} else {
    generator_json(['error' => 'Use application/json or form encoding.'], 415);
}
$rootInput = $input['root'] ?? '';
$root = trim(is_scalar($rootInput) ? (string) $rootInput : '');
$rootAscii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $root);
$root = strtolower(is_string($rootAscii) ? $rootAscii : $root);
$root = preg_replace('/[^a-z0-9-]/', '', $root) ?? '';
$root = trim(substr($root, 0, 40), '-');
if ($root === '') {
    generator_json(['error' => 'Enter a root keyword using letters or numbers.'], 422);
}
$extensionInput = $input['extension'] ?? '.com';
$extension = strtolower(trim(is_scalar($extensionInput) ? (string) $extensionInput : '.com'));
$extension = ltrim($extension, '.');
$extension = preg_replace('/[^a-z0-9.-]/', '', $extension) ?? '';
$extension = preg_replace('/\.{2,}/', '.', $extension) ?? '';
$extension = trim($extension, '.-');
if ($extension === '' || strlen($extension) > 63 || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/', $extension)) {
    $extension = 'com';
}
$placementInput = $input['placement'] ?? 'both';
$placement = is_string($placementInput) && in_array($placementInput, ['prefix','suffix','both'], true) ? $placementInput : 'both';
$rawLengths = is_array($input['lengths'] ?? null) ? array_values(array_filter($input['lengths'], 'is_scalar')) : [3];
$lengthValues = array_map('intval', $rawLengths);
$lengths = array_values(array_unique(array_filter($lengthValues, static fn(int $length): bool => in_array($length, [2,3,4,5,6,7], true))));
if (!$lengths) {
    $lengths = [3];
}
$countInput = $input['count'] ?? 500;
$countParsed = filter_var(is_scalar($countInput) ? $countInput : 500, FILTER_VALIDATE_INT);
$count = max(10, min(2000, $countParsed === false ? 500 : $countParsed));
$strictInput = $input['strict'] ?? true;
$brandableInput = $input['brandable'] ?? false;
$camelInput = $input['camelCase'] ?? true;
$strict = filter_var(is_scalar($strictInput) ? $strictInput : true, FILTER_VALIDATE_BOOLEAN);
$brandable = filter_var(is_scalar($brandableInput) ? $brandableInput : false, FILTER_VALIDATE_BOOLEAN);
$camelCase = filter_var(is_scalar($camelInput) ? $camelInput : true, FILTER_VALIDATE_BOOLEAN);

try {
    $pdo = db();
    if (!allow_public_request($pdo, 'domain-generate', 30, 60)) {
        header('Retry-After: 60');
        generator_json(['error' => 'Too many generator requests. Wait a minute and try again.'], 429);
    }
    $bank = get_generator_wordbank($pdo);
} catch (Throwable $error) {
    error_log('Domain generator API: ' . $error->getMessage());
    generator_json(['error' => 'The generator is temporarily unavailable.', 'retryable' => true], 503);
}
$categoryInput = $input['category'] ?? 'smart';
$categoryKey = is_scalar($categoryInput) ? (string) $categoryInput : 'smart';
if ($categoryKey === 'smart') {
    $categoryKey = 'smart';
    foreach (($bank['categoryKeywords'] ?? []) as $key => $terms) {
        if ($key === 'smart') continue;
        foreach ($terms as $term) {
            if ($term !== '' && str_contains($root, strtolower((string) $term))) {
                $categoryKey = (string) $key;
                break 2;
            }
        }
    }
}
if (!isset($bank['categoryLabels'][$categoryKey]) || $categoryKey === 'dictionary_pure') {
    $categoryKey = 'smart';
}
$pool = [];
$seenWords = [];
$addSource = static function (array $source) use (&$pool, &$seenWords, $lengths): void {
    foreach ($source as $word) {
        $word = strtolower(trim((string) $word));
        $length = strlen($word);
        if ($length < 2 || !preg_match('/^[a-z0-9-]+$/', $word) || isset($seenWords[$word])) continue;
        $matches = false;
        foreach ($lengths as $selectedLength) {
            if (($selectedLength === 7 && $length >= 7) || ($selectedLength !== 7 && $length === $selectedLength)) {
                $matches = true;
                break;
            }
        }
        if ($matches) {
            $seenWords[$word] = true;
            $pool[] = $word;
        }
    }
};
$allCurated = array_merge(...array_values($bank['verifiedDictionary'] ?: [[]]));
$allBrandables = array_merge(...array_values($bank['creativeBrandables'] ?: [[]]));
$addSource($allCurated);
// The 7+ pool remains available in curated mode, matching the in-browser generator.
$addSource($bank['longPartnerWords'] ?? []);
if (!$strict) {
    $addSource($allBrandables);
}
$preferredSet = array_fill_keys(array_map('strtolower', $bank['categoryPreferredWords'][$categoryKey] ?? []), true);
$preferredWords = array_values(array_filter($pool, static fn(string $word): bool => isset($preferredSet[$word])));
$otherWords = array_values(array_filter($pool, static fn(string $word): bool => !isset($preferredSet[$word])));
shuffle($preferredWords);
shuffle($otherWords);
$pool = array_merge($preferredWords, $otherWords);

$pretty = static function (string $word) use ($camelCase): string {
    if (!$camelCase) return strtolower($word);
    return implode('-', array_map(static fn(string $part): string => ucfirst($part), explode('-', strtolower($word))));
};
$results = [];
$seenLabels = [];
$makeResult = static function (string $label, string $partner, bool $isPrefix, bool $isBrandable = false) use (&$results, &$seenLabels, $root, $extension, $pretty): void {
    $label = strtolower(trim(preg_replace('/[^a-z0-9-]+/i', '', $label) ?? '', '-'));
    if ($label === '' || $label === $root || strlen($label) > 63 || isset($seenLabels[$label])) return;
    $seenLabels[$label] = true;
    $domainLabel = $isBrandable ? $pretty($label) : ($isPrefix ? $pretty($root) . $pretty($partner) : $pretty($partner) . $pretty($root));
    $results[] = [
        'id' => count($results) + 1,
        'domain' => $domainLabel . '.' . $extension,
        'rootPart' => $root,
        'partnerPart' => $partner,
        'length' => strlen($partner),
        'labelLength' => strlen($label),
        'tld' => '.' . $extension,
        'isPrefix' => $isPrefix,
        'isBrandable' => $isBrandable,
    ];
};
if (!$brandable) {
    foreach ($pool as $word) {
        if ($word === $root) continue;
        if ($placement === 'prefix' || $placement === 'both') $makeResult($root . $word, $word, true);
        if ($placement === 'suffix' || $placement === 'both') $makeResult($word . $root, $word, false);
        if (count($results) >= $count) break;
    }
} else {
    $morphemes = ['ly','io','ify','eer','via','nest','tify','ora','nova','able','wise','ster','flow','labs','works','verse','scape','pilot','mint','forge','hub','base','mode','sync','mesh','mate','craft','tech','zone','loop'];
    $partners = [];
    foreach ($morphemes as $word) {
        $len = strlen($word);
        foreach ($lengths as $selectedLength) {
            if (($selectedLength === 7 && $len >= 7) || ($selectedLength !== 7 && $len === $selectedLength)) $partners[$word] = true;
        }
    }
    foreach ($pool as $word) $partners[$word] = true;
    foreach (array_keys($partners) as $word) {
        if ($placement === 'prefix' || $placement === 'both') {
            $makeResult($root . $word, $word, true, true);
            $overlap = min(4, strlen($root) - 1, strlen($word) - 1);
            for ($n = $overlap; $n >= 2; $n--) {
                if (substr($root, -$n) === substr($word, 0, $n)) {
                    $makeResult($root . substr($word, $n), $word, true, true);
                    break;
                }
            }
        }
        if ($placement === 'suffix' || $placement === 'both') {
            $makeResult($word . $root, $word, false, true);
        }
        if (count($results) >= $count) break;
    }
}
$results = array_slice($results, 0, $count);
foreach ($results as $index => &$result) $result['id'] = $index + 1;
unset($result);
generator_json([
    'root' => $root,
    'extension' => '.' . $extension,
    'category' => $categoryKey,
    'categoryLabel' => $bank['categoryLabels'][$categoryKey] ?? 'General brand',
    'requested' => $count,
    'count' => count($results),
    'fallbackWordbank' => (bool) ($bank['fallback'] ?? false),
    'availabilityChecked' => false,
    'trademarkChecked' => false,
    'message' => 'Ideas only; domain registration, availability, price and trademark status are not checked.',
    'results' => $results,
]);
