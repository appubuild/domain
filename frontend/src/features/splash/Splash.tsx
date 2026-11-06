/** The first thing a user sees, and the first thing that can be wrong.
 *
 * It has exactly one job: say whether the editor is there. Which is why it asks
 * `/api/v1/system/info` — the one endpoint the shell needs before it has a
 * project — and why every state is spelled out rather than left implied: a
 * splash screen that hangs on "Starting…" forever is indistinguishable from a
 * crash, and the user deserves to be told which one it is.
 */

import { useApi } from '../../core/api/context';
import { useServiceInfo } from './useServiceInfo';

export function Splash(): React.JSX.Element {
  const client = useApi();
  const state = useServiceInfo(client);

  return (
    <main className="flex h-full items-center justify-center">
      <section className="w-[28rem] rounded-panel border border-line bg-surface-1 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Nova Studio</h1>

        {state.kind === 'connecting' ? (
          <p className="mt-2 text-sm text-ink-dim" role="status">
            Starting the editor…
          </p>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            <p className="mt-2 text-sm text-ink-dim" role="status">
              Ready.
            </p>
            <dl className="mt-6 space-y-1 text-sm">
              <Row label="Service" value={state.info.version} />
              <Row label="Project format" value={`v${state.info.project_format_version}`} />
              <Row label="Data" value={state.info.data_dir} />
            </dl>
          </>
        ) : null}

        {state.kind === 'unreachable' ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {state.problem.code === 'transport/timeout'
              ? 'The editor did not answer. It may still be starting.'
              : `The editor is unreachable (${state.problem.code}).`}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function Row({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="truncate font-mono text-xs text-ink-dim">{value}</dd>
    </div>
  );
}
