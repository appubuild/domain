import type { ID, Invoice, Plan, Subscription, User, UserSettings } from '@/types/domain';
import { getDatabase, mutateDatabase } from '@/store/db';

export const userRepo = {
  all(): User[] {
    return getDatabase().users;
  },
  find(id: ID | null | undefined): User | undefined {
    if (!id) return undefined;
    return getDatabase().users.find((user) => user.id === id);
  },
  findByEmail(email: string): User | undefined {
    const lower = email.trim().toLowerCase();
    return getDatabase().users.find((user) => user.email.toLowerCase() === lower);
  },
  findByUsername(username: string): User | undefined {
    const lower = username.trim().toLowerCase().replace(/^@/, '');
    return getDatabase().users.find((user) => user.username.toLowerCase() === lower);
  },
  create(user: User) {
    return mutateDatabase((db) => {
      db.users = [user, ...db.users];
      return user;
    });
  },
  update(id: ID, patch: Partial<User>) {
    return mutateDatabase((db) => {
      const index = db.users.findIndex((user) => user.id === id);
      if (index === -1) return undefined;
      db.users[index] = { ...db.users[index], ...patch };
      return db.users[index];
    });
  },
  updateSettings(id: ID, patch: Partial<UserSettings>) {
    return mutateDatabase((db) => {
      const index = db.users.findIndex((user) => user.id === id);
      if (index === -1) return undefined;
      const next = { ...db.users[index].settings, ...patch };
      db.users[index] = { ...db.users[index], settings: next };
      return db.users[index];
    });
  },
  remove(id: ID) {
    return mutateDatabase((db) => {
      db.users = db.users.filter((user) => user.id !== id);
    });
  },
  // ------------------------------------------------------------ plans/billing
  plans(): Plan[] {
    return [...getDatabase().plans].sort((a, b) => a.order - b.order);
  },
  plan(id: ID | undefined): Plan | undefined {
    return getDatabase().plans.find((plan) => plan.id === id);
  },
  updatePlan(id: ID, patch: Partial<Plan>) {
    return mutateDatabase((db) => {
      const index = db.plans.findIndex((plan) => plan.id === id);
      if (index === -1) return undefined;
      db.plans[index] = { ...db.plans[index], ...patch };
      return db.plans[index];
    });
  },
  createPlan(plan: Plan) {
    return mutateDatabase((db) => {
      db.plans = [...db.plans, plan];
      return plan;
    });
  },
  removePlan(id: ID) {
    return mutateDatabase((db) => {
      db.plans = db.plans.filter((plan) => plan.id !== id);
    });
  },
  subscriptionFor(userId: ID): Subscription | undefined {
    const db = getDatabase();
    const active = db.subscriptions.find((sub) => sub.userId === userId && sub.status !== 'canceled');
    return active ?? db.subscriptions.find((sub) => sub.userId === userId);
  },
  subscriptions(): Subscription[] {
    return getDatabase().subscriptions;
  },
  upsertSubscription(subscription: Subscription) {
    return mutateDatabase((db) => {
      const index = db.subscriptions.findIndex((sub) => sub.id === subscription.id);
      if (index === -1) db.subscriptions = [subscription, ...db.subscriptions];
      else db.subscriptions[index] = subscription;
      return subscription;
    });
  },
  invoices(userId?: ID): Invoice[] {
    const invoices = getDatabase().invoices;
    return (userId ? invoices.filter((invoice) => invoice.userId === userId) : invoices).sort(
      (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
    );
  },
  addInvoice(invoice: Invoice) {
    return mutateDatabase((db) => {
      db.invoices = [invoice, ...db.invoices];
      return invoice;
    });
  },
  updateInvoice(id: ID, patch: Partial<Invoice>) {
    return mutateDatabase((db) => {
      const index = db.invoices.findIndex((invoice) => invoice.id === id);
      if (index === -1) return undefined;
      db.invoices[index] = { ...db.invoices[index], ...patch };
      return db.invoices[index];
    });
  },
};
