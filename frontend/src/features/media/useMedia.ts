/** The media bin's view-model.
 *
 *  MVVM as `ARCHITECTURE.md` §4.1 asks for: the panel renders these fields and
 *  calls these actions, and neither knows how the answers were obtained — which
 *  is what lets `MediaBin` be rendered against a client double.
 *
 *  Two things it decides:
 *
 *  * **A failed read never empties the bin.** A refresh that failed keeps the
 *    assets it had and records the problem. A network hiccup is not the same as
 *    "you imported nothing", and a panel that shows the second for the first is
 *    a panel that makes people re-import.
 *  * **An import is a report, not a verdict.** The service answers 200 with what
 *    came in, what was already there and what failed, because a batch of forty
 *    files cannot fail as a batch. The last report is kept here, and the panel
 *    is what decides how to say it.
 *
 *  Refetches are guarded by a live flag and aborted on unmount: a request that
 *  answered after its panel was gone would be writing to a tree that is not
 *  there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '../../core/api/context';
import type { ImportResponse, MediaAssetSummary } from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import { err, ok, type Result } from '../../core/result';

export type MediaStatus = 'idle' | 'loading' | 'ready' | 'error';

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
  readonly refresh: () => void;
  readonly importPaths: (paths: readonly string[]) => Promise<Result<ImportResponse, ApiProblem>>;
}

export function useMedia(projectId: string): MediaBinView {
  const client = useApi();
  const [assets, setAssets] = useState<readonly MediaAssetSummary[]>([]);
  const [missing, setMissing] = useState(0);
  const [status, setStatus] = useState<MediaStatus>('idle');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<ApiProblem | null>(null);
  const [lastImport, setLastImport] = useState<ImportResponse | null>(null);

  // One controller, held: a second refresh aborts the first, and unmount aborts
  // whatever is still running. A request that answered after its panel was gone
  // would be writing to a tree that is not there.
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setStatus('loading');
    void client
      .run('listMedia', { params: { project_id: projectId }, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          // Kept, not cleared: what we have is still the best answer we have.
          setStatus('error');
          setError(result.error);
          return;
        }
        setAssets(result.value.assets);
        setMissing(result.value.missing);
        setStatus('ready');
        setError(null);
      });
  }, [client, projectId]);

  useEffect(() => {
    refresh();
    return () => {
      inflight.current?.abort();
    };
  }, [refresh]);

  const importPaths = useCallback(
    async (paths: readonly string[]): Promise<Result<ImportResponse, ApiProblem>> => {
      setImporting(true);
      const result = await client.run('importMedia', {
        params: { project_id: projectId },
        body: { paths: [...paths] },
      });
      setImporting(false);
      if (!result.ok) return err(result.error);
      setLastImport(result.value);
      // Asked again rather than spliced in: the service decides what an asset
      // is, and a panel that invented the summary would be a second opinion.
      refresh();
      return ok(result.value);
    },
    [client, projectId, refresh],
  );

  return useMemo(
    () => ({
      assets,
      missing,
      status,
      importing,
      error,
      lastImport,
      refresh,
      importPaths,
    }),
    [assets, error, importPaths, importing, lastImport, missing, refresh, status],
  );
}
