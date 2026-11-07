<?php
/**
 * Admin CRUD for tracking numbers.
 *
 * Network, campaign, notes and verification are internal fields — they are
 * never included in public responses.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use PDOException;
use Shn\Helpers\ApiException;
use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Helpers\Validator;
use Shn\Models\PhoneGroupModel;
use Shn\Models\PhoneNumberModel;

final class AdminPhoneNumberController extends Controller
{
    private const RULES = [
        'external_id' => 'required|string|min:2|max:64|regex:/^[a-z0-9][a-z0-9-]*$/',
        'group_id' => 'required|string|max:64',
        'number' => 'required|phone|max:24',
        'label' => 'nullable|string|max:160',
        'priority' => 'nullable|int|min:1|max:9',
        'status' => 'nullable|in:active,pending-verification,inactive',
        'network' => 'nullable|string|max:120',
        'campaign' => 'nullable|string|max:160',
        'campaign_nationwide' => 'nullable|bool',
        'notes' => 'nullable|string|max:2000',
        'verified_at' => 'nullable|date',
    ];

    public function __construct(
        Request $request,
        private readonly PhoneNumberModel $numbers = new PhoneNumberModel(),
        private readonly PhoneGroupModel $groups = new PhoneGroupModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);
        ['page' => $page, 'per_page' => $perPage] = $this->pagination(50);

        $result = $this->numbers->adminList([
            'group' => $this->filter('group', 64),
            'status' => $this->filter('status', 30),
            'network' => $this->filter('network', 120),
            'q' => $this->filter('q', 120),
            'include_deleted' => $this->boolFilter('include_deleted'),
        ], $page, $perPage);

        Response::paginated($result['items'], $result['meta']);
    }

    public function show(Request $request, string $id): void
    {
        unset($request);
        Response::ok($this->numbers->adminFind($this->id($id, 'number id')));
    }

    public function store(Request $request): void
    {
        $data = $this->validatePayload($request, true);
        $this->assertGroup((string) $data['group_id']);

        try {
            $id = $this->numbers->create($data);
        } catch (PDOException $exception) {
            $this->translateWriteError($exception);
        }

        Logger::audit($request->admin, 'number.created', 'phone_number', $id, 'Added number ' . ($data['number'] ?? ''), $request->ip());

        Response::created($this->numbers->adminFind($id));
    }

    public function update(Request $request, string $id): void
    {
        $numberId = $this->id($id, 'number id');
        $this->numbers->adminFind($numberId);

        $data = $this->validatePayload($request, false);
        if (isset($data['group_id'])) {
            $this->assertGroup((string) $data['group_id']);
        }

        try {
            $this->numbers->update($numberId, $data);
        } catch (PDOException $exception) {
            $this->translateWriteError($exception);
        }

        Logger::audit($request->admin, 'number.updated', 'phone_number', $numberId, 'Updated a tracking number', $request->ip());

        Response::ok($this->numbers->adminFind($numberId));
    }

    /** Marks a number as verified and active. */
    public function verify(Request $request, string $id): void
    {
        $numberId = $this->id($id, 'number id');
        $this->numbers->adminFind($numberId);

        $this->numbers->update($numberId, [
            'status' => 'active',
            'verified_at' => gmdate('Y-m-d H:i:s'),
        ]);

        Logger::audit($request->admin, 'number.verified', 'phone_number', $numberId, 'Verified a tracking number', $request->ip());

        Response::ok($this->numbers->adminFind($numberId));
    }

    public function destroy(Request $request, string $id): void
    {
        $numberId = $this->id($id, 'number id');
        $this->numbers->adminFind($numberId);

        $this->numbers->softDelete($numberId);
        Logger::audit($request->admin, 'number.deleted', 'phone_number', $numberId, 'Soft-deleted a number', $request->ip());

        Response::noContent();
    }

    public function restore(Request $request, string $id): void
    {
        $numberId = $this->id($id, 'number id');
        $this->numbers->adminFind($numberId, true);

        $this->numbers->restore($numberId);
        Logger::audit($request->admin, 'number.restored', 'phone_number', $numberId, 'Restored a number', $request->ip());

        Response::ok($this->numbers->adminFind($numberId));
    }

    /** Which services currently resolve to this number. */
    public function services(Request $request, string $id): void
    {
        unset($request);
        $numberId = $this->id($id, 'number id');
        $this->numbers->adminFind($numberId);

        Response::ok($this->numbers->servicesForNumber($numberId));
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $isCreate): array
    {
        $rules = self::RULES;
        if (!$isCreate) {
            $rules['external_id'] = 'nullable|string|min:2|max:64|regex:/^[a-z0-9][a-z0-9-]*$/';
            $rules['group_id'] = 'nullable|string|max:64';
            $rules['number'] = 'nullable|phone|max:24';
        }

        $data = Validator::validate($request->body(), $rules);

        foreach (['campaign_states', 'campaign_zip_codes'] as $field) {
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
            $entries = [];
            foreach ($value as $entry) {
                if (!is_scalar($entry)) {
                    continue;
                }
                $entry = strtoupper(trim((string) $entry));
                if ($field === 'campaign_states' && !preg_match('/^[A-Z]{2}$/', $entry)) {
                    throw ApiException::unprocessable('States must be two-letter codes.', [$field => 'Use two-letter state codes.']);
                }
                if ($field === 'campaign_zip_codes' && !preg_match('/^\d{5}$/', $entry)) {
                    throw ApiException::unprocessable('ZIP codes must be five digits.', [$field => 'Use five-digit ZIP codes.']);
                }
                $entries[] = $entry;
            }
            $data[$field] = array_values(array_unique($entries));
        }

        return $data;
    }

    private function assertGroup(string $groupId): void
    {
        try {
            $this->groups->findOrFail($groupId);
        } catch (ApiException) {
            throw ApiException::unprocessable('That phone group does not exist.', ['group_id' => 'Unknown group.']);
        }
    }

    private function translateWriteError(PDOException $exception): never
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? '');
        $driverCode = (int) ($exception->errorInfo[1] ?? 0);

        if ($sqlState === '23000' && $driverCode === 1062) {
            throw ApiException::conflict(
                'That number or external id is already in use.',
                ['number' => 'Duplicate number or external id.'],
            );
        }
        if ($sqlState === '23000' && $driverCode === 1452) {
            throw ApiException::unprocessable('That phone group does not exist.', ['group_id' => 'Unknown group.']);
        }

        error_log('[number] write failed: ' . $exception->getMessage());
        throw ApiException::server('The number could not be saved.');
    }
}
