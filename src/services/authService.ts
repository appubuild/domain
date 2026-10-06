import type { User } from '@/types/domain';
import { delay, uid } from '@/lib/utils';
import { getDatabase } from '@/store/db';
import { userRepo } from '@/repositories';
import { defaultSettings } from '@/data/seedPeople';
import { emailService } from './notificationService';

export interface AuthResult {
  user: User;
  token: string;
}

export class AuthError extends Error {
  code: 'invalid-credentials' | 'email-taken' | 'suspended' | 'not-found' | 'weak-password';
  constructor(code: AuthError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

function issueToken(user: User) {
  return `mock.${btoa(`${user.id}:${Date.now()}`)}`;
}

const AVATAR_SEEDS = ['aurora', 'ember', 'forest', 'ocean', 'plum', 'sand'];

export const authService = {
  async login(email: string, password: string): Promise<AuthResult> {
    await delay(520);
    const user = userRepo.findByEmail(email);
    if (!user) throw new AuthError('invalid-credentials', 'We could not find an account with that email address.');
    if (user.password !== password) throw new AuthError('invalid-credentials', 'That password is not correct. Try again or reset it.');
    if (user.status === 'suspended') throw new AuthError('suspended', 'This account has been suspended. Contact support for details.');
    userRepo.update(user.id, { lastActiveAt: new Date().toISOString() });
    return { user: { ...user }, token: issueToken(user) };
  },
  async register(params: { name: string; email: string; password: string; username?: string; role?: string }): Promise<AuthResult> {
    await delay(680);
    if (userRepo.findByEmail(params.email)) throw new AuthError('email-taken', 'An account already exists with that email address.');
    if (params.password.length < 8) throw new AuthError('weak-password', 'Passwords must be at least 8 characters.');

    const baseUsername =
      params.username?.trim() ||
      params.name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .slice(0, 2)
        .join('');
    let username = baseUsername || 'writer';
    let suffix = 1;
    while (userRepo.findByUsername(username)) {
      suffix += 1;
      username = `${baseUsername}${suffix}`;
    }

    const user: User = {
      id: uid('user'),
      email: params.email.trim(),
      password: params.password,
      name: params.name.trim(),
      username,
      role: 'user',
      status: 'active',
      avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(params.name)}`,
      bio: '',
      tagline: '',
      website: '',
      social: {},
      country: 'United States',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      planId: 'plan_free',
      onboarded: false,
      isAuthor: params.role === 'author' || params.role === 'publisher',
      followers: 0,
      following: 0,
      storageUsedBytes: 9 * 1024 * 1024,
      aiCreditsUsed: 0,
      aiImageCreditsUsed: 0,
      usagePeriodStart: new Date().toISOString(),
      settings: defaultSettings(),
      emailVerified: false,
    };
    userRepo.create(user);
    await emailService.send({ to: user.email, toName: user.name, template: 'welcome' });
    void AVATAR_SEEDS;
    return { user, token: issueToken(user) };
  },
  async loginWithProvider(provider: 'google' | 'apple' | 'github'): Promise<AuthResult> {
    await delay(700);
    // Social login-ready architecture: in Phase 1 this maps to a demonstration account.
    const demo = userRepo.findByEmail('demo@scriptora.app') as User;
    void provider;
    return { user: demo, token: issueToken(demo) };
  },
  async forgotPassword(email: string): Promise<{ sent: boolean; hint?: string }> {
    await delay(520);
    const user = userRepo.findByEmail(email);
    if (!user) {
      // Never reveal whether an account exists.
      return { sent: true };
    }
    await emailService.send({ to: user.email, toName: user.name, template: 'password-reset' });
    return { sent: true, hint: user.email };
  },
  async resetPassword(email: string, newPassword: string): Promise<void> {
    await delay(560);
    const user = userRepo.findByEmail(email);
    if (!user) throw new AuthError('not-found', 'That reset link is no longer valid.');
    if (newPassword.length < 8) throw new AuthError('weak-password', 'Passwords must be at least 8 characters.');
    userRepo.update(user.id, { password: newPassword });
  },
  async verifyEmail(userId: string): Promise<void> {
    await delay(400);
    userRepo.update(userId, { emailVerified: true });
  },
  async resendVerification(userId: string) {
    const user = userRepo.find(userId);
    if (user) await emailService.send({ to: user.email, toName: user.name, template: 'verify-email' });
  },
  currentUser(userId: string | null): User | undefined {
    return userRepo.find(userId);
  },
  async changePassword(userId: string, current: string, next: string) {
    await delay(500);
    const user = userRepo.find(userId);
    if (!user) throw new AuthError('not-found', 'Account not found.');
    if (user.password !== current) throw new AuthError('invalid-credentials', 'Your current password is incorrect.');
    if (next.length < 8) throw new AuthError('weak-password', 'Passwords must be at least 8 characters.');
    userRepo.update(userId, { password: next });
  },
  demoAccounts() {
    return getDatabase()
      .users.filter((user) => ['user_demo', 'user_admin', 'user_mod'].includes(user.id))
      .map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, planId: user.planId }));
  },
};
