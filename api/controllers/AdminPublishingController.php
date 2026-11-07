<?php
/**
 * Publishing controls: run the scheduler on demand, inspect its log and
 * rebuild the sitemap. The same code paths are used by the CLI cron jobs.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Services\Scheduler;
use Shn\Services\SitemapBuilder;
use Throwable;

final class AdminPublishingController extends Controller
{
    public function __construct(
        Request $request,
        private readonly Scheduler $scheduler = new Scheduler(),
    ) {
        parent::__construct($request);
    }

    /** Publishes everything that is due and reports what happened. */
    public function run(Request $request): void
    {
        $actor = 'admin:' . (string) ($this->admin()['email'] ?? 'unknown');

        $result = $this->scheduler->run($actor, 200);

        Logger::audit(
            $request->admin,
            'publishing.run',
            'publishing_log',
            null,
            'Manual scheduler run: ' . count($result['published']) . ' published',
            $request->ip(),
        );

        Response::ok($result);
    }

    public function log(Request $request): void
    {
        unset($request);
        $limit = (int) ($this->request->intQuery('limit', 50, 1, 200));
        Response::ok($this->scheduler->recent($limit));
    }

    /** Sitemap status: URL count, path and last write time. */
    public function sitemap(Request $request): void
    {
        unset($request);

        $builder = new SitemapBuilder();
        Response::ok([
            'path' => $builder->path(),
            'last_updated' => $builder->lastUpdated(),
            'urls' => count($builder->entries()),
            'base_url' => $builder->baseUrl(),
        ]);
    }

    /** Rebuilds sitemap.xml immediately (called after a publish, or by hand). */
    public function rebuildSitemap(Request $request): void
    {
        $builder = new SitemapBuilder();

        try {
            $bytes = $builder->write();
        } catch (Throwable $error) {
            throw ApiException::server('The sitemap could not be written: ' . $error->getMessage());
        }

        Logger::audit($request->admin, 'sitemap.rebuilt', 'sitemap', null, $bytes . ' bytes written', $request->ip());

        Response::ok([
            'path' => $builder->path(),
            'bytes' => $bytes,
            'urls' => count($builder->entries()),
            'last_updated' => $builder->lastUpdated(),
        ]);
    }
}
