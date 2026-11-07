<?php
/**
 * Team management (owner/admin only). Owners cannot be created or deleted
 * through the API — that would allow privilege escalation.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Helpers\Validator;
use Shn\Models\AdminModel;

final class AdminTeamController extends Controller
{
    public function __construct(
        Request $request,
        private readonly AdminModel $admins = new AdminModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);
        Response::ok($this->admins->all());
    }

    public function store(Request $request): void
    {
        $data = Validator::validate($this->body(), [
            'name' => 'required|string|min:2|max:160',
            'email' => 'required|email|max:190',
            'password' => 'required|string|min:8|max:200',
            'role' => 'nullable|in:admin,editor,viewer',
            'status' => 'nullable|in:active,suspended',
        ]);

        $id = $this->admins->createAdmin($data);
        Logger::audit($request->admin, 'admin.created', 'admin', $id, 'Created a team member', $request->ip());

        Response::created($this->admins->findActive($id));
    }

    public function update(Request $request, string $id): void
    {
        $adminId = $this->id($id, 'admin id');
        $target = $this->admins->findActive($adminId);
        if ($target === null) {
            throw ApiException::notFound('Team member not found.');
        }

        $data = Validator::validate($this->body(), [
            'name' => 'nullable|string|min:2|max:160',
            'role' => 'nullable|in:admin,editor,viewer',
            'status' => 'nullable|in:active,suspended',
            'password' => 'nullable|string|min:8|max:200',
        ]);

        if (($target['role'] ?? '') === 'owner') {
            throw ApiException::forbidden('The owner account can only be changed by the owner directly in the database.');
        }

        $this->admins->updateAdmin($adminId, $data);
        Logger::audit($request->admin, 'admin.updated', 'admin', $adminId, 'Updated a team member', $request->ip());

        Response::ok($this->admins->findActive($adminId));
    }

    public function destroy(Request $request, string $id): void
    {
        $adminId = $this->id($id, 'admin id');

        if ($adminId === $this->adminId()) {
            throw ApiException::forbidden('You cannot delete your own account.');
        }

        $this->admins->deleteAdmin($adminId);
        Logger::audit($request->admin, 'admin.deleted', 'admin', $adminId, 'Removed a team member', $request->ip());

        Response::noContent();
    }
}
