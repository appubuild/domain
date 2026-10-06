import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCmsPage } from '@/hooks/queries';
import { CmsPageView } from '@/pages/public/CmsPageView';
import { Seo } from '@/components/shared/Seo';
import { Section, SectionHeading } from '@/components/shared/sections';
import { Button, Card, CardContent, Input, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { emailService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { cn } from '@/lib/utils';

const TOPICS = [
  { id: 'support', label: 'Product support', description: 'Something is not working, or you need help in the editor.' },
  { id: 'publishing', label: 'Publishing & print', description: 'Trim sizes, bleed, preflight, ISBNs and printer requirements.' },
  { id: 'billing', label: 'Billing & plans', description: 'Subscriptions, invoices, refunds and plan changes.' },
  { id: 'rights', label: 'Rights & takedown', description: 'Copyright claims, DMCA notices and content reports.' },
  { id: 'partnership', label: 'Partnerships & press', description: 'Press enquiries, integrations and publishing partnerships.' },
  { id: 'feedback', label: 'Product feedback', description: 'Feature requests, workflow gaps and ideas.' },
] as const;

export default function ContactPage() {
  const { data: page, isLoading } = useCmsPage('contact');
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { success, error } = useToast();

  const [topic, setTopic] = React.useState<(typeof TOPICS)[number]['id']>('support');
  const [form, setForm] = React.useState({ name: '', email: '', subject: '', message: '' });
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  React.useEffect(() => {
    if (user) setForm((current) => ({ ...current, name: current.name || user.name, email: current.email || user.email }));
  }, [user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      await emailService.send({
        to: 'support@scriptora.app',
        toName: 'Scriptora Support',
        template: 'contact-form',
        meta: `${TOPICS.find((entry) => entry.id === topic)?.label} · ${form.subject}`,
      });
      setSent(true);
      success('Message sent', 'We reply within one business day for Pro accounts.');
      setForm((current) => ({ ...current, subject: '', message: '' }));
    } catch {
      error('Message could not be sent', 'Please try again in a moment.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Seo
        title="Contact Scriptora"
        description="Contact the Scriptora team about support, publishing, billing, rights, partnerships or product feedback."
        canonical="/contact"
      />
      {params.get('subscribed') === '1' && (
        <div className="border-b border-success/30 bg-success/10 px-4 py-2.5 text-center text-sm text-success">
          You are on the list. We send roughly one email a month, and never share your address.
        </div>
      )}
      {isLoading ? (
        <div className="container space-y-5 py-14">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : page ? (
        <CmsPageView page={page} breadcrumbLabel="Contact" />
      ) : (
        <div className="container py-16">
          <ErrorState title="Contact information could not load" />
        </div>
      )}

      <Section tone="muted">
        <SectionHeading eyebrow="Send a message" title="Pick a topic and we will route it correctly" description="Support replies within one business day. Business plans get a four-hour first response." />
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-2">
            {TOPICS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTopic(entry.id)}
                aria-pressed={topic === entry.id}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                  topic === entry.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40',
                )}
              >
                <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{entry.description}</p>
              </button>
            ))}
          </div>
          <Card>
            <CardContent>
              <form className="space-y-4" onSubmit={submit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="contact-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Your name
                    </label>
                    <Input
                      id="contact-name"
                      required
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Maya Chen"
                    />
                  </div>
                  <div>
                    <label htmlFor="contact-email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Email
                    </label>
                    <Input
                      id="contact-email"
                      type="email"
                      required
                      value={form.email}
                      onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="contact-topic" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Topic
                  </label>
                  <Select id="contact-topic" value={topic} onChange={(event) => setTopic(event.target.value as (typeof TOPICS)[number]['id'])}>
                    {TOPICS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="contact-subject" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Subject
                  </label>
                  <Input
                    id="contact-subject"
                    required
                    value={form.subject}
                    onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
                    placeholder="Preflight flags my images at 280 DPI"
                  />
                </div>
                <div>
                  <label htmlFor="contact-message" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Message
                  </label>
                  <Textarea
                    id="contact-message"
                    required
                    rows={6}
                    minLength={20}
                    value={form.message}
                    onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                    placeholder="Include your book title or order number if it is relevant. Screenshots help."
                  />
                  <p className="mt-1 text-2xs text-muted-foreground">{form.message.length} characters · minimum 20</p>
                </div>
                {sent && <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">Your previous message was recorded. Send another below if needed.</p>}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setForm({ name: user?.name ?? '', email: user?.email ?? '', subject: '', message: '' })}
                  >
                    Clear
                  </Button>
                  <Button type="submit" loading={sending}>
                    Send message
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Direct addresses" title="Prefer email? Use these" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['Support', 'support@scriptora.app', 'Product questions, bugs and account help.'],
            ['Publishing', 'publishing@scriptora.app', 'Print requirements, ISBNs and file checking.'],
            ['Rights', 'rights@scriptora.app', 'Copyright claims and takedown notices.'],
            ['Press', 'press@scriptora.app', 'Interviews, assets and media enquiries.'],
          ] as const).map(([title, address, body]) => (
            <Card key={title}>
              <CardContent>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1 font-mono text-xs text-primary">{address}</p>
                <p className="mt-2 text-xs text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
