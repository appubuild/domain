<?php
/**
 * JSON responses.
 *
 * Every response uses the same envelope:
 *   success → { "data": …, "meta": { … } }
 *   failure → { "error": { "code": …, "message": …, "fields": { … } } }
 */

declare(strict_types=1);

namespace Shn\Helpers;

final class Response
{
    /** Plain XML body (sitemap feed) — no JSON envelope. */
    public static function xml(string $xml, int $status = 200): void
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/xml; charset=utf-8');
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: public, max-age=600');
        }

        echo $xml;
        exit;
    }

    /** @param array<string,mixed> $data */
    public static function json(array $data, int $status = 200, array $headers = []): void
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: no-store, private');
            foreach ($headers as $name => $value) {
                header($name . ': ' . $value);
            }
        }

        echo json_encode(
            $data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION,
        );
        exit;
    }

    /** @param array<string,mixed> $meta */
    public static function ok(mixed $data, array $meta = [], int $status = 200): void
    {
        $payload = ['data' => $data];
        if ($meta !== []) {
            $payload['meta'] = $meta;
        }
        self::json($payload, $status);
    }

    public static function created(mixed $data, array $meta = []): void
    {
        self::ok($data, $meta, 201);
    }

    public static function noContent(): void
    {
        if (!headers_sent()) {
            http_response_code(204);
            header('Cache-Control: no-store');
        }
        exit;
    }

    /**
     * @param array<string,mixed> $fields
     * @param array<string,mixed> $extra
     */
    public static function error(
        int $status,
        string $code,
        string $message,
        array $fields = [],
        array $extra = [],
    ): void {
        $error = ['code' => $code, 'message' => $message];
        if ($fields !== []) {
            $error['fields'] = $fields;
        }
        if ($extra !== []) {
            $error['context'] = $extra;
        }
        self::json(['error' => $error], $status);
    }

    /**
     * @param array<int,mixed>     $items
     * @param array<string,mixed>  $meta
     */
    public static function paginated(array $items, array $meta): void
    {
        self::json(['data' => $items, 'meta' => $meta]);
    }

    public static function fromException(ApiException $exception): void
    {
        self::error(
            $exception->status(),
            $exception->errorCode(),
            $exception->getMessage(),
            $exception->fields(),
            $exception->context(),
        );
    }
}
