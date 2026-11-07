<?php
/**
 * Dependency-free test harness for the API's pure logic.
 *
 * Run with the PHP CLI from the api/ folder:
 *     php tests/run-tests.php
 *
 * It does not touch MySQL: validation, sanitising, the script allow-list,
 * number normalisation, the honeypot and the route table are all exercised
 * in-process. Database-backed endpoints are covered by tests/http-smoke.php
 * and the manual checklist in docs/TESTING.md.
 */

declare(strict_types=1);

use Shn\Helpers\ApiException;
use Shn\Helpers\Request;
use Shn\Helpers\Router;
use Shn\Helpers\Security;
use Shn\Helpers\Validator;
use Shn\Models\PhoneNumberModel;
use Shn\Services\HoneypotService;

$_SERVER['SCRIPT_NAME'] = '/api/index.php';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';

require dirname(__DIR__) . '/helpers/bootstrap.php';

$passed = 0;
$failed = 0;
$failures = [];

function check(string $label, bool $condition, string $detail = ''): void
{
    global $passed, $failed, $failures;

    if ($condition) {
        $passed++;
        return;
    }

    $failed++;
    $failures[] = $label . ($detail !== '' ? ' — ' . $detail : '');
    fwrite(STDERR, "FAIL  {$label}" . ($detail !== '' ? " — {$detail}" : '') . PHP_EOL);
}

function expectException(string $label, callable $callback, int $status): void
{
    try {
        $callback();
        check($label, false, 'no exception thrown');
    } catch (ApiException $exception) {
        check($label, $exception->status() === $status, 'status ' . $exception->status());
    } catch (Throwable $error) {
        check($label, false, get_class($error) . ': ' . $error->getMessage());
    }
}

/* ---------------------------------------------------------------------- */
/*  Validator                                                             */
/* ---------------------------------------------------------------------- */

$data = Validator::validate(
    ['name' => '  Safe Home  ', 'email' => 'info@safehomenetwork.com', 'extra' => 'dropped', 'active' => '1'],
    ['name' => 'required|string|min:2|max:40', 'email' => 'required|email', 'active' => 'nullable|bool'],
);
check('validator trims strings', $data['name'] === 'Safe Home', $data['name']);
check('validator drops unknown keys', !array_key_exists('extra', $data));
check('validator casts booleans', $data['active'] === true);

expectException('validator rejects missing required field', static function (): void {
    Validator::validate([], ['name' => 'required|string']);
}, 422);

expectException('validator rejects malformed email', static function (): void {
    Validator::validate(['email' => 'not-an-email'], ['email' => 'required|email']);
}, 422);

expectException('validator rejects bad slug', static function (): void {
    Validator::validate(['slug' => 'Bad Slug!'], ['slug' => 'required|slug']);
}, 422);

expectException('validator enforces max length', static function (): void {
    Validator::validate(['title' => str_repeat('a', 30)], ['title' => 'required|string|max:10']);
}, 422);

expectException('validator enforces enum', static function (): void {
    Validator::validate(['status' => 'archived'], ['status' => 'required|in:published,draft']);
}, 422);

$validated = Validator::validate(['sort_order' => '12'], ['sort_order' => 'nullable|int']);
check('validator casts integers', $validated['sort_order'] === 12);

check('slugify strips punctuation', Validator::slugify('Hello, World! 2026') === 'hello-world-2026');

/* ---------------------------------------------------------------------- */
/*  Rich text                                                             */
/* ---------------------------------------------------------------------- */

$dirty = '<p onclick="steal()">Safe <strong>text</strong></p><script>alert(1)</script>'
    . '<a href="javascript:alert(1)">bad</a><a href="https://example.com" target="_blank">ok</a>'
    . '<iframe src="https://evil.test"></iframe>';
$clean = Security::sanitizeHtml($dirty);

check('sanitizer removes script tags', !str_contains(strtolower($clean), '<script'), $clean);
check('sanitizer removes event handlers', !str_contains($clean, 'onclick'), $clean);
check('sanitizer removes javascript: URLs', !str_contains($clean, 'javascript:'), $clean);
check('sanitizer removes iframes', !str_contains(strtolower($clean), '<iframe'), $clean);
check('sanitizer keeps allowed markup', str_contains($clean, '<strong>text</strong>'), $clean);
check('sanitizer hardens target=_blank', str_contains($clean, 'rel="noopener noreferrer"'), $clean);

