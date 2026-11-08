/** The first thing a user sees, and the first thing that can be wrong.
 *
 *  It has exactly one job: say whether the editor is there. Which is why every
 *  state is spelled out rather than left implied: a splash screen that hangs on
 *  "Starting…" forever is indistinguishable from a crash, and the user deserves
 *  to be told which one it is.
 *
 *  The state arrives as a prop rather than being fetched here, because the
 *  window asks the same question the splash answers — a splash that called the
 *  service itself would make every boot two requests instead of one.
 */

import { useI18n } from '../../core/i18n/context';
import type { ServiceState } from './useServiceInfo';

export function Splash({ state }: { readonly state: ServiceState }): React.JSX.Element {
  // Every string on this screen is a message key, including the product's own
  // name. The rule is not "English is the default": English is one bundle, and a
  // literal here is a string no translator can ever reach.
  const { t } = useI18n();

  return (
    <main className="flex h-full items-center justify-center">
      <section className="w-[28rem] rounded-panel border border-line bg-surface-1 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('app.name')}</h1>

        {state.kind === 'connecting' ? (
          <p className="mt-2 text-sm text-ink-dim" role="status">
            {t('splash.starting')}
          </p>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            <p className="mt-2 text-sm text-ink-dim" role="status">
              {t('splash.ready')}
            </p>
            <dl className="mt-6 space-y-1 text-sm">
              <Row label={t('splash.service')} value={state.info.version} />
              <Row
                label={t('splash.projectFormat')}
                value={`v${state.info.project_format_version}`}
              />
              <Row label={t('splash.dataDir')} value={state.info.data_dir} />
            </dl>
          </>
        ) : null}

        {state.kind === 'unreachable' ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {state.problem.code === 'transport/timeout'
              ? t('splash.unreachableTimeout')
              : t('splash.unreachable', { code: state.problem.code })}
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
