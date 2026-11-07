<?php
/**
 * CORS for the real frontend origins.
 *
 * Credentials are allowed, so the origin is echoed back from an explicit
 * allow-list — never `*`. Pre-flight requests are answered and terminated here.
 */

declare(strict_types=1);

namespace Shn\Middleware;

use Shn\Helpers\Config;
use Shn\Helpers\Request;
use Shn\Helpers\Response;

final class CorsMiddleware
{
    public function handle(Request $request): void
    {
        $origin = $request->header('origin');
        $allowed = Config::array('cors.origins');

        if ($origin !== null && $origin !== '' && $this->isAllowed($origin, $allowed)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Credentials: true');
            header('Vary: Origin');
            header('Access-Control-Allow-Methods: ' . implode(', ', Config::array('cors.methods')));
            header('Access-Control-Allow-Headers: ' . implode(', ', Config::array('cors.headers')));
            header('Access-Control-Max-Age: ' . Config::int('cors.max_age', 86400));
            header('Access-Control-Expose-Headers: X-RateLimit-Remaining, Retry-After');
        } elseif ($origin !== null && $origin !== '') {
            // Unknown origin: no CORS headers. The request still runs for
            // same-origin/admin use, but the browser will block the response.
            header('Vary: Origin');
        }

        if (strtoupper($request->method()) === 'OPTIONS') {
            if ($origin !== null && $origin !== '' && !$this->isAllowed($origin, $allowed)) {
                Response::error(403, 'cors_rejected', 'This origin is not allowed to call the API.');
            }
            http_response_code(204);
            header('Content-Length: 0');
            exit;
        }
    }

    /** @param array<int,string> $allowed */
    private function isAllowed(string $origin, array $allowed): bool
    {
        foreach ($allowed as $candidate) {
            if (strcasecmp(rtrim($candidate, '/'), rtrim($origin, '/')) === 0) {
                return true;
            }
        }
        return false;
    }
}
