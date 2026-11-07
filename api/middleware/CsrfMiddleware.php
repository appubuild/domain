<?php
/**
 * Double-submit CSRF protection for cookie-authenticated writes.
 *
 * The raw CSRF token is shown once (at login) and kept in memory by the admin
 * panel; the database stores only its SHA-256. Requests authenticated with a
 * Bearer token skip this check — they carry no ambient cookie authority.
 */

declare(strict_types=1);

namespace Shn\Middleware;

use Shn\Helpers\ApiException;
use Shn\Helpers\Request;
use Shn\Helpers\Security;

final class CsrfMiddleware
{
    public function handle(Request $request): void
    {
        if (($request->session['via'] ?? 'cookie') !== 'cookie') {
            return;
        }

        $given = $request->header('x-csrf-token');
        if ($given === null || $given === '') {
            $given = $request->input('_csrf');
        }

        if (!is_string($given) || $given === '') {
            throw ApiException::forbidden('Missing CSRF token. Reload the admin panel and try again.');
        }

        $expected = (string) ($request->session['csrf_token'] ?? '');
        if ($expected === '' || !Security::safeEquals($expected, Security::hashToken($given))) {
            throw ApiException::forbidden('Invalid CSRF token. Reload the admin panel and try again.');
        }
    }
}
