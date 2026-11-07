<?php
/**
 * Public content: pages, blog, homepage sections, FAQs, settings, SEO defaults,
 * integrations and the sitemap feed.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Config;
use Shn\Helpers\Database;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Models\BlogModel;
use Shn\Models\FaqModel;
use Shn\Models\HomepageModel;
use Shn\Models\PageModel;
use Shn\Models\SeoModel;
use Shn\Models\ServiceModel;
use Shn\Models\SettingModel;

final class PublicContentController extends Controller
{
    public function __construct(
        Request $request,
        private readonly PageModel $pages = new PageModel(),
        private readonly BlogModel $blog = new BlogModel(),
        private readonly HomepageModel $homepage = new HomepageModel(),
        private readonly FaqModel $faqs = new FaqModel(),
        private readonly SettingModel $settings = new SettingModel(),
        private readonly SeoModel $seo = new SeoModel(),
        private readonly ServiceModel $services = new ServiceModel(),
    ) {
        parent::__construct($request);
    }

    /* ----------------------------- pages ----------------------------- */

    public function pages(Request $request): void
    {
        unset($request);
        Response::ok($this->pages->publicIndex(), $this->meta());
    }

    public function page(Request $request, string $slug): void
    {
        unset($request);

        $path = $slug === 'root' ? '/' : '/' . ltrim($slug, '/');
        $page = $this->pages->publicBySlug($path);
        if ($page === null) {
            throw ApiException::notFound('That page does not exist.');
        }

        Response::ok($page, $this->meta());
    }

    /* ------------------------------ blog ----------------------------- */

    public function posts(Request $request): void
    {
        unset($request);
        ['page' => $page, 'per_page' => $perPage] = $this->pagination(10, 50);

        $result = $this->blog->publicIndex([
            'category' => $this->filter('category', 120),
            'tag' => $this->filter('tag', 120),
            'q' => $this->filter('q', 120),
        ], $page, $perPage);

        Response::paginated($result['items'], $result['meta'] + $this->meta());
    }

    public function post(Request $request, string $slug): void
    {
        unset($request);

        $post = $this->blog->publicBySlug($slug);
        if ($post === null) {
            throw ApiException::notFound('That article does not exist.');
        }

        Response::ok($post, $this->meta());
    }

    public function blogCategories(Request $request): void
    {
        unset($request);
        Response::ok($this->blog->publicCategories(), $this->meta());
    }

    public function blogTags(Request $request): void
    {
        unset($request);
        Response::ok($this->blog->publicTags(), $this->meta());
    }

    /* --------------------------- homepage ---------------------------- */

    public function homepage(Request $request): void
    {
        unset($request);

        Response::ok([
            'sections' => $this->homepage->publicSections(),
            'faqs' => $this->faqs->publicGroups(),
            'categories' => $this->services->publishedCategories(),
            'settings' => $this->settings->publicSettings(),
        ], $this->meta());
    }

    public function faqs(Request $request): void
    {
        unset($request);
        Response::ok($this->faqs->publicGroups(), $this->meta());
    }

    /* --------------------------- settings ---------------------------- */

    public function settings(Request $request): void
    {
        unset($request);
        Response::ok($this->settings->publicSettings(), $this->meta());
    }

    /**
     * Tracking + verification configuration for the public shell.
     * Snippets are validated on write and re-validated on read.
     */
    public function integrations(Request $request): void
    {
        unset($request);
        Response::ok($this->settings->publicIntegrations(), $this->meta());
    }

    public function seo(Request $request): void
    {
        unset($request);
        Response::ok($this->seo->publicView(), $this->meta());
    }

    /* ---------------------------- sitemap ---------------------------- */

    public function sitemap(Request $request): void
    {
        unset($request);

        $integrations = $this->settings->publicIntegrations();
        if ($integrations['sitemap_enabled'] !== true) {
            throw ApiException::notFound('The sitemap feed is disabled.');
        }

        $base = $this->settings->siteUrl();
        $entries = [];

        foreach ($this->pages->publicIndex() as $page) {
            $path = (string) $page['slug'];
            $entries[] = [
                'loc' => $base . ($path === '/' ? '/' : $path),
                'lastmod' => $this->isoDate((string) $page['updated_at']),
                'changefreq' => 'monthly',
                'priority' => $path === '/' ? 1.0 : 0.6,
            ];
        }

        foreach ($this->services->publishedList() as $service) {
            $entries[] = [
                'loc' => $base . '/services/' . $service['slug'],
                'changefreq' => 'monthly',
                'priority' => 0.8,
            ];
        }

        $posts = $this->blog->publicIndex([], 1, 50);
        foreach ($posts['items'] as $post) {
            $entries[] = [
                'loc' => $base . '/blog/' . $post['slug'],
                'lastmod' => $this->isoDate((string) ($post['published_at'] ?? '')),
                'changefreq' => 'yearly',
                'priority' => 0.5,
            ];
        }

        Response::ok([
            'base_url' => $base,
            'count' => count($entries),
            'entries' => $entries,
        ], $this->meta());
    }

    /* ----------------------------- health ---------------------------- */

    public function health(Request $request): void
    {
        unset($request);

        $databaseOk = Database::isConnected();

        Response::json([
            'data' => [
                'status' => $databaseOk ? 'ok' : 'degraded',
                'version' => Config::string('app.version', '1.0.0'),
                'php' => PHP_VERSION,
                'database' => $databaseOk ? 'connected' : 'unavailable',
                'time' => gmdate('c'),
            ],
        ], $databaseOk ? 200 : 503);
    }

    /* ---------------------------- helpers ---------------------------- */

    /** @return array<string,mixed> */
    private function meta(): array
    {
        return [
            'source' => 'database',
            'generated_at' => gmdate('c'),
        ];
    }

    private function isoDate(string $value): ?string
    {
        if ($value === '') {
            return null;
        }
        $timestamp = strtotime($value);
        return $timestamp === false ? null : gmdate('c', $timestamp);
    }
}
