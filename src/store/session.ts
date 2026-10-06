/** Session + UI preference state (zustand with storage persistence). */
import { create } from 'zustand';
import { mutateDatabase, getDatabase } from './db';

const SESSION_KEY = 'scriptora.session.v1';

interface SessionState {
  userId: string | null;
  remember: boolean;
  loaded: boolean;
  restore: () => void;
  signIn: (userId: string, remember?: boolean) => void;
  signOut: () => void;
}

function readSession(): { userId: string | null; remember: boolean } {
  if (typeof window === 'undefined') return { userId: null, remember: false };
  try {
    const raw = window.localStorage.getItem(SESSION_KEY) ?? window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { userId: null, remember: false };
    return JSON.parse(raw);
  } catch {
    return { userId: null, remember: false };
  }
}

export const useSession = create<SessionState>((set) => ({
  userId: null,
  remember: false,
  loaded: false,
  restore: () => {
    const session = readSession();
    const db = getDatabase();
    const exists = session.userId && db.users.some((user) => user.id === session.userId);
    set({ userId: exists ? session.userId : null, remember: session.remember, loaded: true });
  },
  signIn: (userId, remember = true) => {
    const payload = JSON.stringify({ userId, remember });
    try {
      window.localStorage.setItem(SESSION_KEY, remember ? payload : '');
      window.sessionStorage.setItem(SESSION_KEY, payload);
    } catch {
      // storage unavailable — session lives in memory only
    }
    set({ userId, remember, loaded: true });
    mutateDatabase((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (user) user.lastActiveAt = new Date().toISOString();
    });
  },
  signOut: () => {
    try {
      window.localStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    set({ userId: null, loaded: true });
  },
}));
