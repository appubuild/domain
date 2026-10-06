import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { AuthError, subscriptionService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { Badge, Button, Card, CardContent, Checkbox, Input, Select } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';

const ROLES = [
  { id: 'author', label: 'Author', description: 'Fiction, non-fiction, memoir or poetry.' },
  { id: 'illustrator', label: 'Illustrator', description: 'Picture books, comics and illustrated guides.' },
  { id: 'publisher', label: 'Small press or studio', description: 'Publishing multiple authors and titles.' },
  { id: 'other', label: 'Something else', description: 'Journals, workbooks, courses or corporate books.' },
] as const;

function passwordScore(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 5);
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { register, isAuthenticated } = useAuth();
  const { success, error: errorToast } = useToast();

  const [step, setStep] = React.useState(1);
  const [form, setForm] = React.useState({ name: '', email: '', password: '', confirm: '', username: '', role: 'author' as (typeof ROLES)[number]['id'] });
  const [accept, setAccept] = React.useState(false);
  const [marketing, setMarketing] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const plans = subscriptionService.plans();
  const selectedPlan = params.get('plan');

  React.useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  const score = passwordScore(form.password);
  const strengthLabels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];

  const validateStepOne = () => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Enter your name as you would like it to appear on your book.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address.';
    if (form.password.length < 8) next.password = 'Passwords must be at least 8 characters.';
    if (form.confirm !== form.password) next.confirm = 'Those passwords do not match.';
    if (!accept) next.accept = 'Please accept the terms and privacy policy.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (step === 1) {
      if (validateStepOne()) setStep(2);
      return;
    }
    setBusy(true);
    try {
      await register({ name: form.name, email: form.email, password: form.password, username: form.username || undefined, role: form.role });
      success('Account created', 'Two quick questions and your workspace is ready.');
      navigate('/onboarding', { replace: true });
    } catch (caught) {
      if (caught instanceof AuthError) setFormError(caught.message);
      else setFormError('We could not create that account. Please try again.');
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Seo
        title="Create your free account"
        description="Create a free Scriptora account to write, design and export your first three books. No card required."
        canonical="/register"
        noIndex
      />
      <div className="container grid gap-10 py-12 lg:grid-cols-[1.1fr_1fr]">
        <div className="mx-auto w-full max-w-md">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Create your free account</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Already have one?{' '}
            <Link to="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>

          <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
            {['Your details', 'Your project'].map((label, index) => (
              <React.Fragment key={label}>
                {index > 0 && <span className="h-px flex-1 bg-border" aria-hidden />}
                <span className={cn('flex items-center gap-2', step === index + 1 ? 'text-foreground' : '')}>
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-2xs font-semibold',
                      step > index ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {index + 1}
                  </span>
                  {label}
                </span>
              </React.Fragment>
            ))}
          </div>

          {formError && (
            <div role="alert" className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              {formError}
            </div>
          )}

          <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
            {step === 1 ? (
              <>
                <div>
                  <label htmlFor="register-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Full name
                  </label>
                  <Input
                    id="register-name"
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    aria-invalid={Boolean(errors.name)}
                    placeholder="Maya Chen"
                    autoComplete="name"
                  />
                  {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
                </div>
                <div>
                  <label htmlFor="register-email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Email address
                  </label>
                  <Input
                    id="register-email"
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                    aria-invalid={Boolean(errors.email)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                  {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
                </div>
                <div>
                  <label htmlFor="register-username" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Author handle <span className="font-normal">(optional)</span>
                  </label>
                  <Input
                    id="register-username"
                    value={form.username}
                    onChange={(event) => setForm((current) => ({ ...current, username: event.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase() }))}
                    placeholder="mayachen"
                    autoComplete="username"
                  />
                  <p className="mt-1 text-2xs text-muted-foreground">scriptora.app/authors/{form.username || 'your-handle'}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="register-password" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Password
                    </label>
                    <Input
                      id="register-password"
                      type="password"
                      value={form.password}
                      onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                      aria-invalid={Boolean(errors.password)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                    />
                    {form.password && (
                      <div className="mt-2">
                        <div className="flex gap-1" aria-hidden>
                          {[0, 1, 2, 3, 4].map((index) => (
                            <span
                              key={index}
                              className={cn(
                                'h-1 flex-1 rounded-full',
                                index < score ? (score <= 2 ? 'bg-destructive' : score === 3 ? 'bg-warning' : 'bg-success') : 'bg-muted',
                              )}
                            />
                          ))}
                        </div>
                        <p className="mt-1 text-2xs text-muted-foreground">Password strength: {strengthLabels[score]}</p>
                      </div>
                    )}
                    {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password}</p>}
                  </div>
                  <div>
                    <label htmlFor="register-confirm" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Confirm password
                    </label>
                    <Input
                      id="register-confirm"
                      type="password"
                      value={form.confirm}
                      onChange={(event) => setForm((current) => ({ ...current, confirm: event.target.value }))}
                      aria-invalid={Boolean(errors.confirm)}
                      placeholder="Repeat your password"
                      autoComplete="new-password"
                    />
                    {errors.confirm && <p className="mt-1 text-xs text-destructive">{errors.confirm}</p>}
                  </div>
                </div>
                <div className="space-y-3 border-t border-border pt-4">
                  <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Checkbox checked={accept} onCheckedChange={setAccept} aria-label="Accept terms" className="mt-0.5" />
                    <span>
                      I agree to the{' '}
                      <Link to="/terms" className="text-primary hover:underline">
                        terms of service
                      </Link>{' '}
                      and{' '}
                      <Link to="/privacy" className="text-primary hover:underline">
                        privacy policy
                      </Link>
                      .
                    </span>
                  </label>
                  {errors.accept && <p className="text-xs text-destructive">{errors.accept}</p>}
                  <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Checkbox checked={marketing} onCheckedChange={setMarketing} aria-label="Receive product email" className="mt-0.5" />
                    Send me occasional writing and publishing guides. About one email a month.
                  </label>
                </div>
                <Button type="submit" size="lg" className="w-full">
                  Continue
                </Button>
              </>
            ) : (
              <>
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">What are you making?</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ROLES.map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => setForm((current) => ({ ...current, role: role.id }))}
                        aria-pressed={form.role === role.id}
                        className={cn(
                          'rounded-lg border px-3 py-2.5 text-left transition-colors',
                          form.role === role.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                        )}
                      >
                        <span className="block text-sm font-medium text-foreground">{role.label}</span>
                        <span className="mt-0.5 block text-2xs text-muted-foreground">{role.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="register-plan" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Starting plan
                  </label>
                  <Select
                    id="register-plan"
                    defaultValue={selectedPlan ?? 'free'}
                    onChange={() => undefined}
                    aria-describedby="register-plan-help"
                  >
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.slug}>
                        {plan.name} — {plan.priceMonthly === 0 ? 'Free forever' : `${formatCurrency(plan.priceMonthly)}/month`}
                      </option>
                    ))}
                  </Select>
                  <p id="register-plan-help" className="mt-1 text-2xs text-muted-foreground">
                    You can change or cancel this at any time. The free plan is not a trial.
                  </p>
                </div>
                <ul className="space-y-2 rounded-lg border border-border bg-muted/40 p-3.5 text-sm text-muted-foreground">
                  {['Three book projects', 'Full writing mode with autosave', 'PDF and plain text export', '20 AI credits to try the assistant'].map((entry) => (
                    <li key={entry} className="flex gap-2.5">
                      <span className="text-xs text-primary" aria-hidden>
                        ✓
                      </span>
                      {entry}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" loading={busy}>
                    Create account
                  </Button>
                </div>
              </>
            )}
          </form>

          <p className="mt-4 text-2xs text-muted-foreground">
            Accounts in this build are stored locally in your browser. No email is ever sent and no payment is taken.
          </p>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent>
              <Badge variant="secondary">What you get immediately</Badge>
              <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
                {[
                  'A real writing environment with chapters, targets and version history',
                  'Nine print trim presets and a page designer with real geometry',
                  'Seven export formats from a single book document model',
                  'A preflight checker that tells you what a printer would reject',
                  'A public author page and marketplace listing when you publish',
                ].map((entry) => (
                  <li key={entry} className="flex gap-2.5">
                    <span className="mt-0.5 text-xs text-primary" aria-hidden>
                      ✓
                    </span>
                    {entry}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm font-semibold text-foreground">Prefer to look around first?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The demo account has books in every state, marketplace sales, reviews and an admin panel to explore.
              </p>
              <Button variant="outline" className="mt-3 w-full" onClick={() => navigate('/login?demo=1')}>
                Open the demo account
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm font-semibold text-foreground">Trust and data</p>
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                <li>· Your manuscripts are never used to train models.</li>
                <li>· Export everything to DOCX, EPUB, PDF or plain text at any time.</li>
                <li>· Delete your workspace in two clicks from Settings → Data.</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  <Link to="/privacy">Privacy</Link>
                </Badge>
                <Badge variant="outline">
                  <Link to="/terms">Terms</Link>
                </Badge>
                <Badge variant="outline">
                  <Link to="/refund-policy">Refunds</Link>
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
