import { create } from 'zustand';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Character, Conversation, Health, SystemInfo, Template, UsageSummary } from '@/lib/types';
import type { ToastMessage } from '@/components/ui';

export type ConnectionState = 'connecting' | 'online' | 'offline';

type AppState = {
  ready: boolean;
  connection: ConnectionState;
  health: Health | null;
  system: SystemInfo | null;
  characters: Character[];
  templates: Template[];
  activeCharacterId: string | null;
  defaultCharacterId: string | null;
  conversations: Conversation[];
  usage: UsageSummary | null;
  emergencyStop: boolean;
  toasts: ToastMessage[];

  bootstrap(): Promise<void>;
  refreshHealth(): Promise<void>;
  refreshCharacters(): Promise<void>;
  refreshTemplates(): Promise<void>;
  refreshConversations(): Promise<void>;
  refreshUsage(): Promise<void>;
  setActiveCharacter(id: string): void;
  setEmergencyStop(engaged: boolean): Promise<void>;
  patchCharacter(id: string, patch: Record<string, unknown>): Promise<Character>;
  toast(t: Omit<ToastMessage, 'id'>): void;
  dismissToast(id: string): void;
};

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  connection: 'connecting',
  health: null,
  system: null,
  characters: [],
  templates: [],
  activeCharacterId: null,
  defaultCharacterId: null,
  conversations: [],
  usage: null,
  emergencyStop: false,
  toasts: [],

  async bootstrap() {
    const [health, system] = await Promise.allSettled([apiGet<Health>('/health'), apiGet<SystemInfo>('/system/info')]);
    if (health.status === 'rejected') {
      set({ connection: 'offline', ready: true });
      return;
    }
    set({
      health: health.value,
      system: system.status === 'fulfilled' ? system.value : null,
      connection: 'online',
    });
    await Promise.all([get().refreshCharacters(), get().refreshTemplates()]);
    const saved = localStorage.getItem('aura.activeCharacter');
    const chars = get().characters;
    const active = (saved && chars.some((c) => c.id === saved) ? saved : null) ?? get().defaultCharacterId ?? chars[0]?.id ?? null;
    set({ activeCharacterId: active, ready: true });
    if (active) void get().refreshConversations();
  },

  async refreshHealth() {
    try {
      const health = await apiGet<Health>('/health');
      set({ health, connection: 'online' });
    } catch {
      set({ connection: 'offline', health: null });
    }
  },

  async refreshCharacters() {
    const res = await apiGet<{ characters: Character[]; defaultId: string | null }>('/characters');
    set({ characters: res.characters, defaultCharacterId: res.defaultId });
    const cur = get().activeCharacterId;
    if (!cur || !res.characters.some((c) => c.id === cur)) {
      const next = res.defaultId ?? res.characters[0]?.id ?? null;
      if (next) get().setActiveCharacter(next);
      else set({ activeCharacterId: null });
    }
  },

  async refreshTemplates() {
    const res = await apiGet<{ templates: Template[] }>('/characters/templates');
    set({ templates: res.templates });
  },

  async refreshConversations() {
    const id = get().activeCharacterId;
    const res = await apiGet<{ conversations: Conversation[] }>(`/conversations${id ? `?characterId=${id}` : ''}`);
    set({ conversations: res.conversations });
  },

  async refreshUsage() {
    try {
      const res = await apiGet<{ usage: UsageSummary }>('/usage');
      set({ usage: res.usage });
    } catch {
      /* usage is non-critical */
    }
  },

  setActiveCharacter(id: string) {
    localStorage.setItem('aura.activeCharacter', id);
    set({ activeCharacterId: id });
    void get().refreshConversations();
  },

  async setEmergencyStop(engaged: boolean) {
    const res = await apiPost<{ engaged: boolean }>('/permissions/emergency-stop', { engage: engaged });
    set({ emergencyStop: res.engaged });
    get().toast({
      title: res.engaged ? 'Emergency stop engaged' : 'Emergency stop released',
      description: res.engaged ? 'All agent actions are blocked until you release it.' : 'Agent actions follow your permission settings again.',
      tone: res.engaged ? 'error' : 'success',
    });
  },

  async patchCharacter(id, patch) {
    const res = await apiPatch<{ character: Character }>(`/characters/${id}`, patch);
    set({ characters: get().characters.map((c) => (c.id === id ? res.character : c)) });
    return res.character;
  },

  toast(t) {
    const id = `t${++toastSeq}`;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.tone === 'error' ? 8000 : 4500);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export function useActiveCharacter(): Character | null {
  return useApp((s) => s.characters.find((c) => c.id === s.activeCharacterId) ?? null);
}
