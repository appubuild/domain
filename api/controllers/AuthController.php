<?php
/**
 * Admin authentication: login, logout, session, profile, password, resets.
 *
 * Cookie strategy
 *  · session token → HttpOnly, Secure, SameSite=Lax cookie; only its hash is stored
 *  · CSRF token    → readable cookie + X-CSRF-Token header (double submit)
 *  · Bearer tokens → supported for API clients; no CSRF needed
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Config;
use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Helpers\Security;
use Shn\Helpers\Validator;
use Shn\Models\AdminModel;

final class AuthController extends Controller
{
    private const PERMISSIONS = [
        'owner' => ['content.read', 'content.write', 'content.publish', 'settings.read', 'settings.write', 'leads.read', 'leads.write', 'analytics.read', 'media.write', 'team.manage'],
        'admin' => ['content.read', 'content.write', 'content.publish', 'settings.read', 'settings.write', 'leads.read', 'leads.write', 'analytics.read', 'media.write'],
        'editor' => ['content.read', 'content.write', 'content.publish', 'settings.read', 'leads.read', 'analytics.read', 'media.write'],
        'viewer' => ['content.read', 'settings.read', 'leads.read', 'analytics.read'],
    ];

    public function __construct(
        Request $request,
        private readonly AdminModel $admins = new AdminModel(),
    ) {
        parent::__construct($request);
    }

    public function login(Request $request): void
    {
        $body = Validator::validate($this->body(), [
            'email' => 'required|email|max:190',
            'password' => 'required|string|min:1|max:200',
            'remember' => 'nullable|bool',
        ]);

        $email = mb_strtolower(trim((string) $body['email']));
        $password = (string) $body['password'];

        $admin = $this->admins->findByEmail($email);

        // Identical response for unknown emails and wrong passwords.
        if ($admin === null) {
            usleep(300000);
            throw ApiException::unauthorized('Email or password is incorrect.');
        }

        if ($admin['status'] !== 'active') {
            throw ApiException::forbidden('This account is suspended. Contact the site owner.');
        }

        if ($this->admins->isLocked($admin)) {
            $retryAfter = max(1, strtotime((string) $admin['locked_until']) - time());
            throw ApiException::tooManyRequests(
                'Too many failed attempts. Try again in ' . $retryAfter . ' seconds.',
                $retryAfter,
            );
        }

        if (!Security::verifyPassword($password, (string) $admin['password_hash'])) {
            $this->admins->registerFailedAttempt((int) $admin['id']);
            Logger::audit(null, 'auth.login_failed', 'admin', (int) $admin['id'], 'Failed sign-in attempt', $request->ip());
            usleep(300000);
            throw ApiException::unauthorized('Email or password is incorrect.');
        }

        if (Security::needsRehash((string) $admin['password_hash'])) {
            $this->admins->updateAdmin((int) $admin['id'], ['password' => $password]);
        }

        $remember = !empty($body['remember']);
        $session = $this->admins->createSession((int) $admin['id'], $request->ip(), $request->userAgent(), $remember);

        $this->admins->recordSuccessfulLogin((int) $admin['id'], $request->ip());
        $this->admins->purgeExpiredSessions();

        $this->setCookie(Config::string('security.session_cookie', 'shn_admin_session'), $session['token'], $session['expires_at'], true);
        $this->setCookie(Config::string('security.csrf_cookie', 'shn_csrf'), $session['csrf_token'], $session['expires_at'], false);

        Logger::audit(['id' => (int) $admin['id']], 'auth.login', 'admin', (int) $admin['id'], 'Signed in', $request->ip());

        Response::ok([
            'admin' => $this->presentAdmin($admin),
            'csrf_token' => $session['csrf_token'],
            'expires_at' => $session['expires_at'],
            'permissions' => self::PERMISSIONS[(string) $admin['role']] ?? self::PERMISSIONS['viewer'],
        ]);
    }

    public function logout(Request $request): void
    {
        $sessionId = (string) ($request->session['id'] ?? '');
        if ($sessionId !== '') {
            $this->admins->revokeSession($sessionId);
        }

        $this->clearCookie(Config::string('security.session_cookie', 'shn_admin_session'));
        $this->clearCookie(Config::string('security.csrf_cookie', 'shn_csrf'));

        Logger::audit($request->admin, 'auth.logout', 'admin', $this->adminId(), 'Signed out', $request->ip());

        Response::ok(['message' => 'Signed out.']);
    }

    public function session(Request $request): void
    {
        $admin = $this->admin();

        Response::ok([
            'admin' => [
                'id' => (int) $admin['id'],
                'name' => $admin['name'],
                'email' => $admin['email'],
                'role' => $admin['role'],
            ],
            'permissions' => self::PERMISSIONS[(string) $admin['role']] ?? self::PERMISSIONS['viewer'],
            'session' => [
                'id' => $request->session['id'] ?? null,
                'expires_at' => $this->sessionExpiry(),
                'via' => $request->session['via'] ?? 'cookie',
            ],
            'csrf_token' => $request->cookie(Config::string('security.csrf_cookie', 'shn_csrf')),
        ]);
    }

    public function updateProfile(Request $request): void
    {
        $data = Validator::validate($this->body(), [
            'name' => 'required|string|min:2|max:160',
            'email' => 'required|email|max:190',
        ]);

        $this->admins->updateProfile((int) $this->admin()['id'], $data);

        Logger::audit($request->admin, 'auth.profile_updated', 'admin', $this->adminId(), 'Updated own profile', $request->ip());

        $updated = $this->admins->findActive((int) $this->admin()['id']);
        Response::ok($updated);
    }

    public function changePassword(Request $request): void
    {
        $body = Validator::validate($this->body(), [
            'current_password' => 'required|string|max:200',
            'password' => 'required|string|min:8|max:200',
            'password_confirmation' => 'required|string|max:200',
        ]);

        if ($body['password'] !== $body['password_confirmation']) {
            throw ApiException::unprocessable('The new passwords do not match.', ['password_confirmation' => 'Passwords do not match.']);
        }

        $this->admins->changePassword(
            (int) $this->admin()['id'],
            (string) $body['current_password'],
            (string) $body['password'],
            (string) ($request->session['id'] ?? '') ?: null,
        );

        Logger::audit($request->admin, 'auth.password_changed', 'admin', $this->adminId(), 'Changed own password', $request->ip());

        Response::ok(['message' => 'Password updated. Other devices have been signed out.']);
    }

    public function sessions(Request $request): void
    {
        Response::ok($this->admins->sessionsFor((int) $this->admin()['id'], (string) ($request->session['id'] ?? '')));
    }

    public function revokeSession(Request $request, string $id): void
    {
        $this->admins->revokeSession($id);
        Logger::audit($request->admin, 'auth.session_revoked', 'admin_session', $id, 'Revoked a session', $request->ip());
        Response::noContent();
    }

    /**
     * Always returns the same message so accounts cannot be enumerated.
     * The token is emailed by the host's mailer in production; when APP_DEBUG
     * is on it is also written to the log for setup/testing.
     */
    public function forgotPassword(Request $request): void
    {
        $body = Validator::validate($this->body(), ['email' => 'required|email|max:190']);

        $reset = $this->admins->createPasswordReset((string) $body['email']);

        if ($reset !== null) {
            $link = rtrim(Config::string('site.url', ''), '/') . '/admin/reset-password?token=' . $reset['token'];
            error_log('[auth] password reset requested for ' . $reset['email'] . ' → ' . $link);
            Logger::audit(null, 'auth.reset_requested', 'admin', null, 'Password reset requested', $request->ip());

            if (Config::bool('app.debug')) {
                Response::ok([
                    'message' => 'If that email is registered, a reset link has been sent.',
                    'reset_token' => $reset['token'],
                    'expires_at' => $reset['expires_at'],
                ]);
                return;
            }
        }

        Response::ok(['message' => 'If that email is registered, a reset link has been sent.']);
    }

    public function resetPassword(Request $request): void
    {
        $body = Validator::validate($this->body(), [
            'token' => 'required|string|min:32|max:128',
            'password' => 'required|string|min:8|max:200',
            'password_confirmation' => 'required|string|max:200',
        ]);

        if ($body['password'] !== $body['password_confirmation']) {
            throw ApiException::unprocessable('The passwords do not match.', ['password_confirmation' => 'Passwords do not match.']);
        }

        $adminId = $this->admins->consumePasswordReset((string) $body['token'], (string) $body['password']);

        Logger::audit(null, 'auth.password_reset', 'admin', $adminId, 'Password reset completed', $request->ip());

        Response::ok(['message' => 'Password updated. You can sign in now.']);
    }

    /* ---------------------------- helpers ---------------------------- */

    /** @param array<string,mixed> $admin
     *  @return array<string,mixed> */
    private function presentAdmin(array $admin): array
    {
        return [
            'id' => (int) $admin['id'],
            'name' => $admin['name'],
            'email' => $admin['email'],
            'role' => $admin['role'],
            'last_login_at' => $admin['last_login_at'] ?? null,
        ];
    }

    private function sessionExpiry(): ?string
    {
        $admin = $this->request->admin;
        if (!is_array($admin)) {
            return null;
        }
        return $this->request->session['expires_at'] ?? null;
    }

    private function setCookie(string $name, string $value, string $expiresAt, bool $httpOnly): void
    {
        if (headers_sent()) {
            return;
        }

        $options = [
            'expires' => strtotime($expiresAt) ?: time() + 3600,
            'path' => '/',
            'secure' => Config::bool('security.cookie_secure', true),
            'httponly' => $httpOnly,
            'samesite' => 'Lax',
        ];

        $domain = Config::string('security.cookie_domain', '');
        if ($domain !== '') {
            $options['domain'] = $domain;
        }

        setcookie($name, $value, $options);
    }

    private function clearCookie(string $name): void
    {
        if (headers_sent()) {
            return;
        }
        $options = [
            'expires' => time() - 3600,
            'path' => '/',
            'secure' => Config::bool('security.cookie_secure', true),
            'httponly' => true,
            'samesite' => 'Lax',
        ];
        $domain = Config::string('security.cookie_domain', '');
        if ($domain !== '') {
            $options['domain'] = $domain;
        }
        setcookie($name, '', $options);
    }
}
