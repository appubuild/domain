<?php
/**
 * Role-based access control.
 *
 * Hierarchy (highest first): owner → admin → editor → viewer.
 * A route declaring `role:editor` is open to editor, admin and owner.
 */

declare(strict_types=1);

namespace Shn\Middleware;

use Shn\Helpers\ApiException;
use Shn\Helpers\Request;

final class RoleMiddleware
{
    private const RANKS = [
        'viewer' => 1,
        'editor' => 2,
        'admin' => 3,
        'owner' => 4,
    ];

    public function handle(Request $request, string $required = 'admin'): void
    {
        $admin = $request->admin;
        if (!is_array($admin)) {
            throw ApiException::unauthorized('Sign in to continue.');
        }

        $role = (string) ($admin['role'] ?? 'viewer');
        $requiredRank = self::RANKS[$required] ?? self::RANKS['admin'];
        $actualRank = self::RANKS[$role] ?? 0;

        if ($actualRank < $requiredRank) {
            throw ApiException::forbidden(
                'This action requires the "' . $required . '" role. Your role is "' . $role . '".',
            );
        }
    }
}
