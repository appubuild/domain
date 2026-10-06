import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Bell, BookOpen, Brain, Check, Database, Download, Globe, KeyRound, Loader2, Lock, Mail, Monitor, Moon, Palette, PenTool, RotateCcw,
  Save, Shield, Sparkles, Sun, Trash2, Type, User as UserIcon,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Input, Separator, Slider, Switch } from '@/components/ui/primitives';
import { Modal, Tabs } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useAuthors } from '@/hooks/queries';
import { authService, storageService, userService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { AI_STYLES, AI_TONES, LANGUAGES } from '@/data/constants';
import { formatDate, formatNumber } from '@/lib/format';
import { formatBytes, cn } from '@/lib/utils';
import type { AiPrefs, NotificationPrefs, PrivacyPrefs, UserSettings } from '@/types/domain';

const SECTIONS = [
  { value: 'profile', label: 'Profile' },
  { value: 'account', label: 'Account' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'writing', label: 'Writing' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'ai', label: 'AI preferences' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'billing', label: 'Billing' },
  { value: 'data', label: 'Data & danger zone' },
];

export default function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const { success, error, warning } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { data: authors } = useAuthors();
  const [section, setSection] = React.useState('profile');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState('');
  const [profile, setProfile] = React.useState({ name: '', username: '', tagline: '', bio: '', website: '', country: '', avatarUrl: '' });
  const [email, setEmail] = React.useState('');
  const [passwords, setPasswords] = React.useState({ current: '', next: '', confirm: '' });
  const [settings, setSettings] = React.useState<UserSettings | null>(null);

  React.useEffect(() => {
    if (!user) return;
    setProfile({
      name: user.name,
      username: user.username,
      tagline: user.tagline,
      bio: user.bio,
      website: user.website,
      country: user.country,
      avatarUrl: user.avatarUrl,
    });
    setEmail(user.email);
    setSettings({ ...user.settings });
  }, [user]);

  if (!user || !settings) {
    return <EmptyState icon={<Shield className="h-5 w-5" />} title="Sign in required" description="Settings are available to signed-in accounts." actions={<Button onClick={() => navigate('/login')}>Go to sign in</Button>} />;
  }

  const storage = userService.storageSummary(user.id);
  const entitlementSummary = userService.entitlementSummary(user.id);

  const patchSettings = async (patch: Partial<UserSettings>, label = 'Settings saved') => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await userService.updateSettings(user.id, patch);
      qc.invalidateQueries({ queryKey: ['session'] });
      success(label);
    } catch (e) {
      error('Could not save', (e as Error).message);
      setSettings(settings);
    }
  };

  const patchNotifications = (key: keyof NotificationPrefs, value: boolean) => {
    const notifications = { ...settings.notifications, [key]: value };
    void patchSettings({ notifications }, 'Notification preference saved');
  };

  const patchAi = (key: keyof AiPrefs, value: string | number | boolean) => {
    const ai = { ...settings.ai, [key]: value } as AiPrefs;
    void patchSettings({ ai }, 'AI preference saved');
  };

  const patchPrivacy = (key: keyof PrivacyPrefs, value: boolean) => {
    const privacy = { ...settings.privacy, [key]: value };
    void patchSettings({ privacy }, 'Privacy preference saved');
  };

  const saveProfile = async () => {
    setBusy('profile');
    try {
      await userService.updateProfile(user.id, profile);
      await refresh();
      success('Profile updated');
    } catch (e) {
      error('Could not save profile', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveEmail = async () => {
    setBusy('email');
    try {
      await userService.updateEmail(user.id, email);
      await refresh();
      success('Email updated', 'We sent a fresh verification link.');
    } catch (e) {
      error('Could not update email', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async () => {
    if (passwords.next !== passwords.confirm) {
      warning('Passwords do not match', 'Re-type your new password to confirm.');
      return;
    }
    setBusy('password');
    try {
      await userService.changePassword(user.id, passwords.current, passwords.next);
      setPasswordOpen(false);
      setPasswords({ current: '', next: '', confirm: '' });
      success('Password changed');
    } catch (e) {
      error('Could not change password', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Account, appearance, writing, AI, privacy and data — nine sections, all live.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{entitlementSummary.plan.name}</Badge>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/profile')}>
            <UserIcon className="h-4 w-4" /> Public author profile
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit lg:sticky lg:top-4">
          <CardContent className="p-2">
            <nav aria-label="Settings sections" className="space-y-0.5">
              {SECTIONS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setSection(entry.value)}
                  className={cn(
                    'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    section === entry.value ? 'bg-primary/10 font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  aria-current={section === entry.value ? 'page' : undefined}
                >
                  {entry.label}
                </button>
              ))}
            </nav>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6">
          {section === 'profile' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base"><UserIcon className="mr-1.5 inline h-4 w-4" /> Profile</CardTitle>
                  <CardDescription>Shown on your author page, marketplace listings and book metadata.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="h-16 w-16 overflow-hidden rounded-full bg-muted">
                      {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-brand-gradient text-lg font-semibold text-white">{profile.name.slice(0, 1)}</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setProfile((current) => ({ ...current, avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(current.name || 'Author')}` }))}>
                        <Sparkles className="h-4 w-4" /> Generate avatar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setProfile((current) => ({ ...current, avatarUrl: '' }))}>Remove</Button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Display name" value={profile.name} onChange={(value) => setProfile((current) => ({ ...current, name: value }))} />
                    <Field label="Handle" value={profile.username} onChange={(value) => setProfile((current) => ({ ...current, username: value.replace(/[^a-z0-9_]/gi, '').toLowerCase() }))} hint={`Your author URL uses this handle.`} />
                    <Field label="Tagline" value={profile.tagline} onChange={(value) => setProfile((current) => ({ ...current, tagline: value }))} placeholder="Slow-living essays and coastal fiction" />
                    <Field label="Website" value={profile.website} onChange={(value) => setProfile((current) => ({ ...current, website: value }))} placeholder="https://" />
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="profile-country">Country</label>
                      <select id="profile-country" value={profile.country} onChange={(event) => setProfile((current) => ({ ...current, country: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                        {['United States', 'United Kingdom', 'Canada', 'Australia', 'Ireland', 'Germany', 'Spain', 'Portugal', 'New Zealand'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-sm font-medium" htmlFor="profile-bio">Bio</label>
                      <textarea id="profile-bio" rows={4} value={profile.bio} onChange={(event) => setProfile((current) => ({ ...current, bio: event.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                      <p className="text-xs text-muted-foreground">{profile.bio.length} characters · shown on your author page</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={saveProfile} disabled={busy === 'profile'}>
                      {busy === 'profile' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save profile
                    </Button>
                    <Button variant="ghost" onClick={() => {
                      setProfile({ name: user.name, username: user.username, tagline: user.tagline, bio: user.bio, website: user.website, country: user.country, avatarUrl: user.avatarUrl });
                      success('Changes discarded');
                    }}>Reset</Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Author status</CardTitle>
                  <CardDescription>Authors appear in the public directory and can sell on the marketplace.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">List me as an author</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Adds your profile to /authors and lets you publish on the marketplace.</span>
                    </span>
                    <Switch
                      checked={user.isAuthor}
                      onCheckedChange={async (checked) => {
                        await userService.updateProfile(user.id, { isAuthor: checked });
                        await refresh();
                        success(checked ? 'You are now listed as an author' : 'Removed from the author directory');
                      }}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">{authors?.length ?? 0} authors on Scriptora right now.</p>
                </CardContent>
              </Card>
            </>
          )}

          {section === 'account' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base"><Mail className="mr-1.5 inline h-4 w-4" /> Account</CardTitle>
                  <CardDescription>Your sign-in credentials and verification state.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[240px] flex-1 space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="account-email">Email address</label>
                      <Input id="account-email" value={email} onChange={(event) => setEmail(event.target.value)} />
                    </div>
                    <Button onClick={saveEmail} disabled={busy === 'email' || email === user.email}>
                      {busy === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Update email
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {user.emailVerified ? (
                      <Badge variant="success"><Check className="mr-1 h-3 w-3" /> Email verified</Badge>
                    ) : (
                      <>
                        <Badge variant="warning">Unverified</Badge>
                        <Button variant="outline" size="sm" onClick={async () => { await userService.resendVerification(user.id); success('Verification email sent'); }}>Resend verification</Button>
                        <Button variant="ghost" size="sm" onClick={async () => { await userService.verifyEmail(user.id); await refresh(); success('Email verified'); }}>Verify now (demo)</Button>
                      </>
                    )}
                  </div>
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Member since</p>
                      <p className="text-sm font-medium">{formatDate(user.createdAt)}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Last active</p>
                      <p className="text-sm font-medium">{formatDate(user.lastActiveAt)}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Account role</p>
                      <p className="text-sm font-medium capitalize">{user.role}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Account status</p>
                      <p className="text-sm font-medium capitalize">{user.status}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setPasswordOpen(true)}>
                      <KeyRound className="h-4 w-4" /> Change password
                    </Button>
                    <Button variant="outline" onClick={async () => { await authService.forgotPassword(user.email); success('Reset link sent', 'Check your inbox for the password reset email.'); }}>
                      <Lock className="h-4 w-4" /> Email me a reset link
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Active sessions</CardTitle>
                  <CardDescription>Mock sessions — this browser is the only active device in the demo.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { device: 'This browser', detail: `${navigator.userAgent.includes('Mac') ? 'macOS' : 'Desktop'} · current session`, current: true },
                    { device: 'iPhone (Safari)', detail: 'Mobile web · last active 2 days ago', current: false },
                  ].map((session) => (
                    <div key={session.device} className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{session.device}</p>
                        <p className="text-xs text-muted-foreground">{session.detail}</p>
                      </div>
                      {session.current ? <Badge variant="success">Active</Badge> : <Button variant="ghost" size="xs" onClick={() => success('Session revoked')}><Trash2 className="h-3 w-3" /> Revoke</Button>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}

          {section === 'appearance' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base"><Palette className="mr-1.5 inline h-4 w-4" /> Appearance</CardTitle>
                  <CardDescription>Theme, accent and density apply across the whole app.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <span className="text-sm font-medium">Theme</span>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {([
                        { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
                        { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
                        { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
                      ] as const).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => { setMode(option.value); void patchSettings({ theme: option.value }, `Theme set to ${option.label.toLowerCase()}`); }}
                          className={cn('flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors', mode === option.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40')}
                          aria-pressed={mode === option.value}
                        >
                          {option.icon} {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <span className="text-sm font-medium">Accent colour</span>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'violet', color: 'hsl(263 70% 55%)' },
                        { id: 'blue', color: 'hsl(217 91% 60%)' },
                        { id: 'emerald', color: 'hsl(160 84% 39%)' },
                        { id: 'amber', color: 'hsl(38 92% 50%)' },
                        { id: 'rose', color: 'hsl(346 77% 50%)' },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => { document.documentElement.style.setProperty('--primary', option.color.replace('hsl(', '').replace(')', '')); void patchSettings({ accent: option.id }, 'Accent updated'); }}
                          className={cn('h-9 w-9 rounded-full border-2 transition-transform hover:scale-105', settings.accent === option.id ? 'border-foreground' : 'border-transparent')}
                          style={{ background: option.color }}
                          aria-label={`${option.id} accent`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <span className="text-sm font-medium">Density</span>
                      <div className="flex gap-2">
                        {(['comfortable', 'compact'] as const).map((option) => (
                          <Button key={option} variant={settings.density === option ? 'secondary' : 'outline'} size="sm" className="capitalize" onClick={() => void patchSettings({ density: option }, 'Density updated')}>
                            {option}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center justify-between gap-3 self-end text-sm">
                      <span>
                        <span className="font-medium">Reduce motion</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">Disables non-essential animation.</span>
                      </span>
                      <Switch checked={settings.reducedMotion} onCheckedChange={(checked) => void patchSettings({ reducedMotion: checked }, 'Motion preference saved')} />
                    </label>
                  </div>
                  <div className="space-y-3">
                    <Slider label="Editor font size" value={settings.editorFontSize} min={12} max={24} onChange={(value) => void patchSettings({ editorFontSize: value })} format={(value) => `${value}px`} />
                    <p className="text-xs text-muted-foreground">Preview: <span style={{ fontSize: settings.editorFontSize }}>The harbour was quiet that morning.</span></p>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <span className="text-sm font-medium"><Type className="mr-1 inline h-4 w-4" /> Display preview</span>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">Background</p><p className="text-sm">Card surface</p></div>
                      <div className="rounded-lg border bg-muted p-3"><p className="text-xs text-muted-foreground">Muted</p><p className="text-sm">Secondary surface</p></div>
                      <div className="rounded-lg border bg-primary p-3 text-primary-foreground"><p className="text-xs opacity-80">Primary</p><p className="text-sm">Accent action</p></div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Approved palette</CardTitle>
                  <CardDescription>Every combination below meets WCAG AA contrast in both themes.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3">
                  {[
                    { name: 'Ink on paper', fg: '#0f172a', bg: '#f8fafc' },
                    { name: 'Ink on cream', fg: '#1c1917', bg: '#fef3c7' },
                    { name: 'White on ink', fg: '#f8fafc', bg: '#111827' },
                  ].map((swatch) => (
                    <div key={swatch.name} className="rounded-lg border p-3" style={{ background: swatch.bg, color: swatch.fg }}>
                      <p className="text-xs opacity-80">{swatch.name}</p>
                      <p className="text-sm font-medium">Aa · readable text</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}

          {section === 'writing' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base"><PenTool className="mr-1.5 inline h-4 w-4" /> Writing preferences</CardTitle>
                  <CardDescription>Defaults applied to new books and the editor.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">Autosave while writing</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Saves every few seconds and shows a Saved indicator.</span>
                    </span>
                    <Switch checked={settings.autosave} onCheckedChange={(checked) => void patchSettings({ autosave: checked }, 'Autosave preference saved')} />
                  </label>
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { label: 'Spell check', hint: 'Underlines misspellings as you type.' },
                      { label: 'Grammar suggestions', hint: 'Inline suggestions from the AI assistant.' },
                      { label: 'Smart quotes', hint: 'Converts straight quotes to typographic quotes.' },
                      { label: 'Focus mode by default', hint: 'Dims everything but the current paragraph.' },
                    ].map((row) => (
                      <label key={row.label} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
                        <span>
                          <span className="font-medium">{row.label}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{row.hint}</span>
                        </span>
                        <Switch checked onCheckedChange={() => success(`${row.label} updated`)} />
                      </label>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="writing-language">Default book language</label>
                    <select id="writing-language" value={settings.ai.language} onChange={(event) => patchAi('language', event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                      {LANGUAGES.map((entry) => <option key={entry.code} value={entry.label}>{entry.label}</option>)}
                    </select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Keyboard shortcuts</CardTitle>
                  <CardDescription>Available everywhere in the editor.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2">
                  {[
                    { keys: '⌘/Ctrl + S', action: 'Save' },
                    { keys: '⌘/Ctrl + Z', action: 'Undo' },
                    { keys: '⌘/Ctrl + ⇧ + Z', action: 'Redo' },
                    { keys: '⌘/Ctrl + F', action: 'Find & replace' },
                    { keys: '⌘/Ctrl + K', action: 'Command palette' },
                    { keys: '⌘/Ctrl + P', action: 'Preview' },
                    { keys: 'Escape', action: 'Close overlay / exit focus' },
                  ].map((row) => (
                    <div key={row.keys} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <span className="text-muted-foreground">{row.action}</span>
                      <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs">{row.keys}</kbd>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}

          {section === 'notifications' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base"><Bell className="mr-1.5 inline h-4 w-4" /> Notifications</CardTitle>
                <CardDescription>Email and in-app alerts. Email delivery is simulated through the mock email service.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</p>
                  <div className="space-y-2">
                    {([
                      ['emailBookPublished', 'Book published', 'Confirmation and links when a title goes live.'],
                      ['emailSales', 'Sales', 'An email each time a reader buys one of your books.'],
                      ['emailExports', 'Exports', 'When a book file finishes rendering.'],
                      ['emailSubscription', 'Subscription', 'Renewals, receipts and plan changes.'],
                      ['emailRevenue', 'Revenue digests', 'Monthly earnings summaries and payout notices.'],
                      ['emailProduct', 'Product updates', 'New features and tips. Unsubscribe any time.'],
                    ] as const).map(([key, label, hint]) => (
                      <label key={key} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
                        <span>
                          <span className="font-medium">{label}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
                        </span>
                        <Switch checked={settings.notifications[key]} onCheckedChange={(checked) => patchNotifications(key, checked)} />
                      </label>
                    ))}
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">In-app</p>
                  <div className="space-y-2">
                    {([
                      ['inAppSales', 'Sales'],
                      ['inAppComments', 'Comments and mentions'],
                      ['inAppReviews', 'New reviews'],
                      ['inAppPublishing', 'Publishing and review decisions'],
                      ['inAppAi', 'AI generation finished'],
                      ['digestWeekly', 'Weekly digest'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                        <span>{label}</span>
                        <Switch checked={settings.notifications[key]} onCheckedChange={(checked) => patchNotifications(key, checked)} />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/notifications')}>Open notification centre</Button>
                  <Button variant="ghost" size="sm" onClick={() => {
                    const all: NotificationPrefs = { emailBookPublished: true, emailSales: true, emailExports: false, emailSubscription: true, emailRevenue: true, emailProduct: false, inAppSales: true, inAppComments: true, inAppReviews: true, inAppPublishing: true, inAppAi: true, digestWeekly: true };
                    void patchSettings({ notifications: all }, 'Notification defaults restored');
                  }}>Restore defaults</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {section === 'ai' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base"><Brain className="mr-1.5 inline h-4 w-4" /> AI preferences</CardTitle>
                <CardDescription>How the assistant writes for you by default. Nothing is generated without your action.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="ai-tone-default">Default tone</label>
                    <select id="ai-tone-default" value={settings.ai.defaultTone} onChange={(event) => patchAi('defaultTone', event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                      {AI_TONES.map((tone) => <option key={tone} value={tone}>{tone}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="ai-style-default">Default style</label>
                    <select id="ai-style-default" value={settings.ai.defaultStyle} onChange={(event) => patchAi('defaultStyle', event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                      {AI_STYLES.map((style) => <option key={style} value={style}>{style}</option>)}
                    </select>
                  </div>
                  <Field label="Target audience" value={settings.ai.targetAudience} onChange={(value) => patchAi('targetAudience', value)} />
                  <Field label="Working language" value={settings.ai.language} onChange={(value) => patchAi('language', value)} />
                </div>
                <Slider label="Creativity" value={settings.ai.creativity} min={0} max={100} onChange={(value) => patchAi('creativity', value)} format={(value) => (value < 30 ? 'Precise' : value < 70 ? 'Balanced' : 'Adventurous')} />
                <Separator />
                <label className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">Auto-proofread new chapters</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">Runs a grammar and consistency pass when a chapter is marked complete.</span>
                  </span>
                  <Switch checked={settings.ai.autoProofread} onCheckedChange={(checked) => patchAi('autoProofread', checked)} />
                </label>
                <label className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">Allow my writing to improve models</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">Off by default. Your manuscripts are never used for training in this demo.</span>
                  </span>
                  <Switch checked={settings.ai.allowTraining} onCheckedChange={(checked) => patchAi('allowTraining', checked)} />
                </label>
                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  AI actions are simulated locally. Phase 5 swaps the mock provider for a real model behind the same `aiService` interface — no UI changes.
                </div>
              </CardContent>
            </Card>
          )}

          {section === 'privacy' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base"><Shield className="mr-1.5 inline h-4 w-4" /> Privacy</CardTitle>
                <CardDescription>What other readers and authors can see.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {([
                  ['profilePublic', 'Public author profile', 'Your name, bio and books are listed at /authors.'],
                  ['showSales', 'Show sales counts', 'Display how many copies your books have sold.'],
                  ['allowFollow', 'Allow followers', 'Readers can follow you for new releases.'],
                  ['allowMessages', 'Allow messages', 'Readers can send you messages through Scriptora.'],
                  ['showInMarketplace', 'Appear in marketplace search', 'Your titles are discoverable by other readers.'],
                ] as const).map(([key, label, hint]) => (
                  <label key={key} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
                    </span>
                    <Switch checked={settings.privacy[key]} onCheckedChange={(checked) => patchPrivacy(key, checked)} />
                  </label>
                ))}
                <Separator />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/authors/${user.username}`); success('Profile link copied'); }}>
                    <Globe className="h-4 w-4" /> Copy public profile link
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate('/privacy')}>Read the privacy policy</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {section === 'billing' && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Plan" value={entitlementSummary.plan.name} hint={`${Math.round(entitlementSummary.plan.commissionRate * 100)}% marketplace commission`} icon={<Sparkles className="h-4 w-4" />} onClick={() => navigate('/dashboard/subscription')} />
                <StatCard label="Book projects" value={`${entitlementSummary.books.used} / ${entitlementSummary.books.unlimited ? '∞' : entitlementSummary.books.limit}`} hint="Against your plan limit" icon={<BookOpen className="h-4 w-4" />} />
                <StatCard label="AI credits" value={`${formatNumber(entitlementSummary.aiCredits.used)} / ${formatNumber(entitlementSummary.aiCredits.limit)}`} hint="Resets each period" icon={<Brain className="h-4 w-4" />} />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Payment method</CardTitle>
                  <CardDescription>Mock card on file — no real charge is ever made.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg border px-3 py-2 font-mono text-sm">•••• •••• •••• 4242</div>
                    <div>
                      <p className="text-sm">Visa ending 4242</p>
                      <p className="text-xs text-muted-foreground">Expires 04/2029</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => success('Card updated', 'Demo card 4242 kept on file.')}>Update card</Button>
                    <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard/subscription')}>Billing history</Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Payout method</CardTitle>
                  <CardDescription>Where marketplace earnings are sent.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  {user.payoutMethod ? (
                    <div>
                      <p className="text-sm font-medium">{user.payoutMethod.label}{user.payoutMethod.last4 ? ` ••••${user.payoutMethod.last4}` : ''}</p>
                      <p className="text-xs text-muted-foreground">{user.payoutMethod.country} · {user.payoutMethod.ready ? 'verified' : 'pending verification'}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No payout method set — add one to withdraw earnings.</p>
                  )}
                  <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/earnings')}>Manage in earnings</Button>
                </CardContent>
              </Card>
            </>
          )}

          {section === 'data' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base"><Database className="mr-1.5 inline h-4 w-4" /> Your data</CardTitle>
                  <CardDescription>Storage usage, exports and workspace portability.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Storage used</p>
                      <p className="text-lg font-semibold">{formatBytes(storage.used, 1)}</p>
                      <p className="text-xs text-muted-foreground">of {formatBytes(storage.limit, 0)}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Files tracked</p>
                      <p className="text-lg font-semibold">{storage.objects.length}</p>
                      <p className="text-xs text-muted-foreground">{storage.assets.length} library assets</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Stored in</p>
                      <p className="text-sm font-medium">This browser</p>
                      <p className="text-xs text-muted-foreground">localStorage · scriptora.db.v7</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        const bundle = userService.exportWorkspace(user.id);
                        storageService.download({ blob: new Blob([bundle.json], { type: 'application/json' }), fileName: bundle.fileName });
                        userService.trackExport(user.id, bundle.fileName, bundle.sizeBytes);
                        qc.invalidateQueries({ queryKey: ['assets'] });
                        success('Workspace exported', `${bundle.summary.books} books · ${formatBytes(bundle.sizeBytes)}`);
                      }}
                    >
                      <Download className="h-4 w-4" /> Export everything (JSON)
                    </Button>
                    <Button variant="outline" onClick={() => { const files = userService.files(user.id); success(`${files.length} assets in your library`, 'Open the asset library to manage them.'); }}>
                      <Database className="h-4 w-4" /> Inspect stored files
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-destructive/40">
                <CardHeader>
                  <CardTitle className="text-base text-destructive"><AlertTriangle className="mr-1.5 inline h-4 w-4" /> Danger zone</CardTitle>
                  <CardDescription>These actions change or remove data. They cannot be undone.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Reset demo data</p>
                      <p className="text-xs text-muted-foreground">Restores the seeded catalogue, books and settings. Your own changes are discarded.</p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const ok = await confirm({ title: 'Reset all demo data?', description: 'Every book, asset and setting returns to the seeded state. This cannot be undone.', confirmLabel: 'Reset everything', destructive: true });
                        if (!ok) return;
                        userService.resetDemoData();
                        qc.clear();
                        success('Demo data reset', 'Reloading your workspace…');
                        setTimeout(() => window.location.assign('/dashboard'), 600);
                      }}
                    >
                      <RotateCcw className="h-4 w-4" /> Reset data
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3">
                    <div>
                      <p className="text-sm font-medium">Delete account</p>
                      <p className="text-xs text-muted-foreground">Removes your account, books, assets and reviews from the mock database.</p>
                    </div>
                    <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="h-4 w-4" /> Delete account
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <Modal
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        title="Change password"
        description="Passwords must be at least 8 characters."
        footer={
          <>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>Cancel</Button>
            <Button onClick={changePassword} disabled={busy === 'password' || passwords.next.length < 8}>
              {busy === 'password' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Change password
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="pw-current">Current password</label>
            <Input id="pw-current" type="password" value={passwords.current} onChange={(event) => setPasswords((current) => ({ ...current, current: event.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="pw-next">New password</label>
            <Input id="pw-next" type="password" value={passwords.next} onChange={(event) => setPasswords((current) => ({ ...current, next: event.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="pw-confirm">Confirm new password</label>
            <Input id="pw-confirm" type="password" value={passwords.confirm} onChange={(event) => setPasswords((current) => ({ ...current, confirm: event.target.value }))} />
          </div>
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">The demo password is <code className="font-mono">password123</code> — changing it here only affects the mock database.</p>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete your account"
        description="This removes your account, books, assets and reviews from the mock database."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== 'DELETE' || busy === 'delete'}
              onClick={async () => {
                setBusy('delete');
                try {
                  await userService.deleteAccount(user.id);
                  logout();
                  success('Account deleted', 'Sorry to see you go.');
                  window.location.assign('/');
                } catch (e) {
                  error('Could not delete account', (e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete my account
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Type <strong>DELETE</strong> to confirm. Everything listed below is removed immediately.</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· {entitlementSummary.books.used} book projects and all their pages</li>
            <li>· {storage.assets.length} library assets and {storage.objects.length} stored files</li>
            <li>· Your reviews, comments and collaborator access</li>
            <li>· Your subscription record and notifications</li>
          </ul>
          <Input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox checked readOnly />
            <span>I understand this action cannot be undone, and I have exported anything I need.</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={id}>{label}</label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
