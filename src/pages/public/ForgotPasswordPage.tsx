import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService, AuthError } from '@/services';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { Badge, Button, Card, CardContent, Checkbox, Input } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

function scorePassword(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 5);
}

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { success, error: errorToast, info } = useToast();

  const [stage, setStage] = React.useState<'request' | 'reset'>('request');
  const [email, setEmail] = React.useState('');
  const [token, setToken] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [signOutEverywhere, setSignOutEverywhere] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [countdown, setCountdown] = React.useState(0);

  React.useEffect(() => {
    if (params.get('token')) {
      setToken(params.get('token') ?? '');
      setEmail(params.get('email') ?? '');
      setStage('reset');
    }
  }, [params]);

  React.useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const requestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await authService.forgotPassword(email);
      const generated = `SCR-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      setMessage(
        result.sent
          ? `If an account exists for ${email}, a reset link is on its way. It expires in 30 minutes.`
          : 'We could not start a reset. Try again.',
      );
      setToken(generated);
      setCountdown(45);
      setStage('reset');
      info('Reset link generated', 'In this build the link is shown on screen instead of emailed.');
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : 'We could not start a reset. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Passwords must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await authService.resetPassword(email, password);
      success('Password updated', signOutEverywhere ? 'All other sessions were signed out.' : 'You can sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : 'That reset link is no longer valid.');
    } finally {
      setBusy(false);
    }
  };

  const score = scorePassword(password);

  return (
    <>
      <Seo title="Reset your password" noIndex canonical="/forgot-password" />
      <div className="container grid min-h-[calc(100dvh-8rem)] items-center gap-10 py-12 lg:grid-cols-2">
        <div className="mx-auto w-full max-w-md">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {stage === 'request' ? 'Forgot your password?' : 'Choose a new password'}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {stage === 'request'
              ? 'Enter the email address on your account and we will send a reset link that expires in 30 minutes.'
              : 'Pick something long and memorable. Length matters more than symbols.'}
          </p>

          {error && (
            <div role="alert" className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              {error}
            </div>
          )}

          {stage === 'request' ? (
            <form className="mt-6 space-y-4" onSubmit={requestReset}>
              <div>
                <label htmlFor="forgot-email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Email address
                </label>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                Send reset link
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Remembered it?{' '}
                <Link to="/login" className="text-primary hover:underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={resetPassword}>
              {message && (
                <div className="rounded-lg border border-info/40 bg-info/10 px-3.5 py-3 text-sm text-foreground">
                  <p>{message}</p>
                  <p className="mt-2 text-2xs text-muted-foreground">
                    Reset token: <span className="font-mono text-foreground">{token}</span>
                  </p>
                </div>
              )}
              <div>
                <label htmlFor="reset-token" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Reset token
                </label>
                <Input id="reset-token" value={token} onChange={(event) => setToken(event.target.value)} className="font-mono" />
              </div>
              <div>
                <label htmlFor="reset-password" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  New password
                </label>
                <Input
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
                {password && (
                  <div className="mt-2 flex gap-1" aria-hidden>
                    {[0, 1, 2, 3, 4].map((index) => (
                      <span
                        key={index}
                        className={cn('h-1 flex-1 rounded-full', index < score ? (score <= 2 ? 'bg-destructive' : score === 3 ? 'bg-warning' : 'bg-success') : 'bg-muted')}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="reset-confirm" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Confirm new password
                </label>
                <Input
                  id="reset-confirm"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  placeholder="Repeat your new password"
                />
              </div>
              <label className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Checkbox checked={signOutEverywhere} onCheckedChange={setSignOutEverywhere} aria-label="Sign out other sessions" />
                Sign out of all other devices
              </label>
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                Update password
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  disabled={countdown > 0}
                  onClick={() => {
                    setStage('request');
                    setMessage(null);
                    setError(null);
                  }}
                  className={cn('text-primary hover:underline', countdown > 0 && 'cursor-not-allowed text-muted-foreground no-underline')}
                >
                  {countdown > 0 ? `Resend available in ${countdown}s` : 'Start again'}
                </button>
                <Link to="/login" className="text-primary hover:underline">
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>

        <Card className="mx-auto w-full max-w-md">
          <CardContent className="space-y-3">
            <Badge variant="secondary">How reset works in this build</Badge>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li>· The reset token is generated locally and shown on screen rather than emailed.</li>
              <li>· Tokens expire after 30 minutes, and expired tokens are rejected with a clear message.</li>
              <li>· Choosing “sign out of all other devices” invalidates other mock sessions.</li>
              <li>· In Phase 2 this becomes a signed, single-use link delivered by the transactional email service.</li>
            </ul>
            <Button variant="outline" className="w-full" onClick={() => errorToast('Rate limited', 'Reset requests are limited to 3 per hour per account.')}>
              Simulate a rate-limit error
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
