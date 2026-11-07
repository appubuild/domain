<?php
/**
 * Public service directory.
 *
 * Numbers appear only inside a selected service (never on the index), and only
 * when they are active and mapped to that service.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Models\CategoryModel;
use Shn\Models\NicheModel;
use Shn\Models\PhoneNumberModel;
use Shn\Models\ServiceModel;

final class PublicServiceController extends Controller
{
    public function __construct(
        Request $request,
        private readonly ServiceModel $services = new ServiceModel(),
        private readonly CategoryModel $categories = new CategoryModel(),
        private readonly NicheModel $niches = new NicheModel(),
        private readonly PhoneNumberModel $numbers = new PhoneNumberModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        // ?full=1 returns complete content (intro, options, FAQs, numbers) for
        // every published service so the site can hydrate in one request.
        $full = in_array(strtolower((string) $request->queryParam('full', '')), ['1', 'true', 'yes'], true);

        Response::ok([
            'services' => $full ? $this->services->publishedDetails() : $this->services->publishedList(),
            'categories' => $this->services->publishedCategories(),
        ], $this->meta());
    }

    public function show(Request $request, string $slug): void
    {
        unset($request);

        $service = $this->services->publishedDetail($slug);
        if ($service === null) {
            throw ApiException::notFound('That service is not published.');
        }

        Response::ok($service, $this->meta());
    }

    public function numbers(Request $request, string $slug): void
    {
        unset($request);

        $service = $this->services->publishedDetail($slug);
        if ($service === null) {
            throw ApiException::notFound('That service is not published.');
        }

        Response::ok([
            'service' => ['id' => $service['id'], 'slug' => $service['slug'], 'name' => $service['name']],
            'phone_groups' => $service['phone_groups'],
            'has_numbers' => $service['phone_groups'] !== [],
        ], $this->meta());
    }

    public function categories(Request $request): void
    {
        unset($request);
        Response::ok($this->services->publishedCategories(), $this->meta());
    }

    public function niches(Request $request): void
    {
        unset($request);
        Response::ok($this->niches->publicList(), $this->meta());
    }

    /**
     * Group index for the service picker. Numbers are deliberately omitted —
     * a number is only exposed once a service has been selected.
     */
    public function phoneGroups(Request $request): void
    {
        unset($request);
        Response::ok($this->numbers->publicGroupIndex(), $this->meta());
    }

    public function allCategories(Request $request): void
    {
        unset($request);
        Response::ok($this->categories->all(), $this->meta());
    }

    /** @return array<string,mixed> */
    private function meta(): array
    {
        return [
            'source' => 'database',
            'generated_at' => gmdate('c'),
        ];
    }
}
