/** The settings panel's view-model.
 *
 *  MVVM as `ARCHITECTURE.md` §4.1 asks for: the panel renders these fields and
 *  calls these actions, and neither knows how the answers were obtained — which
 *  is what lets `SettingsPanel` be rendered against a store built around a
 *  client double.
 *
 *  The state lives in the **settings store** (`stores/settings.ts`). What this
 *  hook adds is the one thing a *pane* needs on top of it: it says which
 *  project's settings these are, because it is the pane that was handed the
 *  project id — the store is window-wide, and a store that guessed would show
 *  the previous project's frame size under the new project's name.
 *
 *  Nothing here decides whether a setting is allowed. The service does, and the
 *  refusal comes back as an `ApiProblem` the panel prints in the service's own
 *  words.
 */

import { useEffect, useMemo } from 'react';

import type { HistorySummary, SettingsSummary } from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import type { Result } from '../../core/result';
import {
  useSettingsStore,
  useSettingsStoreApi,
  type SettingsPatch,
  type SettingsStatus,
} from '../../stores/settings';

export type { SettingsPatch, SettingsStatus };

export interface ProjectSettingsView {
  readonly settings: SettingsSummary | null;
  /** The settings stack: what this panel's undo and redo would do. Read from
   *  the service, never counted here — a panel whose Ctrl+Z disagreed with the
   *  service's would be a panel that undoes nothing and says it did. */
  readonly history: HistorySummary | null;
  readonly status: SettingsStatus;
  readonly error: ApiProblem | null;
  /** What the last change did, in the service's own words. */
  readonly lastSummary: string | null;
  readonly dirty: boolean;
  readonly patch: (change: SettingsPatch) => Promise<Result<unknown, ApiProblem>>;
  readonly undo: () => Promise<Result<boolean, ApiProblem>>;
  readonly redo: () => Promise<Result<boolean, ApiProblem>>;
  readonly refresh: () => void;
}

export function useProjectSettings(projectId: string): ProjectSettingsView {
  const store = useSettingsStoreApi();
  const settings = useSettingsStore((state) => state.settings);
  const history = useSettingsStore((state) => state.history);
  const status = useSettingsStore((state) => state.status);
  const error = useSettingsStore((state) => state.error);
  const lastSummary = useSettingsStore((state) => state.lastSummary);
  const dirty = useSettingsStore((state) => state.dirty);

  useEffect(() => {
    // Idempotent for the project already held, so a re-render is not a refetch;
    // a different project is a load, and that is the point of it.
    void store.getState().load(projectId);
  }, [projectId, store]);

  return useMemo(
    () => ({
      settings,
      history,
      status,
      error,
      lastSummary,
      dirty,
      patch: async (change: SettingsPatch) => await store.getState().patch(change),
      undo: () => store.getState().undo(),
      redo: () => store.getState().redo(),
      refresh: () => {
        void store.getState().refresh();
      },
    }),
    [dirty, error, history, lastSummary, settings, status, store],
  );
}
