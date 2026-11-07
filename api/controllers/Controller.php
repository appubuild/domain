<?php
/**
 * Shared controller helpers: pagination, filters, authenticated admin context.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Request;

abstract class Controller
{
    public function __construct(protected readonly Request $request)
    {
    }

    /** @return array{page:int,per_page:int} */
    protected function pagination(int $defaultPerPage = 20, int $maxPerPage = 100): array
    {
        $page = $this->request->intQuery('page', 1, 1, 100000);
        $perPage = $this->request->intQuery('per_page', $defaultPerPage, 1, $maxPerPage);
        return ['page' => $page, 'per_page' => $perPage];
    }

    /** Returns a trimmed query parameter, or null when absent/empty. */
    protected function filter(string $key, int $maxLength = 200): ?string
    {
        $value = $this->request->queryParam($key);
        if ($value === null) {
            return null;
        }
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        return mb_substr($value, 0, $maxLength);
    }

    protected function boolFilter(string $key): bool
    {
        return in_array(strtolower((string) $this->request->queryParam($key, '')), ['1', 'true', 'yes'], true);
    }

    /** @return array<string,mixed> */
    protected function admin(): array
    {
        $admin = $this->request->admin;
        if (!is_array($admin)) {
            throw ApiException::unauthorized('Sign in to continue.');
        }
        return $admin;
    }

    protected function adminId(): ?int
    {
        return isset($this->request->admin['id']) ? (int) $this->request->admin['id'] : null;
    }

    protected function id(string $value, string $label = 'ID'): int
    {
        if (!preg_match('/^\d+$/', $value) || (int) $value <= 0) {
            throw ApiException::badRequest('The ' . $label . ' must be a positive number.');
        }
        return (int) $value;
    }

    /** @return array<string,mixed> */
    protected function body(): array
    {
        $body = $this->request->body();
        if ($body === []) {
            throw ApiException::badRequest('A JSON request body is required.');
        }
        return $body;
    }

    /** @return array<int,mixed> */
    protected function bodyList(string $key): array
    {
        $value = $this->request->input($key, []);
        if (!is_array($value)) {
            throw ApiException::unprocessable('The ' . $key . ' field must be a list.');
        }
        return array_values($value);
    }
}
