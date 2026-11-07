<?php
/**
 * Admin CRUD for service categories, niches and phone groups.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use PDOException;
use Shn\Helpers\ApiException;
use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Helpers\Validator;
use Shn\Models\CategoryModel;
use Shn\Models\NicheModel;
use Shn\Models\PhoneGroupModel;

final class AdminTaxonomyController extends Controller
{
    public function __construct(
        Request $request,
        private readonly CategoryModel $categories = new CategoryModel(),
        private readonly NicheModel $niches = new NicheModel(),
        private readonly PhoneGroupModel $groups = new PhoneGroupModel(),
    ) {
        parent::__construct($request);
    }

    /* -------------------------- categories --------------------------- */

    public function categories(Request $request): void
    {
        unset($request);
        Response::ok($this->categories->all());
    }

    public function storeCategory(Request $request): void
    {
        $data = Validator::validate($request->body(), [
            'id' => 'required|string|min:2|max:32|regex:/^[a-z0-9-]+$/',
            'name' => 'required|string|min:2|max:120',
            'description' => 'nullable|string|max:1000',
            'sort_order' => 'nullable|int|min:0|max:999',
        ]);

        try {
            $this->categories->create($data);
        } catch (PDOException $exception) {
            $this->translate($exception, 'A category with that id already exists.');
        }

        Logger::audit($request->admin, 'category.created', 'service_category', $data['id'], 'Created a service category', $request->ip());

        Response::created($this->categories->findOrFail((string) $data['id']));
    }

    public function updateCategory(Request $request, string $id): void
    {
        $this->categories->findOrFail($id);

        $data = Validator::validate($request->body(), [
            'name' => 'nullable|string|min:2|max:120',
            'description' => 'nullable|string|max:1000',
            'sort_order' => 'nullable|int|min:0|max:999',
        ]);

        $this->categories->update($id, $data);
        Logger::audit($request->admin, 'category.updated', 'service_category', $id, 'Updated a service category', $request->ip());

        Response::ok($this->categories->findOrFail($id));
    }

    public function destroyCategory(Request $request, string $id): void
    {
        $this->categories->findOrFail($id);
        $this->categories->delete($id);

        Logger::audit($request->admin, 'category.deleted', 'service_category', $id, 'Deleted a service category', $request->ip());
        Response::noContent();
    }

    /* ----------------------------- niches ---------------------------- */

    public function niches(Request $request): void
    {
        unset($request);
        ['page' => $page, 'per_page' => $perPage] = $this->pagination(50);

        $result = $this->niches->adminList([
            'status' => $this->filter('status', 20),
            'q' => $this->filter('q', 120),
            'include_deleted' => $this->boolFilter('include_deleted'),
        ], $page, $perPage);

        Response::paginated($result['items'], $result['meta']);
    }

    public function showNiche(Request $request, string $id): void
    {
        unset($request);
        Response::ok($this->niches->adminFind($this->id($id, 'niche id')));
    }

    public function storeNiche(Request $request): void
    {
        $data = Validator::validate($request->body(), [
            'slug' => 'required|slug|max:120',
            'name' => 'required|string|min:2|max:160',
            'description' => 'nullable|string|max:1000',
            'tone' => 'nullable|string|max:20',
            'status' => 'nullable|in:active,paused',
            'sort_order' => 'nullable|int|min:0|max:999',
        ]);

        try {
            $id = $this->niches->create($data);
        } catch (PDOException $exception) {
            $this->translate($exception, 'A niche with that slug already exists.');
        }

        Logger::audit($request->admin, 'niche.created', 'niche', $id, 'Created a niche', $request->ip());
        Response::created($this->niches->adminFind($id));
    }

    public function updateNiche(Request $request, string $id): void
    {
        $nicheId = $this->id($id, 'niche id');
        $this->niches->adminFind($nicheId);

        $data = Validator::validate($request->body(), [
            'slug' => 'nullable|slug|max:120',
            'name' => 'nullable|string|min:2|max:160',
            'description' => 'nullable|string|max:1000',
            'tone' => 'nullable|string|max:20',
            'status' => 'nullable|in:active,paused',
            'sort_order' => 'nullable|int|min:0|max:999',
        ]);

        try {
            $this->niches->update($nicheId, $data);
        } catch (PDOException $exception) {
            $this->translate($exception, 'A niche with that slug already exists.');
        }

        Logger::audit($request->admin, 'niche.updated', 'niche', $nicheId, 'Updated a niche', $request->ip());
        Response::ok($this->niches->adminFind($nicheId));
    }

    public function destroyNiche(Request $request, string $id): void
    {
        $nicheId = $this->id($id, 'niche id');
        $this->niches->adminFind($nicheId);

        $this->niches->softDelete($nicheId);
        Logger::audit($request->admin, 'niche.deleted', 'niche', $nicheId, 'Soft-deleted a niche', $request->ip());

        Response::noContent();
    }

    public function restoreNiche(Request $request, string $id): void
    {
        $nicheId = $this->id($id, 'niche id');
        $this->niches->adminFind($nicheId, true);

        $this->niches->restore($nicheId);
        Logger::audit($request->admin, 'niche.restored', 'niche', $nicheId, 'Restored a niche', $request->ip());

        Response::ok($this->niches->adminFind($nicheId));
    }

    /* -------------------------- phone groups ------------------------- */

    public function groups(Request $request): void
    {
        unset($request);
        Response::ok($this->groups->all());
    }

    public function storeGroup(Request $request): void
    {
        $data = Validator::validate($request->body(), [
            'id' => 'required|string|min:2|max:64|regex:/^[a-z0-9-]+$/',
            'name' => 'required|string|min:2|max:120',
            'label' => 'nullable|string|max:160',
            'blurb' => 'nullable|string|max:320',
            'icon' => 'nullable|string|max:60',
        ]);

        try {
            $this->groups->create($data);
        } catch (PDOException $exception) {
            $this->translate($exception, 'A phone group with that id already exists.');
        }

        Logger::audit($request->admin, 'phone_group.created', 'phone_group', $data['id'], 'Created a phone group', $request->ip());

        Response::created($this->groups->findOrFail((string) $data['id']));
    }

    public function updateGroup(Request $request, string $id): void
    {
        $this->groups->findOrFail($id);

        $data = Validator::validate($request->body(), [
            'name' => 'nullable|string|min:2|max:120',
            'label' => 'nullable|string|max:160',
            'blurb' => 'nullable|string|max:320',
            'icon' => 'nullable|string|max:60',
        ]);

        $this->groups->update($id, $data);
        Logger::audit($request->admin, 'phone_group.updated', 'phone_group', $id, 'Updated a phone group', $request->ip());

        Response::ok($this->groups->findOrFail($id));
    }

    public function destroyGroup(Request $request, string $id): void
    {
        $this->groups->findOrFail($id);
        $this->groups->delete($id);

        Logger::audit($request->admin, 'phone_group.deleted', 'phone_group', $id, 'Deleted a phone group', $request->ip());
        Response::noContent();
    }

    private function translate(PDOException $exception, string $conflictMessage): never
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? '');
        $driverCode = (int) ($exception->errorInfo[1] ?? 0);

        if ($sqlState === '23000' && $driverCode === 1062) {
            throw ApiException::conflict($conflictMessage);
        }

        error_log('[taxonomy] write failed: ' . $exception->getMessage());
        throw ApiException::server('The record could not be saved.');
    }
}
