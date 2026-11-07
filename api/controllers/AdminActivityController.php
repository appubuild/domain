<?php
/**
 * Read-only audit trail for the admin panel.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Models\DashboardModel;

final class AdminActivityController extends Controller
{
    public function __construct(
        Request $request,
        private readonly DashboardModel $dashboard = new DashboardModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);
        $limit = $this->request->intQuery('limit', 50, 1, 200);

        Response::ok($this->dashboard->recentActivity($limit));
    }
}
