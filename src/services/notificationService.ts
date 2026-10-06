import type { AppNotification, EmailEvent, NotificationType } from '@/types/domain';
import { uid } from '@/lib/utils';
import { emailRepo, notificationRepo } from '@/repositories';
import { delay } from '@/lib/utils';
import { getDatabase } from '@/store/db';

const emailTemplates: Record<EmailEvent['template'], { subject: (name: string, meta?: string) => string; body: (name: string, meta?: string) => string }> = {
  welcome: {
    subject: () => 'Welcome to Scriptora — your first book starts here',
    body: (name) => `Hi ${name}, your account is ready. Create a blank project, start from a template, or import a manuscript you have already begun.`,
  },
  'verify-email': {
    subject: () => 'Confirm your email address',
    body: (name) => `${name}, please confirm your email address to enable marketplace payouts and password recovery. This link expires in 24 hours.`,
  },
  'password-reset': {
    subject: () => 'Reset your Scriptora password',
    body: (name) => `We received a request to reset the password for ${name}. If this was you, use the link below. It expires in 30 minutes.`,
  },
  'book-published': {
    subject: (_name, meta) => `${meta ?? 'Your book'} is live`,
    body: (name, meta) => `${meta ?? 'Your book'} passed moderation and is now visible to readers. ${name}, share your author page to start earning.`,
  },
  'book-sale': {
    subject: (_name, meta) => `You made a sale — ${meta ?? 'your book'}`,
    body: (name, meta) => `A reader purchased ${meta ?? 'your book'}. Your earnings are available in the earnings dashboard, ${name}.`,
  },
  'export-completed': {
    subject: () => 'Your export is ready',
    body: (_name, meta) => `${meta ?? 'Your export'} finished rendering. Download it from the export centre.`,
  },
  subscription: {
    subject: (_name, meta) => `Subscription update${meta ? ` — ${meta}` : ''}`,
    body: (name) => `${name}, your subscription details have been updated. You can review billing history at any time.`,
  },
  revenue: {
    subject: (_name, meta) => `Earnings summary — ${meta ?? 'this period'}`,
    body: (name) => `${name}, your earnings summary is ready with a full breakdown of sales, platform fees, refunds and net revenue.`,
  },
  comment: {
    subject: (_name, meta) => `New comment on ${meta ?? 'your book'}`,
    body: (name) => `${name}, a collaborator or reader left a comment. Open the editor to read and reply.`,
  },
  'contact-form': {
    subject: (_name, meta) => `New contact message${meta ? ` — ${meta}` : ''}`,
    body: (name, meta) => `${name}, a contact form submission was received (${meta ?? 'general enquiry'}). Reply within one business day.`,
  },
  system: {
    subject: (_name, meta) => `Scriptora notice${meta ? ` — ${meta}` : ''}`,
    body: (name) => `${name}, this is an important account notice from the Scriptora platform team.`,
  },
};

export const emailService = {
  list(): EmailEvent[] {
    return emailRepo.all();
  },
  async send(params: { to: string; toName: string; template: EmailEvent['template']; meta?: string }): Promise<EmailEvent> {
    const template = emailTemplates[params.template];
    const event: EmailEvent = {
      id: uid('email'),
      to: params.to,
      toName: params.toName,
      template: params.template,
      subject: template.subject(params.toName, params.meta),
      body: template.body(params.toName, params.meta),
      status: 'queued',
      createdAt: new Date().toISOString(),
      opened: false,
    };
    emailRepo.queue(event);
    // Simulate provider delivery.
    setTimeout(() => {
      emailRepo.update(event.id, { status: 'sent' });
    }, 700);
    return event;
  },
  async verifyEmail(userId: string) {
    const db = getDatabase();
    const user = db.users.find((entry) => entry.id === userId);
    if (user) await emailService.send({ to: user.email, toName: user.name, template: 'verify-email' });
  },
};

export const notificationService = {
  list(userId: string): AppNotification[] {
    return notificationRepo.forUser(userId);
  },
  unreadCount(userId: string) {
    return notificationService.list(userId).filter((notification) => !notification.read).length;
  },
  async push(userId: string, params: { type: NotificationType; title: string; body: string; link?: string; priority?: AppNotification['priority'] }) {
    await delay(80);
    return notificationRepo.add({
      id: uid('notif'),
      userId,
      type: params.type,
      title: params.title,
      body: params.body,
      read: false,
      createdAt: new Date().toISOString(),
      link: params.link,
      priority: params.priority ?? 'normal',
    });
  },
  markRead(id: string) {
    notificationRepo.markRead(id, true);
  },
  markUnread(id: string) {
    notificationRepo.markRead(id, false);
  },
  markAllRead(userId: string) {
    notificationRepo.markAllRead(userId);
  },
  remove(id: string) {
    notificationRepo.remove(id);
  },
  clear(userId: string) {
    notificationRepo.clearAll(userId);
  },
};
