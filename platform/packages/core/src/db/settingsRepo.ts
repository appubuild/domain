import type { SqlDriver } from './types.js';
import { nowIso } from '../util/time.js';
import { safeParse } from '../util/json.js';

export type SettingsShape = {
  appearance: {
    theme: 'midnight' | 'obsidian' | 'graphite';
    density: 'comfortable' | 'compact';
    reduceMotion: boolean;
    showWorldMonitor: boolean;
    avatarQuality: 'low' | 'medium' | 'high';
  };
  general: {
    launchOnStartup: boolean;
    minimizeToTray: boolean;
    startView: 'dashboard' | 'voice' | 'characters';
    confirmOnExit: boolean;
  };
  voice: {
    autoStartMic: boolean;
    handsFree: boolean;
    vadThreshold: number;
    interruptionEnabled: boolean;
    ttsFallback: boolean;
    wakeWordEnabled: boolean;
    wakeWord: string;
  };
  memory: {
    autoExtractEnabled: boolean;
    autoSummarizeEnabled: boolean;
    retentionDays: number;
    retrievalLimit: number;
    embeddingsEnabled: boolean;
  };
  privacy: {
    telemetryEnabled: boolean;
    logPrompts: boolean;
    retentionDaysForLogs: number;
  };
  hotkeys: {
    activateAssistant: string;
    pushToTalk: string;
    openDashboard: string;
    stopAgent: string;
    toggleVoice: string;
  };
  worldMonitor: {
    timezone: string;
    weatherLocation: string;
    showClock: boolean;
    showWeather: boolean;
    showNews: boolean;
  };
  onboarding: { completed: boolean };
};

export type SettingKey = keyof SettingsShape;

export const DEFAULT_SETTINGS: SettingsShape = {
  appearance: { theme: 'midnight', density: 'comfortable', reduceMotion: false, showWorldMonitor: true, avatarQuality: 'high' },
  general: { launchOnStartup: false, minimizeToTray: true, startView: 'dashboard', confirmOnExit: true },
  voice: {
    autoStartMic: false,
    handsFree: true,
    vadThreshold: 0.55,
    interruptionEnabled: true,
    ttsFallback: true,
    wakeWordEnabled: false,
    wakeWord: 'aura',
  },
  memory: { autoExtractEnabled: true, autoSummarizeEnabled: true, retentionDays: 365, retrievalLimit: 8, embeddingsEnabled: true },
  privacy: { telemetryEnabled: false, logPrompts: false, retentionDaysForLogs: 30 },
  hotkeys: {
    activateAssistant: 'CommandOrControl+Shift+Space',
    pushToTalk: 'CommandOrControl+Shift+V',
    openDashboard: 'CommandOrControl+Shift+D',
    stopAgent: 'Escape',
    toggleVoice: 'CommandOrControl+Shift+M',
  },
  worldMonitor: { timezone: 'local', weatherLocation: '', showClock: true, showWeather: true, showNews: false },
  onboarding: { completed: false },
};

export class SettingsRepo {
  constructor(private readonly db: SqlDriver) {}

  get<K extends SettingKey>(key: K): SettingsShape[K] {
    const row = this.db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (!row) return DEFAULT_SETTINGS[key];
    return safeParse<SettingsShape[K]>(row.value, DEFAULT_SETTINGS[key]);
  }

  set<K extends SettingKey>(key: K, value: SettingsShape[K]): SettingsShape[K] {
    this.db.run(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      [key, JSON.stringify(value), nowIso()],
    );
    return value;
  }

  all(): SettingsShape {
    const out = structuredClone(DEFAULT_SETTINGS);
    for (const row of this.db.all<{ key: string; value: string }>('SELECT key, value FROM app_settings')) {
      if (!(row.key in out)) continue;
      const k = row.key as SettingKey;
      (out as Record<string, unknown>)[k] = { ...(DEFAULT_SETTINGS[k] as object), ...safeParse<object>(row.value, {}) };
    }
    return out;
  }

  merge<K extends SettingKey>(key: K, patch: Partial<SettingsShape[K]>): SettingsShape[K] {
    const next = { ...this.get(key), ...patch } as SettingsShape[K];
    return this.set(key, next);
  }
}
