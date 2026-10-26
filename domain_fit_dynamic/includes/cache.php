<?php
require_once __DIR__ . '/functions.php';

function cache_path(string $key): string
{
    return dirname(__DIR__) . '/storage/cache/' . hash('sha256', $key) . '.json';
}

function cache_get(string $key): mixed
{
    $path = cache_path($key);
    if (!is_file($path)) {
        return null;
    }
    $json = @file_get_contents($path);
    $entry = is_string($json) ? json_decode($json, true) : null;
    if (!is_array($entry) || !isset($entry['expires_at']) || (int) $entry['expires_at'] < time() || !array_key_exists('value', $entry)) {
        @unlink($path);
        return null;
    }
    return $entry['value'];
}

function cache_set(string $key, mixed $value, int $ttlSeconds = 300): void
{
    $directory = dirname(__DIR__) . '/storage/cache';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        return;
    }
    $payload = json_encode(['expires_at' => time() + max(1, $ttlSeconds), 'value' => $value], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($payload)) {
        return;
    }
    $path = cache_path($key);
    $temporary = $path . '.' . bin2hex(random_bytes(5)) . '.tmp';
    if (@file_put_contents($temporary, $payload, LOCK_EX) !== false) {
        @chmod($temporary, 0640);
        @rename($temporary, $path);
    }
    if (is_file($temporary)) {
        @unlink($temporary);
    }
}

function cache_delete(string $key): void
{
    $path = cache_path($key);
    if (is_file($path)) {
        @unlink($path);
    }
}

function cache_clear_all(): void
{
    $directory = dirname(__DIR__) . '/storage/cache';
    if (!is_dir($directory)) {
        return;
    }
    foreach (glob($directory . '/*.json') ?: [] as $file) {
        @unlink($file);
    }
}
