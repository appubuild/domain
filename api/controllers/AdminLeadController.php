<?php
/**
 * Admin lead inbox.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Helpers\Validator;
use Shn\Models\LeadModel;

final class AdminLeadController extends Controller
{
    public function __construct(
        Request $request,
        private readonly LeadModel $leads = new LeadModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);
        ['page' => $page, 'per_page' => $perPage] = $this->pagination(25);

        $result = $this->leads->adminList([
            'status' => $this->filter('status', 20),
            'type' => $this->filter('type', 20),
            'q' => $this->filter('q', 120),
            'from' => $this->filter('from', 10),
            'to' => $this->filter('to', 10),
            'include_deleted' => $this->boolFilter('include_deleted'),
        ], $page, $perPage);

        Response::paginated($result['items'], $result['meta']);
    }

    public function show(Request $request, string $id): void
    {
        unset($request);
        Response::ok($this->leads->adminFind($this->id($id, 'lead id')));
    }

    public function update(Request $request, string $id): void
    {
        $leadId = $this->id($id, 'lead id');
        $this->leads->adminFind($leadId);

        $data = Validator::validate($request->body(), [
            'status' => 'nullable|in:new,contacted,qualified,closed',
            'priority' => 'nullable|in:low,normal,high',
            'assigned_to' => 'nullable|int',
            'subject' => 'nullable|string|max:200',
        ]);

        $this->leads->update($leadId, $data);
        Logger::audit($request->admin, 'lead.updated', 'lead', $leadId, 'Updated a lead', $request->ip());

        Response::ok($this->leads->adminFind($leadId));
    }

    public function destroy(Request $request, string $id): void
    {
        $leadId = $this->id($id, 'lead id');
        $this->leads->adminFind($leadId);

        $this->leads->softDelete($leadId);
        Logger::audit($request->admin, 'lead.deleted', 'lead', $leadId, 'Soft-deleted a lead', $request->ip());

        Response::noContent();
    }

    public function stats(Request $request): void
    {
        unset($request);
        Response::ok(['status_counts' => $this->leads->statusCounts()]);
    }
}
