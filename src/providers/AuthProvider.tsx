import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '@/types/domain';
import { useSession } from '@/store/session';
import { getDatabase, subscribeDatabase } from '@/store/db';
import { userRepo } from '@/repositories';
import { authService, type AuthResult } from '@/services/authService';
import { buildEntitlements, type Entitlements } from '@/services/entitlements';
import { appQueryClient } from './AppProviders';

interface AuthContextValue {
  user: User | undefined;
  userId: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  entitlements: Entitlements;
  loading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<AuthResult>;
  loginWithProvider: (provider: 'google' | 'apple' | 'github') => Promise<AuthResult>;
  register: (input: { name: string; email: string; password: string; username?: string; role?: string }) => Promise<AuthResult>;
  logout: () => void;
  refresh: () => void;
  updateUser: (patch: Partial<User>) => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const userId = useSession((state) => state.userId);
  const loaded = useSession((state) => state.loaded);
  const restore = useSession((state) => state.restore);
  const signIn = useSession((state) => state.signIn);
  const signOut = useSession((state) => state.signOut);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    restore();
  }, [restore]);

  React.useEffect(() => {
    const unsubscribe = subscribeDatabase(() => setVersion((value) => value + 1));
    return () => {
      unsubscribe();
    };
  }, []);

  const user = React.useMemo(
    () => (loaded && userId ? userRepo.find(userId) : undefined),
    [loaded, userId, version],
  );

  const refresh = React.useCallback(() => {
    setVersion((value) => value + 1);
    void appQueryClient.invalidateQueries();
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      userId: user?.id ?? null,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'admin' || user?.role === 'moderator',
      entitlements: buildEntitlements(user),
      loading: !loaded,
      login: async (email, password, remember = true) => {
        const result = await authService.login(email, password);
        signIn(result.user.id, remember);
        refresh();
        return result;
      },
      loginWithProvider: async (provider) => {
        const result = await authService.loginWithProvider(provider);
        signIn(result.user.id, true);
        refresh();
        return result;
      },
      register: async (input) => {
        const result = await authService.register(input);
        signIn(result.user.id, true);
        refresh();
        return result;
      },
      logout: () => {
        signOut();
        refresh();
        navigate('/');
      },
      refresh,
      updateUser: (patch) => {
        if (!user) return;
        userRepo.update(user.id, patch);
        refresh();
      },
    }),
    [user, loaded, signIn, signOut, navigate, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export { getDatabase };
