import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useAdminSettings } from '@/hooks/queries';
import { Seo } from '@/components/shared/Seo';
import { Button, Card, CardContent } from '@/components/ui/primitives';
import { Input } from '@/components/ui/primitives';
import * as React from 'react';

function StateShell({
  code,
  title,
  description,
  children,
}: {
  code: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="container flex min-h-[70vh] flex-col items-center justify-center py-16 text-center">
      <p className="font-display text-6xl font-bold text-primary/20">{code}</p>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => navigate('/')}>Back to home</Button>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go back
        </Button>
        <Button variant="ghost" onClick={() => navigate('/contact')}>
          Contact support
        </Button>
      </div>
      {children}
    </div>
  );
}

export function NotFoundPage() {
  const navigate = useNavigate();
  const suggestions = [
    ['Marketplace', '/marketplace', 'Read books published with Scriptora.'],
    ['Templates', '/templates', 'Start a book from a designed interior.'],
    ['Features', '/features', 'Writing, design, AI, publishing and selling.'],
    ['FAQ', '/faq', 'Answers about exporting, print and royalties.'],
  ] as const;
  return (
    <>
      <Seo title="Page not found" noIndex />
      <StateShell code="404" title="We could not find that page" description="The link may be old, or the page may have been unpublished by an administrator." />
      <div className="container pb-16">
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          {suggestions.map(([label, href, body]) => (
            <Card key={href} className="cursor-pointer transition-shadow hover:shadow-card" onClick={() => navigate(href)}>
              <CardContent>
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

export function ForbiddenPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <Seo title="Access denied" noIndex />
      <StateShell
        code="403"
        title="You do not have access to this area"
        description={
          user
            ? `Your account${isAdmin ? ' has moderator access' : ''} does not include permission for this screen. If you believe this is a mistake, contact support and we will check the role assignment.`
            : 'This screen requires an account with the right permissions. Sign in with an account that has access, or continue browsing the public site.'
        }
      >
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            Go to dashboard
          </Button>
          {!user && (
            <Button variant="outline" onClick={() => navigate('/login')}>
              Sign in
            </Button>
          )}
        </div>
      </StateShell>
    </>
  );
}

export function ServerErrorPage() {
  const [details, setDetails] = React.useState(false);
  return (
    <>
      <Seo title="Something went wrong" noIndex />
      <StateShell
        code="500"
        title="Something went wrong on our side"
        description="The request failed before it completed. Nothing you were working on has been lost — autosave keeps local drafts safe."
      >
        {details && (
          <pre className="mt-5 max-w-xl overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 text-left text-2xs text-muted-foreground">
            {`Error: render-pipeline-500
at ExportEngine.render (src/lib/exporters/index.ts)
at ExportService.run (src/services/exportService.ts)
at ExportCentre.handleExport (src/pages/dashboard/ExportCentre.tsx)

Suggested actions:
- Retry the operation from the export history
- Check preflight for errors that block rendering
- Report the reference above to support@scriptora.app`}
          </pre>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={() => setDetails((value) => !value)}>
            {details ? 'Hide technical details' : 'Show technical details'}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
        </div>
      </StateShell>
    </>
  );
}

export function MaintenancePage() {
  const { data: settings } = useAdminSettings();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const navigate = useNavigate();

  const message =
    settings?.general.maintenanceMessage ??
    'We are performing scheduled maintenance on the publishing pipeline. Writing is unaffected — your drafts are safe.';

  return (
    <>
      <Seo title="Scheduled maintenance" noIndex />
      <StateShell
        code="503"
        title="Scriptora is briefly offline for maintenance"
        description={message}
      >
        <div className="mt-6 w-full max-w-sm text-left">
          <label htmlFor="maintenance-code" className="text-xs font-medium text-muted-foreground">
            Have an access code? Staff and early-access accounts can continue working.
          </label>
          <div className="mt-1.5 flex gap-2">
            <Input
              id="maintenance-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setError(null);
              }}
              placeholder="e.g. SCRIPTORA-STAFF"
            />
            <Button
              onClick={() => {
                if (code.trim().toUpperCase() === 'SCRIPTORA-STAFF') {
                  navigate('/login?next=/dashboard');
                } else {
                  setError('That code is not valid. Contact support if you believe you should have access.');
                }
              }}
            >
              Continue
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          <p className="mt-3 text-2xs text-muted-foreground">
            Maintenance is configured in the admin panel under Settings → Platform status, and announcements appear here immediately.
          </p>
        </div>
      </StateShell>
    </>
  );
}
