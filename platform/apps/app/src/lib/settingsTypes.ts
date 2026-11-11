/** Mirrors @aura/core DEFAULT_SETTINGS — the server is authoritative; this is the wire type. */
export type SettingsShape = {
  appearance: { theme: string; density: string; reduceMotion: boolean; showWorldMonitor: boolean; avatarQuality: string };
  general: { launchOnStartup: boolean; minimizeToTray: boolean; startView: string; confirmOnExit: boolean };
  voice: { autoStartMic: boolean; handsFree: boolean; vadThreshold: number; interruptionEnabled: boolean; ttsFallback: boolean; wakeWordEnabled: boolean; wakeWord: string };
  memory: { autoExtractEnabled: boolean; autoSummarizeEnabled: boolean; retentionDays: number; retrievalLimit: number; embeddingsEnabled: boolean };
  privacy: { telemetryEnabled: boolean; logPrompts: boolean; retentionDaysForLogs: number };
  hotkeys: { activateAssistant: string; pushToTalk: string; openDashboard: string; stopAgent: string; toggleVoice: string };
  worldMonitor: { timezone: string; weatherLocation: string; showClock: boolean; showWeather: boolean; showNews: boolean };
  onboarding: { completed: boolean };
};

export type SettingsKey = keyof SettingsShape;
