<?php
/**
 * Public contact form / support request submission.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Helpers\Security;
use Shn\Helpers\Validator;
use Shn\Models\LeadModel;
use Shn\Services\HoneypotService;

final class PublicLeadController extends Controller
{
    public function __construct(
        Request $request,
        private readonly LeadModel $leads = new LeadModel(),
        private readonly HoneypotService $honeypot = new HoneypotService(),
    ) {
        parent::__construct($request);
    }

    public function store(Request $request): void
    {
        $body = $this->body();

        $this->honeypot->assertHuman($body);

        $data = Validator::validate($body, [
            'name' => 'required|string|min:2|max:160',
            'email' => 'required|email|max:190',
            'phone' => 'nullable|string|max:32',
            'service' => 'nullable|string|max:160',
            'subject' => 'nullable|string|max:200',
            'message' => 'required|string|min:10|max:5000',
            'type' => 'nullable|in:lead,support',
            'consent' => 'nullable|bool',
            'source' => 'nullable|string|max:60',
            'utm_source' => 'nullable|string|max:120',
            'utm_medium' => 'nullable|string|max:120',
            'utm_campaign' => 'nullable|string|max:160',
        ]);

        $lead = $this->leads->create(
            $data,
            Security::fingerprintIp($request->ip()),
            $request->userAgent(),
        );

        Response::created([
            'reference' => $lead['reference'],
            'status' => $lead['status'],
            'message' => 'Thank you — your message has been received. Keep the reference above for your records.',
        ]);
    }
}
