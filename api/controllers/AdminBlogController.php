<?php
/**
 * Admin CRUD for blog posts, categories and tags.
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
use Shn\Models\BlogModel;
use Shn\Services\Scheduler;
use Shn\Services\SitemapBuilder;

final class AdminBlogController extends Controller
{
    public function __construct(
        Request $request,
        private readonly BlogModel $blog = new BlogModel(),
        private readonly Scheduler $scheduler = new Scheduler(),
    ) {
        parent::__construct($request);
    }

    /* ----------------------------- posts ----------------------------- */

    public function index(Request $request): void
    {
        unset($request);
        ['page' => $page, 'per_page' => $perPage] = $this->pagination(20);

        $result = $this->blog->adminList([
            'status' => $this->filter('status', 20),
            'category' => $this->filter('category', 120),
            'q' => $this->filter('q', 120),
            'include_deleted' => $this->boolFilter('include_deleted'),
        ], $page, $perPage);

        Response::paginated($result['items'], $result['meta']);
    }

    public function show(Request $request, string $id): void
    {
        unset($request);
        Response::ok($this->blog->adminFind($this->id($id, 'post id')));
    }

    public function store(Request $request): void
    {
        $data = $this->validatePayload($request, true);
        $data['updated_by'] = $this->adminId();
        $tagIds = $this->tagIds($request);

        try {
            $id = $this->blog->create($data, $tagIds);
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        $this->syncMetadata($request, $id);
        $this->afterWrite($request, $id, $data);

        Logger::audit($request->admin, 'post.created', 'blog_post', $id, 'Created post ' . ($data['title'] ?? ''), $request->ip());
        Response::created($this->blog->adminFind($id));
    }

    public function update(Request $request, string $id): void
    {
        $postId = $this->id($id, 'post id');
        $this->blog->adminFind($postId);

        $data = $this->validatePayload($request, false);
        $data['updated_by'] = $this->adminId();
        $tagIds = array_key_exists('tag_ids', $request->body()) ? $this->tagIds($request) : null;

        try {
            $this->blog->update($postId, $data, $tagIds);
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        $this->syncMetadata($request, $postId);
        $this->afterWrite($request, $postId, $data);

        Logger::audit($request->admin, 'post.updated', 'blog_post', $postId, 'Updated a post', $request->ip());
        Response::ok($this->blog->adminFind($postId));
    }

    /** Publishes a draft/scheduled post immediately. */
    public function publish(Request $request, string $id): void
    {
        $postId = $this->id($id, 'post id');
        $post = $this->blog->adminFind($postId);

        $this->blog->update($postId, [
            'status' => 'published',
            'published_at' => gmdate('Y-m-d H:i:s'),
            'scheduled_at' => null,
            'updated_by' => $this->adminId(),
        ]);

        $this->rebuildSitemap();
        Logger::audit($request->admin, 'post.published', 'blog_post', $postId, 'Published ' . $post['title'], $request->ip());

        Response::ok($this->blog->adminFind($postId));
    }

    /** Takes a post offline without deleting it. */
    public function unpublish(Request $request, string $id): void
    {
        $postId = $this->id($id, 'post id');
        $this->blog->adminFind($postId);

        $this->blog->update($postId, ['status' => 'draft', 'scheduled_at' => null, 'updated_by' => $this->adminId()]);
        $this->rebuildSitemap();
        Logger::audit($request->admin, 'post.unpublished', 'blog_post', $postId, 'Moved a post back to draft', $request->ip());

        Response::ok($this->blog->adminFind($postId));
    }

    /* --------------------------- metadata ---------------------------- */

    /** Stores the editorial extras sent as `metadata: {key: value}`. */
    private function syncMetadata(Request $request, int $postId): void
    {
        $body = $request->body();
        if (!array_key_exists('metadata', $body)) {
            return;
        }
        $metadata = $body['metadata'];
        if ($metadata === null) {
            return;
        }
        if (!is_array($metadata)) {
            throw ApiException::unprocessable('metadata must be an object.', ['metadata' => 'Must be an object of key/value pairs.']);
        }
        $this->blog->syncMetadata($postId, $metadata);
    }

    /**
     * Side effects shared by create and update: log a scheduling decision and
     * keep the public sitemap in sync when something becomes visible.
     *
     * @param array<string,mixed> $data
     */
    private function afterWrite(Request $request, int $postId, array $data): void
    {
        $status = $data['status'] ?? null;

        if ($status === 'scheduled') {
            $post = $this->blog->adminFind($postId);
            $this->scheduler->logScheduled('post', $postId, $post['scheduled_at'] ?? null, 'admin:' . (string) ($this->admin()['email'] ?? 'unknown'));
        }

        if ($status === 'published' || $status === 'scheduled') {
            $this->rebuildSitemap();
        }

        unset($request);
    }

    private function rebuildSitemap(): void
    {
        try {
            (new SitemapBuilder())->write();
        } catch (\Throwable $error) {
            // A read-only public folder must not fail a save; the cron retries.
            error_log('[sitemap] rebuild skipped: ' . $error->getMessage());
        }
    }

    public function destroy(Request $request, string $id): void
    {
        $postId = $this->id($id, 'post id');
        $this->blog->adminFind($postId);

        $this->blog->softDelete($postId);
        Logger::audit($request->admin, 'post.deleted', 'blog_post', $postId, 'Soft-deleted a post', $request->ip());

        Response::noContent();
    }

    public function restore(Request $request, string $id): void
    {
        $postId = $this->id($id, 'post id');
        $this->blog->adminFind($postId, true);

        $this->blog->restore($postId);
        Logger::audit($request->admin, 'post.restored', 'blog_post', $postId, 'Restored a post', $request->ip());

        Response::ok($this->blog->adminFind($postId));
    }

    /* --------------------------- taxonomy ---------------------------- */

    public function categories(Request $request): void
    {
        unset($request);
        Response::ok($this->blog->adminCategories());
    }

    public function storeCategory(Request $request): void
    {
        $data = Validator::validate($request->body(), [
            'slug' => 'required|slug|max:120',
            'name' => 'required|string|min:2|max:160',
            'description' => 'nullable|string|max:400',
            'seo_title' => 'nullable|string|max:200',
            'seo_description' => 'nullable|string|max:320',
            'sort_order' => 'nullable|int',
            'noindex' => 'nullable|bool',
        ]);

        try {
            $id = $this->blog->createCategory($data);
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        Logger::audit($request->admin, 'blog_category.created', 'blog_category', $id, 'Created a blog category', $request->ip());
        Response::created(['id' => $id] + $data);
    }

    public function updateCategory(Request $request, string $id): void
    {
        $categoryId = $this->id($id, 'category id');

        $data = Validator::validate($request->body(), [
            'slug' => 'nullable|slug|max:120',
            'name' => 'nullable|string|min:2|max:160',
            'description' => 'nullable|string|max:400',
            'seo_title' => 'nullable|string|max:200',
            'seo_description' => 'nullable|string|max:320',
            'sort_order' => 'nullable|int',
            'noindex' => 'nullable|bool',
        ]);

        try {
            $this->blog->updateCategory($categoryId, $data);
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        Logger::audit($request->admin, 'blog_category.updated', 'blog_category', $categoryId, 'Updated a blog category', $request->ip());
        Response::ok(['id' => $categoryId] + $data);
    }

    public function destroyCategory(Request $request, string $id): void
    {
        $categoryId = $this->id($id, 'category id');
        $this->blog->deleteCategory($categoryId);

        Logger::audit($request->admin, 'blog_category.deleted', 'blog_category', $categoryId, 'Deleted a blog category', $request->ip());
        Response::noContent();
    }

    public function tags(Request $request): void
    {
        unset($request);
        Response::ok($this->blog->adminTags());
    }

    public function storeTag(Request $request): void
    {
        $data = Validator::validate($request->body(), [
            'slug' => 'required|slug|max:120',
            'name' => 'required|string|min:1|max:160',
        ]);

        try {
            $id = $this->blog->createTag($data);
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        Logger::audit($request->admin, 'blog_tag.created', 'blog_tag', $id, 'Created a blog tag', $request->ip());
        Response::created(['id' => $id] + $data);
    }

    public function updateTag(Request $request, string $id): void
    {
        $tagId = $this->id($id, 'tag id');

        $data = Validator::validate($request->body(), [
            'slug' => 'nullable|slug|max:120',
            'name' => 'nullable|string|min:1|max:160',
        ]);

        try {
            $this->blog->updateTag($tagId, $data);
        } catch (PDOException $exception) {
            $this->translate($exception);
        }

        Logger::audit($request->admin, 'blog_tag.updated', 'blog_tag', $tagId, 'Updated a blog tag', $request->ip());
        Response::ok(['id' => $tagId] + $data);
    }

    public function destroyTag(Request $request, string $id): void
    {
        $tagId = $this->id($id, 'tag id');
        $this->blog->deleteTag($tagId);

        Logger::audit($request->admin, 'blog_tag.deleted', 'blog_tag', $tagId, 'Deleted a blog tag', $request->ip());
        Response::noContent();
    }

    /* --------------------------- validation -------------------------- */

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $isCreate): array
    {
        $rules = [
            'slug' => 'nullable|slug|max:180',
            'title' => ($isCreate ? 'required' : 'nullable') . '|string|min:3|max:220',
            'category_id' => 'nullable|int',
            'status' => 'nullable|in:published,draft,scheduled',
            'excerpt' => 'nullable|string|max:500',
            'body' => 'nullable|string|max:200000',
            'featured_image' => 'nullable|string|max:255',
            'featured_image_alt' => 'nullable|string|max:200',
            'seo_title' => 'nullable|string|max:200',
            'seo_description' => 'nullable|string|max:320',
            'seo_summary' => 'nullable|string|max:500',
            'focus_keyword' => 'nullable|string|max:160',
            'secondary_keywords' => 'nullable|string|max:500',
            'canonical_url' => 'nullable|string|max:500',
            'noindex' => 'nullable|bool',
            'social_image' => 'nullable|string|max:255',
            'author_name' => 'nullable|string|max:120',
            'published_at' => 'nullable|date',
            'scheduled_at' => 'nullable|date',
        ];

        $data = Validator::validate($request->body(), $rules);

        // The editor can send an empty slug while the admin is still typing a
        // title; derive a unique one from the title instead of failing.
        if ($isCreate && empty($data['slug'])) {
            $data['slug'] = $this->uniqueSlug(Validator::slugify((string) ($data['title'] ?? 'post')));
        }
        if (!$isCreate && array_key_exists('slug', $request->body()) && empty($data['slug'])) {
            unset($data['slug']);
        }
        if (array_key_exists('canonical_url', $data) && $data['canonical_url'] !== null && $data['canonical_url'] !== '' && !Security::isSafeUrl((string) $data['canonical_url'])) {
            throw ApiException::unprocessable('The canonical URL must start with / or https://.', ['canonical_url' => 'Invalid URL.']);
        }
        if (array_key_exists('social_image', $data) && $data['social_image'] !== null && $data['social_image'] !== '' && !Security::isSafeUrl((string) $data['social_image'])) {
            throw ApiException::unprocessable('Use an image path that starts with / or an https URL.', ['social_image' => 'Invalid image path.']);
        }

        if (array_key_exists('body', $request->body())) {
            $data['body'] = Security::sanitizeHtml((string) ($data['body'] ?? ''));
        }
        if (isset($data['excerpt']) && $data['excerpt'] !== null) {
            $data['excerpt'] = Security::plainText((string) $data['excerpt'], 500);
        }
        if (isset($data['featured_image']) && $data['featured_image'] !== null && !Security::isSafeUrl((string) $data['featured_image'])) {
            throw ApiException::unprocessable('Use an image path that starts with / or an https URL.', ['featured_image' => 'Invalid image path.']);
        }

        if (($data['status'] ?? null) === 'scheduled' && empty($data['scheduled_at']) && empty($data['published_at'])) {
            throw ApiException::unprocessable('Choose a publish date for a scheduled post.', ['scheduled_at' => 'Required when scheduling.']);
        }

        return $data;
    }

    /** @return array<int,int> */
    private function tagIds(Request $request): array
    {
        $value = $request->input('tag_ids', []);
        if ($value === null) {
            return [];
        }
        if (!is_array($value)) {
            throw ApiException::unprocessable('tag_ids must be a list.', ['tag_ids' => 'Must be a list.']);
        }

        $ids = [];
        foreach ($value as $id) {
            if (is_numeric($id) && (int) $id > 0) {
                $ids[] = (int) $id;
            }
        }

        return array_values(array_unique($ids));
    }

    /** Appends -2, -3 … until the slug is free (soft-deleted rows included). */
    private function uniqueSlug(string $slug, int $ignoreId = 0): string
    {
        $slug = $slug === '' ? 'post' : $slug;
        $candidate = $slug;
        $suffix = 1;

        while (true) {
            $statement = $this->blog->slugTaken($candidate, $ignoreId);
            if (!$statement) {
                return $candidate;
            }
            $suffix++;
            $candidate = $slug . '-' . $suffix;
            if ($suffix > 50) {
                return $slug . '-' . substr((string) time(), -5);
            }
        }
    }

    private function translate(PDOException $exception): never
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? '');
        $driverCode = (int) ($exception->errorInfo[1] ?? 0);

        if ($sqlState === '23000' && $driverCode === 1062) {
            throw ApiException::conflict('That slug is already in use.', ['slug' => 'Already used.']);
        }

        error_log('[blog] write failed: ' . $exception->getMessage());
        throw ApiException::server('The post could not be saved.');
    }
}
