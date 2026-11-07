<?php
/**
 * Admin CRUD for services and their phone-group mappings.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use PDOException;
use Shn\Helpers\ApiException;
use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Helpers\Security;
use Shn\Helpers\Validator;
use Shn\Models\CategoryModel;
use Shn\Models\PhoneGroupModel;
use Shn\Models\ServiceModel;

final class AdminServiceController extends Controller
{
    private const RULES = [
        'slug' => 'required|slug|max:120',
        'name' => 'required|string|min:2|max:160',
        'short_name' => 'nullable|string|max:80',
        'category_id' => 'nullable|string|max:32',
        'niche_id' => 'nullable|int',
        'icon' => 'nullable|string|max:60',
        'image' => 'nullable|string|max:255',
        'featured' => 'nullable|bool',
        'status' => 'nullable|in:published,draft',
        'sort_order' => 'nullable|int|min:0',
        'hero_headline' => 'nullable|string|max:200',
        'hero_subheadline' => 'nullable|string|max:400',
        'short_description' => 'nullable|string|max:400',
        'process_note' => 'nullable|string|max:5000',
        'meta_title' => 'nullable|string|max:200',
        'meta_description' => 'nullable|string|max:320',
    ];

    public function __construct(
        Request $request,
        private readonly ServiceModel $services = new ServiceModel(),
        private readonly CategoryModel $categories = new CategoryModel(),
        private readonly PhoneGroupModel $groups = new PhoneGroupModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);
        ['page' => $page, 'per_page' => $perPage] = $this->pagination(25);

        $result = $this->services->adminList([
            'status' => $this->filter('status', 20),
            'category' => $this->filter('category', 32),
            'niche' => $this->filter('niche', 40),
            'q' => $this->filter('q', 120),
            'include_deleted' => $this->boolFilter('include_deleted'),
        ], $page, $perPage);

        Response::paginated($result['items'], $result['meta']);
    }

    public function show(Request $request, string $id): void
    {
        unset($request);
        Response::ok($this->services->adminFind($this->id($id, 'service id')));
    }

    public function store(Request $request): void
    {
        $data = $this->validatePayload($request, true);
        $this->assertCategory($data['category_id'] ?? null);

        try {
            $id = $this->services->create($data);
        } catch (PDOException $exception) {
            $this->translateWriteError($exception);
        }

        if (array_key_exists('phone_group_ids', $request->body())) {
            $this->services->syncGroups($id, $this->groupIds($request));
        }

        Logger::audit($request->admin, 'service.created', 'service', $id, 'Created service ' . ($data['name'] ?? ''), $request->ip());

        Response::created($this->services->adminFind($id));
    }

    public function update(Request $request, string $id): void
    {
        $serviceId = $this->id($id, 'service id');
        $this->services->adminFind($serviceId); // 404s early when missing

        $data = $this->validatePayload($request, false);
        $this->assertCategory($data['category_id'] ?? null);

        try {
            $this->services->update($serviceId, $data);
        } catch (PDOException $exception) {
            $this->translateWriteError($exception);
        }

        if (array_key_exists('phone_group_ids', $request->body())) {
            $this->services->syncGroups($serviceId, $this->groupIds($request));
        }

        Logger::audit($request->admin, 'service.updated', 'service', $serviceId, 'Updated service ' . ($data['name'] ?? ''), $request->ip());

        Response::ok($this->services->adminFind($serviceId));
    }

    public function destroy(Request $request, string $id): void
    {
        $serviceId = $this->id($id, 'service id');
        $this->services->adminFind($serviceId);

        $this->services->softDelete($serviceId);
        Logger::audit($request->admin, 'service.deleted', 'service', $serviceId, 'Soft-deleted a service', $request->ip());

        Response::noContent();
    }

    public function restore(Request $request, string $id): void
    {
        $serviceId = $this->id($id, 'service id');
        $this->services->adminFind($serviceId, true);

        $this->services->restore($serviceId);
        Logger::audit($request->admin, 'service.restored', 'service', $serviceId, 'Restored a service', $request->ip());

        Response::ok($this->services->adminFind($serviceId));
    }

    public function syncGroups(Request $request, string $id): void
    {
        $serviceId = $this->id($id, 'service id');
        $this->services->adminFind($serviceId);

        $groups = $this->groupIds($request);
        $this->services->syncGroups($serviceId, $groups);

        Logger::audit(
            $request->admin,
            'service.groups_synced',
            'service',
            $serviceId,
            'Mapped ' . count($groups) . ' phone group(s)',
            $request->ip(),
        );

        Response::ok([
            'service_id' => $serviceId,
            'phone_group_ids' => $groups,
            'phone_groups' => $this->services->publicGroups($serviceId),
        ]);
    }

    /**
     * Read-only mapping report: every service with the groups/numbers it
     * resolves to. Used to verify the 10 groups / 20 numbers stay intact.
     */
    public function mapping(Request $request): void
    {
        unset($request);

        $items = [];
        foreach ($this->services->adminList(['include_deleted' => false], 1, 200)['items'] as $service) {
            $items[] = [
                'service_id' => $service['id'],
                'slug' => $service['slug'],
                'name' => $service['name'],
                'status' => $service['status'],
                'phone_group_ids' => $this->services->groupIdsFor((int) $service['id']),
                'phone_groups' => $this->services->publicGroups((int) $service['id']),
            ];
        }

        Response::ok([
            'items' => $items,
            'groups' => $this->groups->all(),
            'unmapped_services' => array_values(array_map(
                static fn (array $item): string => $item['slug'],
                array_filter($items, static fn (array $item): bool => $item['phone_groups'] === []),
            )),
        ]);
    }

    /* --------------------------- validation -------------------------- */

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $isCreate): array
    {
        $rules = self::RULES;
        if (!$isCreate) {
            $rules['slug'] = 'nullable|slug|max:120';
            $rules['name'] = 'nullable|string|min:2|max:160';
        }

        $data = Validator::validate($request->body(), $rules);

        foreach (['intro', 'common_needs', 'options', 'faqs', 'related', 'search_terms'] as $field) {
            if (!array_key_exists($field, $request->body())) {
                continue;
            }
            $value = $request->input($field);
            if ($value === null) {
                $data[$field] = [];
                continue;
            }
            if (!is_array($value)) {
                throw ApiException::unprocessable('The ' . $field . ' field must be a list.', [$field => 'Must be a list.']);
            }
            $data[$field] = $this->sanitiseBlocks($field, $value);
        }

        if (isset($data['image']) && $data['image'] !== null && !Security::isSafeUrl((string) $data['image'])) {
            throw ApiException::unprocessable('Use an image path that starts with / or an https URL.', ['image' => 'Invalid image path.']);
        }

        return $data;
    }

    /**
     * Shapes the repeatable blocks used by the service template and strips any
     * markup from text fields (these are rendered as text, not HTML).
     *
     * @param array<int,mixed> $value
     * @return array<int,mixed>
     */
    private function sanitiseBlocks(string $field, array $value): array
    {
        if (count($value) > 40) {
            throw ApiException::unprocessable('Too many entries in ' . $field . '.', [$field => 'Maximum 40 entries.']);
        }

        $clean = [];
        foreach ($value as $item) {
            if (is_string($item)) {
                $text = Security::plainText($item, 4000);
                if ($text !== '') {
                    $clean[] = $text;
                }
                continue;
            }

            if (!is_array($item)) {
                continue;
            }

            $entry = [];
            foreach (['title', 'description', 'question', 'answer', 'slug', 'name', 'href', 'label'] as $key) {
                if (isset($item[$key]) && is_string($item[$key])) {
                    $entry[$key] = Security::plainText($item[$key], 4000);
                }
            }

            if ($entry !== []) {
                $clean[] = $entry;
            }
        }

        return $clean;
    }

    private function assertCategory(mixed $categoryId): void
    {
        if ($categoryId === null || $categoryId === '') {
            return;
        }
        try {
            $this->categories->findOrFail((string) $categoryId);
        } catch (ApiException) {
            throw ApiException::unprocessable('That service category does not exist.', ['category_id' => 'Unknown category.']);
        }
    }

    /** @return array<int,string> */
    private function groupIds(Request $request): array
    {
        $value = $request->input('phone_group_ids', []);

        if ($value === null) {
            return [];
        }
        if (!is_array($value)) {
            throw ApiException::unprocessable('phone_group_ids must be a list of group ids.', ['phone_group_ids' => 'Must be a list.']);
        }

        $ids = [];
        foreach ($value as $id) {
            if (!is_scalar($id)) {
                throw ApiException::unprocessable('phone_group_ids must contain strings.', ['phone_group_ids' => 'Invalid entry.']);
            }
            $ids[] = (string) $id;
        }

        return array_values(array_unique($ids));
    }

    private function translateWriteError(PDOException $exception): never
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? '');
        $driverCode = (int) ($exception->errorInfo[1] ?? 0);

        if ($sqlState === '23000' && $driverCode === 1062) {
            throw ApiException::conflict('A service with that slug already exists.', ['slug' => 'This slug is already used.']);
        }
        if ($sqlState === '23000' && $driverCode === 1452) {
            throw ApiException::unprocessable('A referenced record does not exist.', ['category_id' => 'Unknown reference.']);
        }

        error_log('[service] write failed: ' . $exception->getMessage());
        throw ApiException::server('The service could not be saved.');
    }
}
