<?php
declare(strict_types=1);

require_once __DIR__ . '/hooks.php';

function df_app_root(): string
{
    return dirname(__DIR__);
}

function df_extensions_root(): string
{
    return df_app_root() . '/storage/extensions';
}

function df_extensions_root_is_private(): bool
{
    $storagePath = df_app_root() . '/storage';
    $extensionPath = df_extensions_root();
    $storageRoot = realpath($storagePath);
    $extensionRoot = realpath($extensionPath);
    return !is_link($storagePath) && !is_link($extensionPath) && $storageRoot !== false && $extensionRoot !== false
        && dirname($extensionRoot) === $storageRoot;
}

function df_extension_slug_is_valid(string $slug): bool
{
    return preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $slug) === 1;
}

function df_extension_path_has_symlink(string $base, string $relative): bool
{
    $current = rtrim($base, DIRECTORY_SEPARATOR);
    foreach (explode('/', str_replace('\\', '/', $relative)) as $segment) {
        if ($segment === '' || $segment === '.') continue;
        $current .= DIRECTORY_SEPARATOR . $segment;
        if (is_link($current)) return true;
    }
    return false;
}

/** Check the registry without granting the normal runtime DB user DDL privileges. */
function df_check_extensions_schema(PDO $pdo): void
{
    try {
        $pdo->query('SELECT slug,name,version,status,options_json,installed_by,installed_at,updated_at FROM cms_extensions LIMIT 0');
    } catch (Throwable $error) {
        throw new RuntimeException('The extension registry is unavailable. If this is an existing installation, import domain_fit_dynamic/migrations/20261030_extensions.sql in phpMyAdmin. If the table already exists, verify the CMS database account has SELECT access, then reload this page.');
    }
}

/** Validate metadata and return safe absolute paths. No plugin file is included by this function. */
function df_extension_inspect(string $slug): ?array
{
    if (!df_extension_slug_is_valid($slug)) {
        return null;
    }
    $extensionRoot = df_extensions_root();
    $root = realpath($extensionRoot);
    $directory = realpath($extensionRoot . '/' . $slug);
    if ($root === false || $directory === false || !df_extensions_root_is_private()
        || dirname($directory) !== $root || df_extension_path_has_symlink($extensionRoot, $slug)
    ) {
        return null;
    }
    $manifestPath = $directory . '/plugin.json';
    if (!is_file($manifestPath) || is_link($manifestPath)) {
        return null;
    }
    $raw = @file_get_contents($manifestPath);
    if (!is_string($raw) || strlen($raw) > 16384) {
        return null;
    }
    try {
        $manifest = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (Throwable $error) {
        return null;
    }
    if (!is_array($manifest)
        || ($manifest['slug'] ?? null) !== $slug
        || !is_string($manifest['name'] ?? null)
        || trim($manifest['name']) === ''
        || strlen($manifest['name']) > 120
        || !is_string($manifest['version'] ?? null)
        || preg_match('/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:[-+][A-Za-z0-9.-]{1,20})?$/', $manifest['version']) !== 1
        || (int) ($manifest['api_version'] ?? 0) !== 1
        || !is_string($manifest['entry'] ?? null)
    ) {
        return null;
    }
    $entry = $manifest['entry'];
    if (strlen($entry) > 180 || str_starts_with($entry, '/') || str_contains($entry, '\\')
        || str_contains($entry, '..') || preg_match('/^[A-Za-z0-9._\/-]+\.php$/', $entry) !== 1
    ) {
        return null;
    }
    $entryPath = realpath($directory . '/' . $entry);
    if ($entryPath === false || !is_file($entryPath) || is_link($directory . '/' . $entry)
        || df_extension_path_has_symlink($directory, $entry)
        || !str_starts_with($entryPath, $directory . DIRECTORY_SEPARATOR)
    ) {
        return null;
    }
    return [
        'manifest' => $manifest,
        'directory' => $directory,
        'entry_path' => $entryPath,
    ];
}

function df_extension_options(PDO $pdo, string $slug): array
{
    if (!df_extension_slug_is_valid($slug)) {
        return [];
    }
    try {
        $statement = $pdo->prepare('SELECT options_json FROM cms_extensions WHERE slug = :slug LIMIT 1');
        $statement->execute(['slug' => $slug]);
        $json = $statement->fetchColumn();
        if (!is_string($json)) {
            return [];
        }
        $options = json_decode($json, true);
        return is_array($options) ? $options : [];
    } catch (Throwable $error) {
        error_log('Extension settings unavailable for ' . $slug . ': ' . $error->getMessage());
        return [];
    }
}

function df_extension_save_options(PDO $pdo, string $slug, array $options): void
{
    if (!df_extension_slug_is_valid($slug)) {
        throw new InvalidArgumentException('Invalid extension slug.');
    }
    $json = json_encode($options, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    if (strlen($json) > 65536) {
        throw new RuntimeException('Extension settings exceed the 64 KB limit.');
    }
    $statement = $pdo->prepare('UPDATE cms_extensions SET options_json = :options WHERE slug = :slug');
    $statement->execute(['options' => $json, 'slug' => $slug]);
    if ($statement->rowCount() === 0) {
        $exists = $pdo->prepare('SELECT 1 FROM cms_extensions WHERE slug = :slug LIMIT 1');
        $exists->execute(['slug' => $slug]);
        if (!$exists->fetchColumn()) {
            throw new RuntimeException('Extension installation record was not found.');
        }
    }
}

/** Includes one installed extension only after its DB state, manifest and real paths have been checked. */
function df_extensions_load_plugin(PDO $pdo, string $slug, bool $allowInactive = false): ?array
{
    if (!df_extension_slug_is_valid($slug)) {
        return null;
    }
    if (isset($GLOBALS['_df_loaded_extensions'][$slug])) {
        return $GLOBALS['_df_loaded_extensions'][$slug];
    }
    try {
        $query = $pdo->prepare('SELECT status FROM cms_extensions WHERE slug = :slug LIMIT 1');
        $query->execute(['slug' => $slug]);
        $status = $query->fetchColumn();
        if ($status === false || (!$allowInactive && $status !== 'active')) {
            return null;
        }
        $inspected = df_extension_inspect($slug);
        if ($inspected === null) {
            error_log('Extension skipped because its manifest or entry file is invalid: ' . $slug);
            return null;
        }
        require_once $inspected['entry_path'];
        $manifest = $inspected['manifest'];
        $GLOBALS['_df_loaded_extensions'][$slug] = $manifest;
        df_do_action('extension.loaded', $slug, $manifest, $pdo);
        return $manifest;
    } catch (Throwable $error) {
        error_log('Extension failed to load [' . $slug . ']: ' . $error->getMessage());
        return null;
    }
}

/** Called once per request by db() after a PDO connection has been created. */
function df_extensions_bootstrap(PDO $pdo): void
{
    static $booted = false;
    static $booting = false;
    if ($booted || $booting) {
        return;
    }
    $booting = true;
    try {
        $rows = $pdo->query("SELECT slug FROM cms_extensions WHERE status = 'active' ORDER BY slug")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($rows as $slug) {
            df_extensions_load_plugin($pdo, (string) $slug);
        }
        $booted = true;
        df_do_action('database.connected', $pdo);
        df_do_action('request.extensions_loaded', $pdo);
    } catch (Throwable $error) {
        // The table is created on the Extensions page for upgraded installations.
        error_log('Extension loader unavailable: ' . $error->getMessage());
        $booted = true;
    } finally {
        $booting = false;
    }
}