/* ---------------------------------------------------------------------- */
/*  Script allow-list                                                     */
/* ---------------------------------------------------------------------- */

$gtm = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>'
    . '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());</script>';
check('accepts a GTM/GA snippet', Security::validateSnippet($gtm, 'header')['ok'] === true);

check(
    'rejects an external script from an unknown host',
    Security::validateSnippet('<script src="https://evil.test/x.js"></script>', 'header')['ok'] === false,
);
check(
    'rejects inline alert()',
    Security::validateSnippet('<script>alert(1)</script>', 'header')['ok'] === false,
);
check(
    'rejects cookie access',
    Security::validateSnippet('<script>gtag(document.cookie)</script>', 'header')['ok'] === false,
);
check(
    'rejects iframes in snippets',
    Security::validateSnippet('<iframe src="https://example.com"></iframe>', 'header')['ok'] === false,
);
check(
    'rejects non-http script scheme',
    Security::validateSnippet('<script src="http://www.googletagmanager.com/gtag/js"></script>', 'header')['ok'] === false,
);
check(
    'accepts a Google verification meta tag in the header',
    Security::validateSnippet('<meta name="google-site-verification" content="abc123" />', 'header')['ok'] === true,
);
check(
    'rejects a verification meta tag in the footer',
    Security::validateSnippet('<meta name="google-site-verification" content="abc123" />', 'footer')['ok'] === false,
);
check('accepts an empty snippet', Security::validateSnippet('', 'header')['ok'] === true);

check('valid GA4 id accepted', Security::isValidMeasurementId('G-ABCDE12345'));
check('invalid measurement id rejected', !Security::isValidMeasurementId('G-<script>'));

/* ---------------------------------------------------------------------- */
/*  Phone numbers                                                         */
/* ---------------------------------------------------------------------- */

check('normalises parentheses', PhoneNumberModel::normalise('(800) 779-3921') === '800-779-3921');
check('normalises +1 prefix', PhoneNumberModel::normalise('+1 888 863 0629') === '888-863-0629');
check('rejects short numbers', PhoneNumberModel::normalise('12345') === null);
check('rejects numbers starting with 1', PhoneNumberModel::normalise('123-456-7890') === null);

/* ---------------------------------------------------------------------- */
/*  Password hashing                                                      */
/* ---------------------------------------------------------------------- */

$hash = Security::hashPassword('Sa123456');
check('bcrypt hash verifies', Security::verifyPassword('Sa123456', $hash));
check('wrong password fails', !Security::verifyPassword('Sa123457', $hash));
check(
    'seeded demo hash verifies',
    Security::verifyPassword('Sa123456', '$2y$12$O.mAyi0e.szDnNHbiL.sZ.Q4k66zoaUBJUNwBtn0.LJ9MSo/5IMoC'),
);

/* ---------------------------------------------------------------------- */
/*  Honeypot                                                              */
/* ---------------------------------------------------------------------- */

$honeypot = new HoneypotService();
expectException('honeypot blocks filled trap field', static function () use ($honeypot): void {
    $honeypot->assertHuman(['website' => 'http://spam.test', 'form_started_at' => time() - 30]);
}, 422);
expectException('honeypot blocks instant submissions', static function () use ($honeypot): void {
    $honeypot->assertHuman(['form_started_at' => time()]);
}, 422);

$honeypot->assertHuman(['form_started_at' => time() - 10]);
check('honeypot accepts a normal submission', true);

/* ---------------------------------------------------------------------- */
/*  Routes                                                                */
/* ---------------------------------------------------------------------- */

$router = Router::boot();
$routes = $router->listRoutes();
check('route table is non-empty', count($routes) >= 60, (string) count($routes));

$seen = [];
$duplicates = [];
foreach ($routes as $route) {
    $key = $route['method'] . ' ' . $route['path'];
    if (isset($seen[$key])) {
        $duplicates[] = $key;
    }
    $seen[$key] = true;
}
check('no duplicate routes', $duplicates === [], implode(', ', $duplicates));

