<?php
/**
 * Admin CRUD for static pages.
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
use Shn\Models\PageModel;
use Shn\Services\Scheduler;
use Shn\Services\SitemapBuilder;

final class AdminPageController extends Controller
{
    public function __construct(
        Request $request,
        private readonly PageModel $pages = new PageModel(),
        private readonly Scheduler $scheduler = new Scheduler(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);
        ['page' => $page, 'per_page' => $perPage] = $this->pagination(30);

        $result = $this->pages->adminList([
            'status' => $this->filter('status', 20),
            'q' => $this->filter('q', 120),
            'include_deleted' => $this->boolFilter('include_deleted'),
        ], $page, $perPage);

        Response::paginated($result['items'], $result['meta']);
    }

    public function show(Request $request, string $id): void
    {
        unset($request);
        Response::ok($this->pages->adminFind($this->id($id, 'page id')));
    }

    public function store(Request $request): void
    {
        $data = $this->validatePayload($request, true);

        try {
            $id = $this->pages->create($data, $this->adminId());
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        $this->afterWrite($id, $data);
        Logger::audit($request->admin, 'page.created', 'page', $id, 'Created page ' . ($data['title'] ?? ''), $request->ip());
        Response::created($this->pages->adminFind($id));
    }

    public function update(Request $request, string $id): void
    {
        $pageId = $this->id($id, 'page id');
        $this->pages->adminFind($pageId);

        $data = $this->validatePayload($request, false);

        try {
            $this->pages->update($pageId, $data, $this->adminId());
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        $this->afterWrite($pageId, $data);
        Logger::audit($request->admin, 'page.updated', 'page', $pageId, 'Updated a page', $request->ip());
        Response::ok($this->pages->adminFind($pageId));
    }

    public function destroy(Request $request, string $id): void
    {
        $pageId = $this->id($id, 'page id');
        $this->pages->adminFind($pageId);

        $this->pages->softDelete($pageId);
        Logger::audit($request->admin, 'page.deleted', 'page', $pageId, 'Soft-deleted a page', $request->ip());

        Response::noContent();
    }

    public function restore(Request $request, string $id): void
    {
        $pageId = $this->id($id, 'page id');
        $this->pages->adminFind($pageId, true);

        $this->pages->restore($pageId);
        Logger::audit($request->admin, 'page.restored', 'page', $pageId, 'Restored a page', $request->ip());

        Response::ok($this->pages->adminFind($pageId));
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $isCreate): array
    {
        $rules = [
            'slug' => ($isCreate ? 'required' : 'nullable') . '|path|max:180',
            'title' => ($isCreate ? 'required' : 'nullable') . '|string|min:2|max:200',
            'template' => 'nullable|in:standard,legal,landing',
            'status' => 'nullable|in:published,draft,scheduled',
            'excerpt' => 'nullable|string|max:400',
            'body' => 'nullable|string|max:200000',
            'seo_title' => 'nullable|string|max:200',
            'seo_description' => 'nullable|string|max:320',
            'focus_keyword' => 'nullable|string|max:160',
            'secondary_keywords' => 'nullable|string|max:500',
            'canonical_url' => 'nullable|string|max:500',
            'noindex' => 'nullable|bool',
            'og_image' => 'nullable|string|max:255',
            'page_group' => 'nullable|string|max:80',
            'sort_order' => 'nullable|int',
            'published_at' => 'nullable|date',
            'scheduled_at' => 'nullable|date',
        ];

        $data = Validator::validate($request->body(), $rules);

        if (array_key_exists('body', $request->body())) {
            $data['body'] = Security::sanitizeHtml((string) ($data['body'] ?? ''));
        }
        if (isset($data['excerpt']) && $data['excerpt'] !== null) {
            $data['excerpt'] = Security::plainText((string) $data['excerpt'], 400);
        }

        if (array_key_exists('canonical_url', $data) && $data['canonical_url'] !== null && $data['canonical_url'] !== '' && !Security::isSafeUrl((string) $data['canonical_url'])) {
            throw ApiException::unprocessable('The canonical URL must start with / or https://.', ['canonical_url' => 'Invalid URL.']);
        }
        if (array_key_exists('og_image', $data) && $data['og_image'] !== null && $data['og_image'] !== '' && !Security::isSafeUrl((string) $data['og_image'])) {
            throw ApiException::unprocessable('Use an image path that starts with / or an https URL.', ['og_image' => 'Invalid image path.']);
        }

        if (($data['status'] ?? null) === 'scheduled' && empty($data['scheduled_at']) && empty($data['published_at'])) {
            throw ApiException::unprocessable('Choose a publish date for a scheduled page.', ['scheduled_at' => 'Required when scheduling.']);
        }

        return $data;
    }

    /** @param array<string,mixed> $data */
    private function afterWrite(?int $pageId, array $data): void
    {
        if ($pageId === null) {
            return;
        }

        $status = $data['status'] ?? null;
        if ($status === 'scheduled') {
            $page = $this->pages->adminFind($pageId);
            $this->scheduler->logScheduled('page', $pageId, $page['scheduled_at'] ?? null, 'admin');
        }

        if ($status === 'published' || $status === 'scheduled') {
            try {
                (new SitemapBuilder())->write();
            } catch (\Throwable $error) {
                error_log('[sitemap] rebuild skipped: ' . $error->getMessage());
            }
        }
    }

    private function translate(PDOException $exception): never
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? '');
        $driverCode = (int) ($exception->errorInfo[1] ?? 0);

        if ($sqlState === '23000' && $driverCode === 1062) {
            throw ApiException::conflict('A page with that path already exists.', ['slug' => 'This path is already used.']);
        }

        error_log('[page] write failed: ' . $exception->getMessage());
        throw ApiException::server('The page could not be saved.');
    }
}
