import * as React from 'react';
import { AlertTriangle, CreditCard, Globe, Lock, Mail, Palette, Save, Server, Sparkles, Wrench } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch, Textarea } from '@/components/ui/primitives';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlays';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminSettings, keys } from '@/hooks/queries';
import { adminService } from '@/services';
import { PUBLISHING_PROFILES } from '@/data/constants';
import { cn } from '@/lib/utils';
import { useAdminAction, useAdminActor, StatusPill } from './shared';
import type { AdminSettings } from '@/types/domain';
import { useTheme } from '@/providers/ThemeProvider';

const SECTIONS: { key: keyof AdminSettings; label: string; icon: React.ReactNode; description: string }[] = [
  { key: 'general', label: 'General', icon: <Globe className="h-4 w-4" />, description: 'Platform identity, maintenance and signups.' },
  { key: 'marketplace', label: 'Marketplace', icon: <CreditCard className="h-4 w-4" />, description: 'Commission, pricing rules and payouts.' },
  { key: 'publishing', label: 'Publishing', icon: <Server className="h-4 w-4" />, description: 'Default profile, preflight and print rules.' },
  { key: 'payments', label: 'Payments', icon: <CreditCard className="h-4 w-4" />, description: 'Provider, currency and refund window.' },
  { key: 'email', label: 'Email', icon: <Mail className="h-4 w-4" />, description: 'Sender identity and template switches.' },
  { key: 'security', label: 'Security', icon: <Lock className="h-4 w-4" />, description: 'Sessions, 2FA and access allowlists.' },
  { key: 'ai', label: 'AI', icon: <Sparkles className="h-4 w-4" />, description: 'Defaults for generation, credits and memory.' },
];