$paths = array_column($routes, 'path');
foreach ([
    '/v1/services',
    '/v1/services/{param}/numbers',
    '/v1/auth/login',
    '/v1/auth/password/forgot',
    '/v1/admin/services/mapping',
    '/v1/admin/services/{param}/groups',
    '/v1/admin/phone-numbers/{param}/verify',
    '/v1/admin/blog/categories',
    '/v1/admin/blog/{param}',
    '/v1/admin/homepage-sections/order',
    '/v1/admin/settings/seo',
    '/v1/admin/analytics/timeseries',
    '/v1/admin/media',
    '/v1/admin/team',
] as $pattern) {
    check('route registered: ' . $pattern, in_array($pattern, $paths, true));
}

/* ---------------------------------------------------------------------- */
/*  Request path normalisation                                            */
/* ---------------------------------------------------------------------- */

check('base path is stripped', Request::normalisePath('/api/v1/services?page=2') === '/v1/services');
check('trailing slash removed', Request::normalisePath('/api/v1/services/') === '/v1/services');
check('root survives normalisation', Request::normalisePath('/api/') === '/');

/* ---------------------------------------------------------------------- */
/*  Sample analytics pack (preview data)                                  */
/* ---------------------------------------------------------------------- */

$schemaSql = (string) @file_get_contents(dirname(__DIR__) . '/database/schema.sql');
$sampleSql = (string) @file_get_contents(dirname(__DIR__) . '/database/sample-analytics.sql');
$removeSql = (string) @file_get_contents(dirname(__DIR__) . '/database/sample-analytics-remove.sql');

check('schema.sql is readable', $schemaSql !== '');
check('sample-analytics.sql exists', $sampleSql !== '');
check('sample-analytics-remove.sql exists', $removeSql !== '');

preg_match_all('/CREATE TABLE `(\w+)`/', $schemaSql, $schemaTables);
$knownTables = $schemaTables[1] ?? [];

preg_match_all('/INSERT INTO\s+`?(\w+)`?/', $sampleSql, $insertTargets);
$insertTargets = array_values(array_unique(array_filter(
    $insertTargets[1] ?? [],
    // tmp_* are the file's own temporary helper tables, not schema tables.
    static fn (string $table): bool => !str_starts_with($table, 'tmp_'),
)));
check('sample pack inserts into tables that exist in schema.sql', $insertTargets !== [], 'no INSERT statements found');
foreach ($insertTargets as $table) {
    check('sample pack target table exists: ' . $table, in_array($table, $knownTables, true));
}
foreach (['analytics_events', 'leads', 'call_records', 'revenue_records', 'analytics_daily'] as $table) {
    check('sample pack fills ' . $table, in_array($table, $insertTargets, true));
}

/* Every row the sample pack creates must be findable by the removal script. */
$markers = [
    'demo0000'        => "analytics_events (visitor_id)",
    'sess0000'        => "analytics_events (session_id)",
    'SMPL-'           => 'leads.reference',
    'sample-call-'    => 'call_records.external_call_id',
    'SAMPLE-PREVIEW'  => 'revenue_records.source',
];
foreach ($markers as $marker => $where) {
    check('sample pack tags rows: ' . $where, str_contains($sampleSql, $marker));
    check('removal script deletes tagged rows: ' . $where, str_contains($removeSql, $marker));
}

check('sample pack rebuilds the daily rollup', str_contains($sampleSql, 'ON DUPLICATE KEY UPDATE'));
check('removal script rebuilds the daily rollup', str_contains($removeSql, 'ON DUPLICATE KEY UPDATE'));
check('removal script never touches admins', !str_contains($removeSql, 'DELETE FROM admins'));
check('removal script never truncates tables', !preg_match('/TRUNCATE/i', $removeSql));

/* ---------------------------------------------------------------------- */
/*  Result                                                                */
/* ---------------------------------------------------------------------- */

echo PHP_EOL . str_repeat('-', 60) . PHP_EOL;
echo "API unit tests: {$passed} passed, {$failed} failed" . PHP_EOL;

if ($failed > 0) {
    echo implode(PHP_EOL, $failures) . PHP_EOL;
    exit(1);
}

exit(0);
