<?php
/**
 * Transport-level exception: carries the HTTP status, a stable machine code and
 * optional per-field validation errors.
 */

declare(strict_types=1);

namespace Shn\Helpers;

class ApiException extends \RuntimeException
{
    /** @var array<string,string> */
    private array $fields;

    /** @var array<string,mixed> */
    private array $context;

    /**
     * @param array<string,string> $fields
     * @param array<string,mixed>  $context
     */
    public function __construct(
        private readonly int $status,
        private readonly string $errorCode,
        string $message,
        array $fields = [],
        array $context = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
        $this->fields = $fields;
        $this->context = $context;
    }

    public function status(): int
    {
        return $this->status;
    }

    public function errorCode(): string
    {
        return $this->errorCode;
    }

    /** @return array<string,string> */
    public function fields(): array
    {
        return $this->fields;
    }

    /** @return array<string,mixed> */
    public function context(): array
    {
        return $this->context;
    }

    public static function badRequest(string $message, array $fields = []): self
    {
        return new self(400, 'bad_request', $message, $fields);
    }

    public static function unauthorized(string $message = 'Authentication required.'): self
    {
        return new self(401, 'unauthorized', $message);
    }

    public static function forbidden(string $message = 'You do not have permission to do that.'): self
    {
        return new self(403, 'forbidden', $message);
    }

    public static function notFound(string $message = 'Resource not found.'): self
    {
        return new self(404, 'not_found', $message);
    }

    public static function methodNotAllowed(string $message = 'Method not allowed.'): self
    {
        return new self(405, 'method_not_allowed', $message);
    }

    public static function unprocessable(string $message, array $fields = []): self
    {
        return new self(422, 'validation_failed', $message, $fields);
    }

    public static function tooManyRequests(string $message = 'Too many requests. Please slow down.', int $retryAfter = 60): self
    {
        return new self(429, 'rate_limited', $message, [], ['retry_after' => $retryAfter]);
    }

    public static function conflict(string $message, array $fields = []): self
    {
        return new self(409, 'conflict', $message, $fields);
    }

    public static function server(string $message = 'Unexpected server error.', ?\Throwable $previous = null): self
    {
        return new self(500, 'server_error', $message, [], [], $previous);
    }
}
