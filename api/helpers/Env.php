<?php
/**
 * Minimal .env loader.
 *
 * The file lives in the API folder during development and — on shared hosting —
 * preferably one level above the document root. Both locations are checked.
 * Values are never echoed or exposed through the API.
 */

declare(strict_types=1);

namespace Shn\Helpers;

final class Env
{
    /** @var array<string,string> */
    private static array $values = [];

    private static bool $loaded = false;

    public static function load(string $basePath): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        $candidates = [
            $basePath . '/.env',
            dirname($basePath) . '/.env',
            dirname($basePath, 2) . '/.env',
        ];

        foreach ($candidates as $file) {
            if (!is_file($file) || !is_readable($file)) {
                continue;
            }
            foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#')) {
                    continue;
                }
                $position = strpos($line, '=');
                if ($position === false) {
                    continue;
                }
                $key = trim(substr($line, 0, $position));
                $value = trim(substr($line, $position + 1));

                if ($value !== '' && ($value[0] === '"' || $value[0] === "'")) {
                    $quote = $value[0];
                    $value = trim($value, $quote);
                    if ($quote === '"') {
                        $value = str_replace(['\n', '\r', '\t'], ["\n", "\r", "\t"], $value);
                    }
                } else {
                    // strip trailing " # comment"
                    $comment = strpos($value, ' #');
                    if ($comment !== false) {
                        $value = trim(substr($value, 0, $comment));
                    }
                }

                self::$values[$key] = $value;
                if (getenv($key) === false) {
                    putenv($key . '=' . $value);
                }
            }
            break; // first file wins
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        if (array_key_exists($key, self::$values)) {
            return self::$values[$key];
        }
        $fromServer = $_SERVER[$key] ?? $_ENV[$key] ?? getenv($key);
        if ($fromServer === false || $fromServer === null || $fromServer === '') {
            return $default;
        }
        return (string) $fromServer;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);
        if ($value === null) {
            return $default;
        }
        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }

    public static function int(string $key, int $default): int
    {
        $value = self::get($key);
        if ($value === null || !preg_match('/^-?\d+$/', $value)) {
            return $default;
        }
        return (int) $value;
    }
}
