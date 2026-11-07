<?php
/**
 * Admin dashboard aggregate endpoint.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Models\DashboardModel;

final class AdminDashboardController extends Controller
{
    public function __construct(
        Request $request,
        private readonly DashboardModel $dashboard = new DashboardModel(),
    ) {
        parent::__construct($request);
    }

    public function summary(Request $request): void
    {
        unset($request);
        Response::ok($this->dashboard->summary());
    }
}
