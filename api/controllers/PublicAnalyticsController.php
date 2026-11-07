<?php
/**
 * First-party event collection endpoint used by the public site.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Models\AnalyticsModel;
use Shn\Services\AnalyticsIngestService;

final class PublicAnalyticsController extends Controller
{
    public function __construct(
        Request $request,
        private readonly AnalyticsModel $analytics = new AnalyticsModel(),
        private readonly AnalyticsIngestService $ingest = new AnalyticsIngestService(),
    ) {
        parent::__construct($request);
    }

    public function store(Request $request): void
    {
        $body = $this->body();

        $events = $body['events'] ?? null;
        if (is_array($events)) {
            $list = array_values($events);
        } else {
            $list = [$body];
        }

        if ($list === []) {
            throw ApiException::unprocessable('No events were supplied.');
        }

        $normalised = $this->ingest->normalise($list);

        foreach ($normalised as $event) {
            $this->analytics->recordEvent($event);
        }

        Response::created([
            'accepted' => count($normalised),
            'rejected' => count($list) - count($normalised),
        ]);
    }
}
