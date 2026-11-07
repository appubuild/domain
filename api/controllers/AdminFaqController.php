<?php
/**
 * Admin CRUD for FAQ groups and questions.
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
use Shn\Models\FaqModel;

final class AdminFaqController extends Controller
{
    public function __construct(
        Request $request,
        private readonly FaqModel $faqs = new FaqModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);
        ['page' => $page, 'per_page' => $perPage] = $this->pagination(50);

        $result = $this->faqs->adminList([
            'group' => $this->filter('group', 40),
            'q' => $this->filter('q', 120),
        ], $page, $perPage);

        Response::paginated($result['items'], $result['meta']);
    }

    public function show(Request $request, string $id): void
    {
        unset($request);
        Response::ok($this->faqs->adminFind($this->id($id, 'FAQ id')));
    }

    public function store(Request $request): void
    {
        $data = $this->validatePayload($request, true);

        $id = $this->faqs->create($data);
        Logger::audit($request->admin, 'faq.created', 'faq', $id, 'Created an FAQ', $request->ip());

        Response::created($this->faqs->adminFind($id));
    }

    public function update(Request $request, string $id): void
    {
        $faqId = $this->id($id, 'FAQ id');
        $this->faqs->adminFind($faqId);

        $data = $this->validatePayload($request, false);
        $this->faqs->update($faqId, $data);

        Logger::audit($request->admin, 'faq.updated', 'faq', $faqId, 'Updated an FAQ', $request->ip());
        Response::ok($this->faqs->adminFind($faqId));
    }

    public function destroy(Request $request, string $id): void
    {
        $faqId = $this->id($id, 'FAQ id');
        $this->faqs->adminFind($faqId);

        $this->faqs->delete($faqId);
        Logger::audit($request->admin, 'faq.deleted', 'faq', $faqId, 'Deleted an FAQ', $request->ip());

        Response::noContent();
    }

    public function groups(Request $request): void
    {
        unset($request);
        Response::ok($this->faqs->adminGroups());
    }

    public function storeGroup(Request $request): void
    {
        $data = Validator::validate($request->body(), [
            'id' => 'required|string|min:2|max:40|regex:/^[a-z0-9-]+$/',
            'name' => 'required|string|min:2|max:120',
        ]);

        try {
            $this->faqs->createGroup($data);
        } catch (PDOException $exception) {
            if ((string) ($exception->errorInfo[0] ?? '') === '23000') {
                throw ApiException::conflict('An FAQ group with that id already exists.');
            }
            throw ApiException::server('The FAQ group could not be saved.');
        }

        Logger::audit($request->admin, 'faq_group.created', 'faq_group', $data['id'], 'Created an FAQ group', $request->ip());
        Response::created($data);
    }

    public function updateGroup(Request $request, string $id): void
    {
        $data = Validator::validate($request->body(), [
            'name' => 'required|string|min:2|max:120',
        ]);

        $this->faqs->updateGroup($id, $data);
        Logger::audit($request->admin, 'faq_group.updated', 'faq_group', $id, 'Updated an FAQ group', $request->ip());

        Response::ok(['id' => $id] + $data);
    }

    public function destroyGroup(Request $request, string $id): void
    {
        $this->faqs->deleteGroup($id);
        Logger::audit($request->admin, 'faq_group.deleted', 'faq_group', $id, 'Deleted an FAQ group', $request->ip());

        Response::noContent();
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $isCreate): array
    {
        $rules = [
            'group_id' => ($isCreate ? 'required' : 'nullable') . '|string|max:40',
            'question' => ($isCreate ? 'required' : 'nullable') . '|string|min:5|max:300',
            'answer' => ($isCreate ? 'required' : 'nullable') . '|string|min:5|max:5000',
            'sort_order' => 'nullable|int|min:0|max:999',
            'visible' => 'nullable|bool',
        ];

        $data = Validator::validate($request->body(), $rules);

        if (isset($data['question'])) {
            $data['question'] = Security::plainText((string) $data['question'], 300);
        }
        if (isset($data['answer'])) {
            $data['answer'] = Security::sanitizeHtml((string) $data['answer']);
        }

        return $data;
    }
}
