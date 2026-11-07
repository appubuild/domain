<?php
/**
 * Lightweight bot filtering for the public contact form.
 *
 * · a hidden "website" field that people never see but simple bots fill in
 * · an optional form-render timestamp; submissions faster than two seconds are
 *   treated as automated
 *
 * Failures return the same generic validation error so bots get no hints.
 */

declare(strict_types=1);

namespace Shn\Services;

use Shn\Helpers\ApiException;

final class HoneypotService
{
    public const MIN_SECONDS = 2;

    /** @param array<string,mixed> $body */
    public function assertHuman(array $body, int $now = null): void
    {
        $now ??= time();

        $trap = trim((string) ($body['website'] ?? ''));
        if ($trap !== '') {
            $this->reject();
        }

        if (array_key_exists('form_started_at', $body) && $body['form_started_at'] !== null && $body['form_started_at'] !== '') {
            $started = $body['form_started_at'];
            if (is_numeric($started)) {
                $startedAt = (int) $started;
                // Accept both seconds and milliseconds.
                if ($startedAt > 100000000000) {
                    $startedAt = (int) floor($startedAt / 1000);
                }
                if ($startedAt > $now + 60) {
                    $this->reject();
                }
                if ($now - $startedAt < self::MIN_SECONDS) {
                    $this->reject();
                }
            }
        }
    }

    private function reject(): void
    {
        throw ApiException::unprocessable(
            'We could not verify this submission. Please reload the page and try again.',
            ['form' => 'Please try again.'],
        );
    }
}
