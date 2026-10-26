<?php
declare(strict_types=1);

/** Load the CMS-local .env without overriding values supplied by the hosting environment. */
function load_local_env_file(string $path): void
{
    static $loaded = false;
    if ($loaded) {
        return;
    }
    $loaded = true;

    if (!is_file($path) || !is_readable($path)) {
        return;
    }

    $allowedKeys = [
        'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS',
        'APP_BASE_PATH', 'SITE_ORIGIN', 'APP_SECRET', 'ANALYTICS_SALT', 'GEMINI_API_KEY', 'GEMINI_MODEL',
    ];
    $lines = @file($path, FILE_IGNORE_NEW_LINES);
    if (!is_array($lines)) {
        return;
    }

    foreach ($lines as $line) {
        $line = preg_replace('/^\xEF\xBB\xBF/', '', $line) ?? $line;
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (str_starts_with($line, 'export ')) {
            $line = trim(substr($line, 7));
        }

        $equalsAt = strpos($line, '=');
        if ($equalsAt === false) {
            continue;
        }
        $key = trim(substr($line, 0, $equalsAt));
        if (!in_array($key, $allowedKeys, true)) {
            continue;
        }

        // Existing server variables take precedence over local .env values.
        $existing = getenv($key);
        if ($existing !== false) {
            $_ENV[$key] = $existing;
            continue;
        }
        if (array_key_exists($key, $_ENV) && is_scalar($_ENV[$key])) {
            $existing = (string) $_ENV[$key];
            putenv($key . '=' . $existing);
            continue;
        }
        if (array_key_exists($key, $_SERVER) && is_scalar($_SERVER[$key])) {
            $existing = (string) $_SERVER[$key];
            putenv($key . '=' . $existing);
            $_ENV[$key] = $existing;
            continue;
        }

        $value = trim(substr($line, $equalsAt + 1));
        $quote = $value[0] ?? '';
        if ($quote === '"' || $quote === "'") {
            $closingQuote = strrpos($value, $quote);
            if ($closingQuote === false || $closingQuote === 0) {
                continue;
            }
            $trailing = trim(substr($value, $closingQuote + 1));
            if ($trailing !== '' && !str_starts_with($trailing, '#')) {
                continue;
            }
            $value = substr($value, 1, $closingQuote - 1);
            if ($quote === '"') {
                $value = preg_replace_callback('/\\\\(["\\\\])/', static fn(array $match): string => $match[1], $value) ?? $value;
            }
        } else {
            // An inline comment starts only at whitespace followed by #; embedded # stays literal.
            $value = preg_replace('/\\s+#.*$/', '', $value) ?? $value;
            $value = trim($value);
        }

        putenv($key . '=' . $value);
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
    }
}
