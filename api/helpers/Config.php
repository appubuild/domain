<?php
/**
 * Application configuration (dot-notation access).
 *
 * Values come from config/application.php and config/database.php, which in turn
 * read the .env file. Secrets never leave the server: the public API exposes
 * only explicitly whitelisted settings.
 */

declare(strict_types=1);

namespace Shn\Helpers;

final class Config
{
    /** @var array<string,mixed> */
    private static array $items = [];

    private static bool $loaded = false;

    public static function load(string $basePath): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        Env::load($basePath);

        $configDir = $basePath . '/config';
        self::$items['app'] = require $configDir . '/application.php';
        self::$items['db'] = require $configDir . '/database.php';
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $segments = explode('.', $key);
        $value = self::$items;
        foreach ($segments as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return $default;
            }
            $value = $value[$segment];
        }
        return $value;
    }

    /** @return array<int,string> */
    public static function array(string $key): array
    {
        $value = self::get($key, []);
        return is_array($value) ? array_values($value) : [];
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);
        if ($value === null) {
            return $default;
        }
        if (is_bool($value)) {
            return $value;
        }
        return in_array(strtolower((string) $value), ['1', 'true', 'yes', 'on'], true);
    }

    public static function int(string $key, int $default = 0): int
    {
        $value = self::get($key);
        return is_numeric($value) ? (int) $value : $default;
    }

    public static function string(string $key, string $default = ''): string
    {
        $value = self::get($key);
        return is_string($value) ? $value : $default;
    }
}