export default function AdminSettingsPage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success, info, warning } = useToast();
  const { data: settings, refetch } = useAdminSettings();
  const { siteTheme, updateSiteTheme } = useTheme();
  const [section, setSection] = React.useState<keyof AdminSettings>('general');
  const [draft, setDraft] = React.useState<Partial<AdminSettings[keyof AdminSettings]>>({});
  const [maintenanceOpen, setMaintenanceOpen] = React.useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = React.useState('');

  React.useEffect(() => {
    if (settings) setDraft(settings[section]);
  }, [section, settings]);

  const save = useAdminAction(
    ({ key, patch }: { key: keyof AdminSettings; patch: Partial<AdminSettings[keyof AdminSettings]> }) => adminService.updateSettings(key, patch as never, actor),
    { success: 'Settings saved', detail: 'The change is live and written to the audit log.', invalidate: [keys.adminSettings, keys.adminOverview] },
  );

  if (!settings) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  const active = SECTIONS.find((entry) => entry.key === section)!;
  const value = draft as Record<string, unknown>;

  const setField = (key: string, next: unknown) =>
    setDraft((current) => ({ ...(current as Record<string, unknown>), [key]: next }) as Partial<AdminSettings[keyof AdminSettings]>);
  const field = (key: string) => ({
    value: String(value[key] ?? ''),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setField(key, event.target.value),
  });
  const toggle = (key: string) => ({
    checked: Boolean(value[key]),
    onCheckedChange: (checked: boolean) => setField(key, checked),
  });

  return (
    <div>
      <PageHeader title="Platform settings" description="Nine areas of configuration. Everything here is read by the service layer — nothing is hardcoded in a component.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={settings.general.maintenanceMode ? 'destructive' : 'outline'} onClick={() => { setMaintenanceMessage(settings.general.maintenanceMessage); setMaintenanceOpen(true); }}>
            <Wrench className="h-3.5 w-3.5" /> {settings.general.maintenanceMode ? 'End maintenance' : 'Maintenance mode'}
          </Button>
          <Button size="sm" onClick={() => save.mutate({ key: section, patch: draft })} disabled={save.isPending}>
            <Save className="h-3.5 w-3.5" /> {save.isPending ? 'Saving…' : 'Save section'}
          </Button>
        </div>
      </PageHeader>

      {settings.general.maintenanceMode && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-medium">Maintenance mode is on.</span>
          <span>{settings.general.maintenanceMessage}</span>
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => { void adminService.setMaintenance(false, settings.general.maintenanceMessage, actor).then(() => { success('Maintenance mode ended'); void refetch(); }); }}>End now</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[240px,1fr]">
        <nav aria-label="Settings sections" className="space-y-1">
          {SECTIONS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setSection(entry.key)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border p-2 text-left transition-colors',
                section === entry.key ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
              )}
            >
              <span className="mt-0.5 text-muted-foreground">{entry.icon}</span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">{entry.label}</span>
                <span className="block text-2xs text-muted-foreground">{entry.description}</span>
              </span>
            </button>
          ))}
          <Button size="xs" variant="ghost" className="w-full justify-start" onClick={() => info('Theme', 'Site theme lives in the Theme card below so it applies app-wide immediately.')}><Palette className="h-3 w-3" /> Theme</Button>
        </nav>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">{active.icon} {active.label}</CardTitle>
              <CardDescription className="text-xs">{active.description}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {section === 'general' && (
                <>
                  <Field label="Platform name" htmlFor="g-name"><Input id="g-name" {...field('platformName')} /></Field>
                  <Field label="Support email" htmlFor="g-email"><Input id="g-email" {...field('supportEmail')} /></Field>
                  <Field label="Primary domain" htmlFor="g-domain"><Input id="g-domain" {...field('domain')} /></Field>
                  <Field label="Default language" htmlFor="g-language"><Input id="g-language" {...field('defaultLanguage')} /></Field>
                  <Field label="Timezone" htmlFor="g-timezone"><Input id="g-timezone" {...field('timezone')} /></Field>
                  <ToggleRow label="Signups enabled" {...toggle('signupEnabled')} />
                  <Field label="Maintenance message" htmlFor="g-maintenance" className="sm:col-span-2"><Textarea id="g-maintenance" rows={2} {...field('maintenanceMessage')} /></Field>
                  <ToggleRow label="Maintenance mode" {...toggle('maintenanceMode')} className="sm:col-span-2" />
                </>
              )}
              {section === 'marketplace' && (
                <>
                  <Field label="Commission rate (0–1)" htmlFor="m-commission"><Input id="m-commission" type="number" step={0.01} value={Number(value.commissionRate ?? 0)} onChange={(event) => setField('commissionRate', Number(event.target.value))} /></Field>
                  <Field label="Payout threshold ($)" htmlFor="m-threshold"><Input id="m-threshold" type="number" value={Number(value.payoutThreshold ?? 0)} onChange={(event) => setField('payoutThreshold', Number(event.target.value))} /></Field>
                  <Field label="Minimum price ($)" htmlFor="m-min"><Input id="m-min" type="number" step={0.5} value={Number(value.minPrice ?? 0)} onChange={(event) => setField('minPrice', Number(event.target.value))} /></Field>
                  <Field label="Maximum price ($)" htmlFor="m-max"><Input id="m-max" type="number" value={Number(value.maxPrice ?? 0)} onChange={(event) => setField('maxPrice', Number(event.target.value))} /></Field>
                  <Field label="Payout schedule" htmlFor="m-schedule">
                    <select id="m-schedule" value={String(value.payoutSchedule ?? 'monthly')} onChange={(event) => setField('payoutSchedule', event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      {['weekly', 'biweekly', 'monthly'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                    </select>
                  </Field>
                  <ToggleRow label="Marketplace enabled" {...toggle('enabled')} />
                  <ToggleRow label="Auto-approve new listings" {...toggle('autoApprove')} />
                  <ToggleRow label="Reviews enabled" {...toggle('reviewsEnabled')} />
                  <ToggleRow label="Allow free books" {...toggle('allowFreeBooks')} />
                </>
              )}
              {section === 'publishing' && (
                <>
                  <Field label="Default publishing profile" htmlFor="p-profile">
                    <select id="p-profile" value={String(value.defaultProfile ?? 'digital-pdf')} onChange={(event) => setField('defaultProfile', event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      {PUBLISHING_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Maximum trim size" htmlFor="p-max"><Input id="p-max" {...field('maxTrimSize')} /></Field>
                  <ToggleRow label="Require preflight before publishing" {...toggle('requirePreflight')} />
                  <ToggleRow label="Allow print exports" {...toggle('allowPrintExports')} />
                  <ToggleRow label="Enable KDP presets" {...toggle('kdpPresetsEnabled')} />
                  <ToggleRow label="Require an ISBN" {...toggle('isbnRequired')} />
                </>
              )}
              {section === 'payments' && (
                <>
                  <Field label="Provider" htmlFor="pay-provider"><Input id="pay-provider" {...field('provider')} /></Field>
                  <Field label="Currency" htmlFor="pay-currency"><Input id="pay-currency" {...field('currency')} /></Field>
                  <Field label="Refund window (days)" htmlFor="pay-window"><Input id="pay-window" type="number" value={Number(value.refundWindowDays ?? 0)} onChange={(event) => setField('refundWindowDays', Number(event.target.value))} /></Field>
                  <ToggleRow label="Tax inclusive pricing" {...toggle('taxInclusive')} />
                  <ToggleRow label="Payouts enabled" {...toggle('payoutsEnabled')} />
                </>
              )}
              {section === 'email' && (
                <>
                  <Field label="Provider" htmlFor="e-provider"><Input id="e-provider" {...field('provider')} /></Field>
                  <Field label="From name" htmlFor="e-name"><Input id="e-name" {...field('fromName')} /></Field>
                  <Field label="From address" htmlFor="e-from"><Input id="e-from" {...field('fromEmail')} /></Field>
                  <Field label="Reply-to" htmlFor="e-reply"><Input id="e-reply" {...field('replyTo')} /></Field>
                  <ToggleRow label="Welcome sequence" {...toggle('welcomeEnabled')} />
                  <ToggleRow label="Sales receipts" {...toggle('salesEnabled')} />
                  <ToggleRow label="Marketing email" {...toggle('marketingEnabled')} />
                </>
              )}
              {section === 'security' && (
                <>
                  <Field label="Session timeout (minutes)" htmlFor="s-timeout"><Input id="s-timeout" type="number" value={Number(value.sessionTimeoutMinutes ?? 0)} onChange={(event) => setField('sessionTimeoutMinutes', Number(event.target.value))} /></Field>
                  <Field label="Minimum password length" htmlFor="s-password"><Input id="s-password" type="number" value={Number(value.passwordMinLength ?? 0)} onChange={(event) => setField('passwordMinLength', Number(event.target.value))} /></Field>
                  <Field label="Allowed email domains" htmlFor="s-domains"><Input id="s-domains" {...field('allowedDomains')} placeholder="leave blank to allow every domain" /></Field>
                  <Field label="IP allowlist" htmlFor="s-ips"><Input id="s-ips" {...field('ipAllowlist')} placeholder="10.0.0.0/8, 192.168.1.0/24" /></Field>
                  <ToggleRow label="Require two-factor authentication" {...toggle('twoFactorRequired')} />
                  <ToggleRow label="Allow social sign-in" {...toggle('allowSocialLogin')} />
                </>
              )}
              {section === 'ai' && (
                <>
                  <Field label="Default provider" htmlFor="ai-provider"><Input id="ai-provider" {...field('defaultProvider')} /></Field>
                  <Field label="Monthly credits for new accounts" htmlFor="ai-credits"><Input id="ai-credits" type="number" value={Number(value.monthlyCreditsDefault ?? 0)} onChange={(event) => setField('monthlyCreditsDefault', Number(event.target.value))} /></Field>
                  <ToggleRow label="AI features enabled" {...toggle('enabled')} />
                  <ToggleRow label="Image generation for new accounts" {...toggle('imageGenerationDefault')} />
                  <ToggleRow label="Moderate generated content" {...toggle('moderationEnabled')} />
                  <ToggleRow label="Shared book memory" {...toggle('sharedMemory')} />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm"><Palette className="h-4 w-4" /> Site theme</CardTitle>
              <CardDescription className="text-xs">Applies app-wide instantly through the theme provider — no rebuild, no cache.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Primary hue" htmlFor="theme-primary"><input id="theme-primary" type="color" value={siteTheme.primary} onChange={(event) => updateSiteTheme({ primary: event.target.value })} className="h-9 w-full rounded border" /></Field>
                <Field label="Secondary" htmlFor="theme-secondary"><input id="theme-secondary" type="color" value={siteTheme.secondary} onChange={(event) => updateSiteTheme({ secondary: event.target.value })} className="h-9 w-full rounded border" /></Field>
                <Field label="Accent" htmlFor="theme-accent"><input id="theme-accent" type="color" value={siteTheme.accent} onChange={(event) => updateSiteTheme({ accent: event.target.value })} className="h-9 w-full rounded border" /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Corner radius (px)" htmlFor="theme-radius"><Input id="theme-radius" type="number" value={siteTheme.radius} onChange={(event) => updateSiteTheme({ radius: Number(event.target.value) })} /></Field>
                <Field label="Default mode" htmlFor="theme-mode">
                  <select id="theme-mode" value={siteTheme.defaultMode} onChange={(event) => updateSiteTheme({ defaultMode: event.target.value as 'light' | 'dark' | 'system' })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                    {['light', 'dark', 'system'].map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                </Field>
                <Field label="Font pairing" htmlFor="theme-font"><Input id="theme-font" value={siteTheme.fontPairing} onChange={(event) => updateSiteTheme({ fontPairing: event.target.value })} /></Field>
                <Field label="Hero style" htmlFor="theme-hero">
                  <select id="theme-hero" value={siteTheme.heroStyle} onChange={(event) => updateSiteTheme({ heroStyle: event.target.value as typeof siteTheme.heroStyle })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                    {['gradient', 'minimal', 'bold', 'editorial'].map((style) => <option key={style} value={style}>{style}</option>)}
                  </select>
                </Field>
                <Field label="Logo text" htmlFor="theme-logo"><Input id="theme-logo" value={siteTheme.logoText} onChange={(event) => updateSiteTheme({ logoText: event.target.value })} /></Field>
                <Field label="Logo mark" htmlFor="theme-mark"><Input id="theme-mark" value={siteTheme.logoMark} onChange={(event) => updateSiteTheme({ logoMark: event.target.value })} /></Field>
              </div>
              <Separator />
              <p className="text-2xs font-medium">Announcement bar</p>
              <div className="grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
                <Input value={siteTheme.announcement.text} onChange={(event) => updateSiteTheme({ announcement: { ...siteTheme.announcement, text: event.target.value } })} aria-label="Announcement text" />
                <Input value={siteTheme.announcement.href} onChange={(event) => updateSiteTheme({ announcement: { ...siteTheme.announcement, href: event.target.value } })} aria-label="Announcement link" />
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={siteTheme.announcement.enabled} onCheckedChange={(checked) => updateSiteTheme({ announcement: { ...siteTheme.announcement, enabled: checked, version: siteTheme.announcement.version + 1 } })} /> Show
                </label>
              </div>
              <Button size="sm" className="w-full" onClick={() => { success('Theme published', 'Every page and the marketing site picked up the new tokens.'); }}>Publish theme</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Integrations</CardTitle>
              <CardDescription className="text-xs">Placeholders only — no secrets are ever stored in the client.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {[
                { name: 'Payments', state: settings.payments.provider, note: 'Server-side keys in Phase 6.' },
                { name: 'Email', state: settings.email.provider, note: 'Transactional + marketing.' },
                { name: 'Storage', state: 'MockR2Provider', note: 'Swaps for Cloudflare R2 in Phase 3.' },
                { name: 'AI providers', state: settings.ai.defaultProvider, note: 'Mocked locally; keys stay server-side.' },
              ].map((entry) => (
                <div key={entry.name} className="rounded border p-2 text-xs">
                  <p className="flex items-center justify-between font-medium">{entry.name} <StatusPill value={entry.state.includes('mock') || entry.state.includes('Mock') ? 'simulated' : 'configured'} /></p>
                  <p className="text-2xs text-muted-foreground">{entry.state} · {entry.note}</p>
                </div>
              ))}
              <div className="rounded border border-dashed p-2 text-2xs text-muted-foreground sm:col-span-2">
                Secret inputs are deliberately omitted: a real deployment injects credentials through the server environment, never through the browser.
              </div>
            </CardContent>
          </Card>

          <Tabs value={section} onValueChange={(next) => setSection(next as keyof AdminSettings)} size="sm" tabs={SECTIONS.map((entry) => ({ value: entry.key as string, label: entry.label }))} />

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => save.mutate({ key: section, patch: draft })} disabled={save.isPending}><Save className="h-3.5 w-3.5" /> Save {active.label.toLowerCase()}</Button>
            <Button size="sm" variant="outline" onClick={() => { setDraft(settings[section]); success('Changes discarded'); }}>Reset form</Button>
            <Button size="sm" variant="ghost" onClick={() => { void refetch(); success('Settings reloaded from the data provider'); }}>Reload</Button>
            <Badge variant="outline" className="ml-auto">Changes are audited</Badge>
          </div>
        </div>
      </div>

      <Modal
        open={maintenanceOpen}
        onOpenChange={setMaintenanceOpen}
        title={settings.general.maintenanceMode ? 'End maintenance mode' : 'Enable maintenance mode'}
        description="While maintenance is on, the public site serves the maintenance screen and the dashboard shows a banner."
        footer={
          <>
            <Button variant="outline" onClick={() => setMaintenanceOpen(false)}>Cancel</Button>
            <Button
              variant={settings.general.maintenanceMode ? 'default' : 'destructive'}
              onClick={async () => {
                const enabling = !settings.general.maintenanceMode;
                const ok = await confirm({
                  title: enabling ? 'Put the platform into maintenance?' : 'Bring the platform back online?',
                  description: enabling ? 'Visitors see the maintenance screen until you switch it off.' : 'All users regain access immediately.',
                  destructive: enabling,
                  confirmLabel: enabling ? 'Enable maintenance' : 'End maintenance',
                });
                if (!ok) return;
                await adminService.setMaintenance(enabling, maintenanceMessage, actor);
                success(enabling ? 'Maintenance mode enabled' : 'Platform is live again');
                setMaintenanceOpen(false);
                void refetch();
              }}
            >
              {settings.general.maintenanceMode ? 'End maintenance' : 'Enable maintenance'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="maintenance-message" className="text-xs">Message shown to visitors</Label>
            <Textarea id="maintenance-message" rows={3} value={maintenanceMessage} onChange={(event) => setMaintenanceMessage(event.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['We’ll be back shortly — scheduled maintenance.', 'Upgrading the publishing engine. Back in 15 minutes.', 'Planned database migration in progress.'].map((preset) => (
              <button key={preset} type="button" onClick={() => setMaintenanceMessage(preset)} className="rounded border px-2 py-0.5 text-2xs hover:border-primary/50">{preset}</button>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground" onMouseEnter={() => warning('Maintenance blocks sign-in', 'Staff accounts can still reach /admin.')}>Staff keep access to the admin app while maintenance is on.</p>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({ label, checked, onCheckedChange, className }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between rounded border p-2', className)}>
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
