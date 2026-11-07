<?php
/**
 * Immutable request wrapper.
 *
 * Usable from the HTTP front controller and from the CLI test harness, so the
 * same controllers can be exercised without Apache.
 */

declare(strict_types=1);

namespace Shn\Helpers;

final class Request
{
    /** @param array<string,mixed> $query
     *  @param array<string,mixed> $body
     *  @param array<string,string> $headers
     *  @param array<string,mixed> $server
     *  @param array<string,mixed> $files
     */
    public function __construct(
        private readonly string $method,
        private readonly string $path,
        private readonly array $query = [],
        private readonly array $body = [],
        private readonly array $headers = [],
        private readonly array $server = [],
        private readonly array $files = [],
    ) {
    }

    public static function capture(): self
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $override = $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? ($_SERVER['X_HTTP_METHOD_OVERRIDE'] ?? null);
        if ($override !== null && in_array(strtoupper($override), ['PUT', 'PATCH', 'DELETE'], true)) {
            $method = strtoupper($override);
        }

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with((string) $key, 'HTTP_')) {
                $name = str_replace('_', '-', strtolower(substr((string) $key, 5)));
                $headers[$name] = (string) $value;
            } elseif (in_array($key, ['CONTENT_TYPE', 'CONTENT_LENGTH'], true)) {
                $headers[strtolower(str_replace('_', '-', (string) $key))] = (string) $value;
            }
        }

        $body = [];
        $contentType = strtolower($headers['content-type'] ?? '');
        if (str_contains($contentType, 'application/json')) {
            $raw = file_get_contents('php://input') ?: '';
            if (trim($raw) !== '') {
                $decoded = json_decode($raw, true);
                if (!is_array($decoded)) {
                    throw ApiException::badRequest('Request body is not valid JSON.');
                }
                $body = $decoded;
            }
        } elseif (!empty($_POST)) {
            $body = $_POST;
        }

        return new self(
            $method,
            self::normalisePath($_SERVER['REQUEST_URI'] ?? '/'),
            $_GET,
            $body,
            $headers,
            $_SERVER,
            $_FILES,
        );
    }

    /**
     * Strips the deployment base path (e.g. `/api`) and the query string, so the
     * router always sees `/v1/services`.
     */
    public static function normalisePath(string $uri): string
    {
        $path = parse_url($uri, PHP_URL_PATH) ?: '/';

        $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
        $base = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');
        if ($base !== '' && $base !== '.' && str_starts_with($path, $base)) {
            $path = substr($path, strlen($base));
        } elseif ($base !== '' && $base !== '.' && isset($_SERVER['SCRIPT_FILENAME'])) {
            // Fallback for hosts that rewrite without preserving SCRIPT_NAME.
            $documentRoot = rtrim(str_replace('\\', '/', $_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
            $scriptDir = rtrim(str_replace('\\', '/', dirname((string) $_SERVER['SCRIPT_FILENAME'])), '/');
            if ($documentRoot !== '' && str_starts_with($scriptDir, $documentRoot)) {
                $candidate = substr($scriptDir, strlen($documentRoot));
                if ($candidate !== '' && str_starts_with($path, $candidate)) {
                    $path = substr($path, strlen($candidate));
                }
            }
        }

        $path = '/' . ltrim($path, '/');
        $path = rtrim($path, '/');

        return $path === '' ? '/' : $path;
    }

    public function method(): string
    {
        return $this->method;
    }

    public function path(): string
    {
        return $this->path;
    }

    /** @return array<string,mixed> */
    public function query(): array
    {
        return $this->query;
    }

    public function queryParam(string $key, ?string $default = null): ?string
    {
        $value = $this->query[$key] ?? null;
        return is_scalar($value) ? (string) $value : $default;
    }

    public function intQuery(string $key, int $default, int $min = 1, int $max = 200): int
    {
        $value = $this->query[$key] ?? null;
        if (!is_numeric($value)) {
            return $default;
        }
        return max($min, min($max, (int) $value));
    }

    /** @return array<string,mixed> */
    public function body(): array
    {
        return $this->body;
    }

    public function input(string $key, mixed $default = null): mixed
    {
        return $this->body[$key] ?? $default;
    }

    /** @return array<string,mixed> */
    public function only(array $keys): array
    {
        $result = [];
        foreach ($keys as $key) {
            if (array_key_exists($key, $this->body)) {
                $result[$key] = $this->body[$key];
            }
        }
        return $result;
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->body);
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function bearerToken(): ?string
    {
        $header = $this->header('authorization');
        if ($header === null || !preg_match('/^Bearer\s+(.+)$/i', $header, $match)) {
            return null;
        }
        return trim($match[1]);
    }

    public function cookie(string $name): ?string
    {
        $value = $_COOKIE[$name] ?? null;
        return is_string($value) && $value !== '' ? $value : null;
    }

    /** @return array<string,mixed>|null */
    public function file(string $key): ?array
    {
        $file = $this->files[$key] ?? null;
        return is_array($file) ? $file : null;
    }

    public function ip(): string
    {
        return (string) ($this->server['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    public function userAgent(): string
    {
        return substr((string) ($this->server['HTTP_USER_AGENT'] ?? ''), 0, 255);
    }

    public function isWrite(): bool
    {
        return in_array($this->method, ['POST', 'PUT', 'PATCH', 'DELETE'], true);
    }

    /** Admin attached by the auth middleware (null for public routes). */
    public ?array $admin = null;

    public ?array $session = null;
}
