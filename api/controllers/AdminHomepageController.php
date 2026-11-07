<?php
/**
 * Admin management of homepage sections (visibility, copy, ordering).
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
use Shn\Models\HomepageModel;

final class AdminHomepageController extends Controller
{
    public function __construct(
        Request $request,
        private readonly HomepageModel $homepage = new HomepageModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);
        Response::ok($this->homepage->adminList());
    }

    public function show(Request $request, string $id): void
    {
        unset($request);
        Response::ok($this->homepage->adminFind($this->id($id, 'section id')));
    }

    public function store(Request $request): void
    {
        $data = Validator::validate($request->body(), [
            'section_key' => 'required|string|min:2|max:80|regex:/^[a-z0-9_-]+$/',
            'name' => 'required|string|min:2|max:120',
            'heading' => 'nullable|string|max:220',
            'subheading' => 'nullable|string|max:400',
            'body' => 'nullable|string|max:5000',
            'visible' => 'nullable|bool',
            'sort_order' => 'nullable|int|min:0|max:999',
        ]);

        $this->sanitiseCopy($data);

        try {
            $id = $this->homepage->create($data);
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        Logger::audit($request->admin, 'homepage_section.created', 'homepage_section', $id, 'Created a homepage section', $request->ip());
        Response::created($this->homepage->adminFind($id));
    }

    public function update(Request $request, string $id): void
    {
        $sectionId = $this->id($id, 'section id');
        $this->homepage->adminFind($sectionId);

        $data = Validator::validate($request->body(), [
            'section_key' => 'nullable|string|min:2|max:80|regex:/^[a-z0-9_-]+$/',
            'name' => 'nullable|string|min:2|max:120',
            'heading' => 'nullable|string|max:220',
            'subheading' => 'nullable|string|max:400',
            'body' => 'nullable|string|max:5000',
            'visible' => 'nullable|bool',
            'sort_order' => 'nullable|int|min:0|max:999',
        ]);

        $this->sanitiseCopy($data);

        try {
            $this->homepage->update($sectionId, $data);
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        Logger::audit($request->admin, 'homepage_section.updated', 'homepage_section', $sectionId, 'Updated a homepage section', $request->ip());
        Response::ok($this->homepage->adminFind($sectionId));
    }

    public function destroy(Request $request, string $id): void
    {
        $sectionId = $this->id($id, 'section id');
        $this->homepage->adminFind($sectionId);

        $this->homepage->delete($sectionId);
        Logger::audit($request->admin, 'homepage_section.deleted', 'homepage_section', $sectionId, 'Deleted a homepage section', $request->ip());

        Response::noContent();
    }

    public function reorder(Request $request): void
    {
        $ids = $request->input('order', []);
        if (!is_array($ids) || $ids === []) {
            throw ApiException::unprocessable('Send the section ids in display order.', ['order' => 'A non-empty list is required.']);
        }

        $clean = [];
        foreach ($ids as $id) {
            if (is_numeric($id) && (int) $id > 0) {
                $clean[] = (int) $id;
            }
        }

        $this->homepage->reorder($clean);
        Logger::audit($request->admin, 'homepage_section.reordered', 'homepage_section', null, 'Reordered homepage sections', $request->ip());

        Response::ok($this->homepage->adminList());
    }

    /** @param array<string,mixed> $data */
    private function sanitiseCopy(array &$data): void
    {
        foreach (['heading', 'subheading', 'name'] as $field) {
            if (isset($data[$field])) {
                $data[$field] = Security::plainText((string) $data[$field], 400);
            }
        }
        if (isset($data['body'])) {
            $data['body'] = Security::sanitizeHtml((string) $data['body']);
        }
    }

    private function translate(PDOException $exception): never
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? '');
        $driverCode = (int) ($exception->errorInfo[1] ?? 0);

        if ($sqlState === '23000' && $driverCode === 1062) {
            throw ApiException::conflict('A section with that key already exists.', ['section_key' => 'Already used.']);
        }

        error_log('[homepage] write failed: ' . $exception->getMessage());
        throw ApiException::server('The section could not be saved.');
    }
}
