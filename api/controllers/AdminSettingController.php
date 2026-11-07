<?php
/**
 * Admin settings, SEO defaults and tracking/verification configuration.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Helpers\Security;
use Shn\Models\SeoModel;
use Shn\Models\SettingModel;

final class AdminSettingController extends Controller
{
    public function __construct(
        Request $request,
        private readonly SettingModel $settings = new SettingModel(),
        private readonly SeoModel $seo = new SeoModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);

        Response::ok([
            'groups' => $this->settings->adminAll(),
            'definitions' => array_map(
                static fn (array $definition): array => [
                    'group' => $definition[0],
                    'type' => $definition[1],
                    'public' => $definition[2],
                ],
                SettingModel::DEFINITIONS,
            ),
        ]);
    }

    public function update(Request $request): void
    {
        $body = $this->body();
        $values = $body['settings'] ?? $body;

        if (!is_array($values)) {
            throw ApiException::unprocessable('Send settings as an object of key/value pairs.', ['settings' => 'Must be an object.']);
        }

        // Never let a client flip visibility or groups — those come from the schema.
        unset($values['is_public'], $values['setting_group'], $values['setting_type']);

        $updated = $this->settings->updateMany($values, $this->adminId());

        Logger::audit(
            $request->admin,
            'settings.updated',
            'settings',
            null,
            'Updated settings: ' . implode(', ', $updated),
            $request->ip(),
        );

        Response::ok([
            'updated' => $updated,
            'groups' => $this->settings->adminAll(),
        ]);
    }

    public function seo(Request $request): void
    {
        unset($request);
        Response::ok($this->seo->current());
    }

    public function updateSeo(Request $request): void
    {
        $this->seo->update($this->body(), $this->adminId());

        Logger::audit($request->admin, 'seo.updated', 'seo_settings', 1, 'Updated SEO defaults', $request->ip());

        Response::ok($this->seo->current());
    }

    /**
     * Previews the snippets that the public site would render, and explains why
     * a snippet is rejected if it is not safe.
     */
    public function integrationPreview(Request $request): void
    {
        $body = $this->body();
        $slot = ($body['slot'] ?? 'header') === 'footer' ? 'footer' : 'header';
        $snippet = (string) ($body['snippet'] ?? '');

        $result = Security::validateSnippet($snippet, $slot);

        Response::ok([
            'slot' => $slot,
            'accepted' => $result['ok'],
            'reason' => $result['reason'],
            'renders' => $result['ok'] ? $result['clean'] : null,
            'current' => $this->settings->publicIntegrations(),
        ]);
    }
}
