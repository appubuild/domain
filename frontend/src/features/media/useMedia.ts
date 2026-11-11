/** The media bin's view-model.
 *
 *  MVVM as `ARCHITECTURE.md` §4.1 asks for: the panel renders these fields and
 *  calls these actions, and neither knows how the answers were obtained — which
 *  is what lets `MediaBin` be rendered against a store built around a client
 *  double.
 *
 *  The state itself lives in the **media store** (`stores/media.ts`), because the
 *  inspector reads the same list. What this hook adds is the two things a
 *  *panel* needs on top of it:
 *
 *  * **Load the project's bin when the pane is shown.** The store is window-wide
 *    and holds one project's bin; the bin pane is what says which project that
 *    is, because it is the pane that was handed the project id.
 *  * **Name the selection in the terms a row understands.** `selectedId` and
 *    `select`, so a row can say whether it is the selected one without knowing
 *    what an inspector is.
 */

import { useEffect, useMemo } from 'react';

import type { ImportResponse, MediaAssetSummary } from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import { useMediaStore, useMediaStoreApi } from '../../stores/media';
import type { MediaStatus } from '../../stores/media';
import type { Result } from '../../core/result';

export type { MediaStatus };

export interface MediaBinView {
  readonly assets: readonly MediaAssetSummary[];
  /** How many no longer resolve to a file. Shown, because a bin that says
   *  "12 items" when two of them are gone is a bin that lies. */
  readonly missing: number;
  readonly status: MediaStatus;
  /** Whether an import is in flight. Separate from `status`: a refresh and an
   *  import are different waits, and one spinner for both is a lie about which
   *  one is running. */
  readonly importing: boolean;
  readonly error: ApiProblem | null;
  /** What the last import did, if there has been one. */
  readonly lastImport: ImportResponse | null;
  /** The asset the inspector is describing, by id. */
  readonly selectedId: string | null;
  readonly refresh: () => void;
  readonly importPaths: (paths: readonly string[]) => Promise<Result<ImportResponse, ApiProblem>>;
  readonly select: (assetId: string | null) => void;
}

export function useMedia(projectId: string): MediaBinView {
  const store = useMediaStoreApi();
  const assets = useMediaStore((state) => state.assets);
  const missing = useMediaStore((state) => state.missing);
  const status = useMediaStore((state) => state.status);
  const importing = useMediaStore((state) => state.importing);
  const error = useMediaStore((state) => state.error);
  const lastImport = useMediaStore((state) => state.lastImport);
  const selectedId = useMediaStore((state) => state.selectedId);

  useEffect(() => {
    // Loading is idempotent for the project already held, so a re-render is not
    // a refetch — but a different project is, and that is the point of it.
    void store.getState().load(projectId);
  }, [projectId, store]);

  return useMemo(
    () => ({
      assets,
      missing,
      status,
      importing,
      error,
      lastImport,
      selectedId,
      refresh: () => {
        void store.getState().refresh();
      },
      importPaths: (paths: readonly string[]) => store.getState().importPaths(paths),
      select: (assetId: string | null) => {
        store.getState().select(assetId);
      },
    }),
    [assets, error, importing, lastImport, missing, selectedId, status, store],
  );
}
