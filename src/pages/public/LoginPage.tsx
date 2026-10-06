import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { authService, AuthError } from '@/services';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { Badge, Button, Card, CardContent, Checkbox, Input, Separator } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login, loginWithProvider, isAuthenticated } = useAuth();
  const { success, error: errorToast } = useToast();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [providerBusy, setProviderBusy] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const demoAccounts = React.useMemo(() => authService.demoAccounts(), []);

  const next = params.get('next') ?? '/dashboard';

  React.useEffect(() => {
    if (isAuthenticated) navigate(next, { replace: true });
  }, [isAuthenticated, navigate, next]);

  React.useEffect(() => {
    if (params.get('demo') === '1') {
      setEmail('demo@scriptora.app');
      setPassword('password123');
    }
    if (params.get('expired') === '1') {
      setFormError('Your session expired. Sign in again to continue where you left off.');
    }
  }, [params]);

  const validate = () => {
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'That does not look like a valid email address.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const result = await login(email, password, remember);
      success(`Welcome back, ${result.user.name.split(' ')[0]}`, 'Your workspace is ready.');
      navigate(next, { replace: true });
    } catch (caught) {
      if (caught instanceof AuthError) {
        if (caught.code === 'invalid-credentials') setFormError(caught.message);
        else setFormError(caught.message);
      } else {
        setFormError('Sign in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const quickFill = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('password123');
    setFieldErrors({});
    setFormError(null);
  };

  return (
    <>
      <Seo title="Sign in" description="Sign in to your Scriptora workspace to keep writing, designing and publishing." canonical="/login" noIndex />
      <div className="container grid min-h-[calc(100dvh-8rem)] items-center gap-10 py-12 lg:grid-cols-2">
        <div className="order-2 lg:order-1">
          <div className="mx-auto max-w-md">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Sign in to Scriptora</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              New here?{' '}
              <Link to="/register" className="text-primary hover:underline">
                Create a free account
              </Link>
            </p>

            {formError && (
              <div role="alert" className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
                {formError}
              </div>
            )}

            <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
              <div>
                <label htmlFor="login-email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Email address
                </label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setFieldErrors((current) => ({ ...current, email: undefined }));
                  }}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                  placeholder="you@example.com"
                />
                {fieldErrors.email && (
                  <p id="login-email-error" className="mt-1 text-xs text-destructive">
                    {fieldErrors.email}
                  </p>
                )}
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="login-password" className="text-xs font-medium text-muted-foreground">
                    Password
                  </label>
                  <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setFieldErrors((current) => ({ ...current, password: undefined }));
                    }}
                    aria-invalid={Boolean(fieldErrors.password)}
                    placeholder="••••••••"
                    className="pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-2xs text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {fieldErrors.password && <p className="mt-1 text-xs text-destructive">{fieldErrors.password}</p>}
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={remember} onCheckedChange={setRemember} aria-label="Keep me signed in" />
                Keep me signed in on this device
              </label>
              <Button type="submit" className="w-full" size="lg" loading={busy}>
                Sign in
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-2xs uppercase tracking-wide text-muted-foreground">or continue with</span>
              <Separator className="flex-1" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['google', 'Google'],
                ['apple', 'Apple'],
                ['github', 'GitHub'],
              ] as const).map(([provider, label]) => (
                <Button
                  key={provider}
                  type="button"
                  variant="outline"
                  loading={providerBusy === provider}
                  onClick={async () => {
                    setProviderBusy(provider);
                    try {
                      await loginWithProvider(provider);
                      success(`Signed in with ${label}`);
                      navigate('/dashboard', { replace: true });
                    } catch {
                      errorToast(`${label} sign-in failed`, 'Use email and password to continue.');
                    } finally {
                      setProviderBusy(null);
                    }
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-2xs text-muted-foreground">
              Provider sign-in is simulated in this build and signs you into the matching demo account.
            </p>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <Card className="mx-auto max-w-md">
            <CardContent className="space-y-4">
              <div>
                <Badge variant="secondary">Demo accounts</Badge>
                <p className="mt-2 text-sm text-muted-foreground">
                  This build ships with three populated accounts. Pick one to explore the author workspace, the moderation queue or the full admin panel.
                </p>
              </div>
              <ul className="space-y-2">
                {demoAccounts.map((account) => (
                  <li key={account.id}>
                    <button
                      type="button"
                      onClick={() => quickFill(account.email)}
                      className={cn(
                        'w-full rounded-lg border px-3.5 py-2.5 text-left transition-colors',
                        email === account.email ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{account.name}</span>
                        <Badge variant="outline">{account.role}</Badge>
                      </span>
                      <span className="mt-0.5 block font-mono text-2xs text-muted-foreground">{account.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-2xs text-muted-foreground">
                Password for every demo account: <span className="font-mono text-foreground">password123</span>
              </p>
              <Button variant="outline" className="w-full" onClick={() => navigate('/login?demo=1')}>
                Fill the author demo account
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
