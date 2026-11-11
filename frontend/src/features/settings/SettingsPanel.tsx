/** The settings panel: what this project renders and mixes to.
 *
 *  Every editor has this panel, and it is where two habits do damage, so the
 *  panel is built around not having them:
 *
 *  **It does not post on every keystroke.** A frame width typed one digit at a
 *  time would journal `1`, `19`, `192`, `1920` — four undo entries for one
 *  decision, and a Ctrl+Z that takes four presses to undo something the user
 *  thinks of as one thing. The number fields are committed on blur or Enter,
 *  and only when the value actually changed.
 *
 *  **It does not decide what is allowed.** Every refusal in this panel is the
 *  service's, printed in the service's own words. A panel that greyed out three
 *  channels because *it* knew would be a second place that rule lives, and the
 *  second place is the one that is wrong after the export presets change.
 *
 *  **It says what a frame change means before the user makes it.** A layer
 *  positioned 100 px from the centre stays 100 px from the centre of a
 *  different frame — the preview is this frame drawn smaller, and nothing
 *  moves. That is the one sentence a user needs before dropping a 4K project to
 *  1080p, so it is written under the heading rather than left to be discovered.
 *
 *  **An odd dimension is called out, not refused.** It is legal today and it
 *  fails at export for 4:2:0, which is a thing to say before the render and not
 *  a thing to block behind the user's back.
 */

import { useEffect, useState } from 'react';

import { useI18n } from '../../core/i18n/context';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { useToastQueue } from '../../ui/toast-context';
import { Panel } from '../../ui/Panel';
import { Select, type SelectOption } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { TextField } from '../../ui/TextField';
import { FRAME_PRESETS, aspectDecimal, aspectLabel, presetFor } from './frames';
import { useProjectSettings } from './useProjectSettings';

/** The channel counts we mix, and the key each one is called by.
 *
 *  The same four the domain accepts, listed here because a drop-down has to have
 *  something in it — but the *refusal* is still the service's, so a drift here is
 *  a confusing panel and not a broken one. The key is a literal rather than a
 *  template string because `t()` takes a union of the bundle's keys, which is
 *  what makes a typo a build failure instead of a panel that says
 *  `settings.channel_4`. */
const CHANNELS: readonly {
  readonly value: number;
  readonly label:
    'settings.channel_1' | 'settings.channel_2' | 'settings.channel_6' | 'settings.channel_8';
}[] = [
  { value: 1, label: 'settings.channel_1' },
  { value: 2, label: 'settings.channel_2' },
  { value: 6, label: 'settings.channel_6' },
  { value: 8, label: 'settings.channel_8' },
];

/** The sample rates we offer. Two, because they are the two that exist in
 *  practice: 48 kHz is everything shot for picture, 44.1 kHz is music. */
const SAMPLE_RATES: readonly number[] = [44_100, 48_000];

/** The working spaces we offer, as the matrix coefficients the service speaks. */
const WORKING_SPACES: readonly {
  readonly value: number;
  readonly label: 'settings.space_1' | 'settings.space_6' | 'settings.space_9';
}[] = [
  { value: 1, label: 'settings.space_1' },
  { value: 6, label: 'settings.space_6' },
  { value: 9, label: 'settings.space_9' },
];

export interface SettingsPanelProps {
  readonly projectId: string;
}

export function SettingsPanel({ projectId }: SettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const view = useProjectSettings(projectId);
  const toasts = useToastQueue();
  const { settings } = view;

  const frame = settings?.frame_size;
  const width = frame?.width ?? 0;
  const height = frame?.height ?? 0;
  const preset = frame === undefined ? null : presetFor(width, height);

  return (
    <Panel
      title={t('settings.heading')}
      className="h-full"
      actions={
        <>
          <IconButton
            icon="undo"
            label={t('settings.undo')}
            size="sm"
            variant="ghost"
            disabled={view.history?.can_undo !== true}
            onClick={() => {
              void view.undo().then((result) => {
                // An empty stack is not a failure, so it is not an error — but
                // a button that does nothing when pressed is a button the user
                // presses again, harder.
                if (result.ok && !result.value) {
                  toasts.push({ kind: 'info', message: t('settings.nothingToUndo') });
                }
              });
            }}
          />
          <IconButton
            icon="redo"
            label={t('settings.redo')}
            size="sm"
            variant="ghost"
            disabled={view.history?.can_redo !== true}
            onClick={() => {
              void view.redo();
            }}
          />
        </>
      }
    >
      {settings === null ? (
        <p className="text-sm text-ink-faint">
          {view.status === 'error'
            ? t('settings.unavailable', { code: view.error?.code ?? '—' })
            : t('settings.loading')}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2.5">
            <SectionHeading>{t('settings.frame')}</SectionHeading>
            <p className="text-xs text-ink-faint">{t('settings.frameHint')}</p>

            <Select
              label={t('settings.preset')}
              size="sm"
              value={preset?.id ?? ''}
              placeholder={t('settings.presetCustom')}
              options={FRAME_PRESETS.map((option) => ({
                value: option.id,
                label: `${option.width} × ${option.height}`,
              }))}
              onValueChange={(id) => {
                const chosen = FRAME_PRESETS.find((option) => option.id === id);
                if (chosen === undefined) return;
                void view.patch({ frame_size: { width: chosen.width, height: chosen.height } });
              }}
            />

            <div className="grid grid-cols-2 gap-2">
              <DimensionField
                label={t('settings.width')}
                value={width}
                onCommit={(next) => {
                  void view.patch({ frame_size: { width: next, height } });
                }}
              />
              <DimensionField
                label={t('settings.height')}
                value={height}
                onCommit={(next) => {
                  void view.patch({ frame_size: { width, height: next } });
                }}
              />
            </div>

            <p className="font-mono text-xs tabular-nums text-ink-dim">
              {t('settings.aspect')}: {aspectLabel(width, height)} · {aspectDecimal(width, height)}
            </p>

            {settings.even_dimensions ? null : (
              <p className="text-xs text-warning" role="status">
                {t('settings.oddDimensions')}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2.5">
            <SectionHeading>{t('settings.audio')}</SectionHeading>
            <Select
              label={t('settings.sampleRate')}
              size="sm"
              value={String(settings.sample_rate)}
              options={SAMPLE_RATES.map(toRateOption)}
              onValueChange={(value) => {
                void view.patch({ sample_rate: Number(value) });
              }}
            />
            <Select
              label={t('settings.channels')}
              size="sm"
              value={String(settings.channels)}
              options={CHANNELS.map((channel) => ({
                value: String(channel.value),
                label: t(channel.label),
              }))}
              onValueChange={(value) => {
                void view.patch({ channels: Number(value) });
              }}
            />
          </section>

          <section className="flex flex-col gap-2.5">
            <SectionHeading>{t('settings.colour')}</SectionHeading>
            <Select
              label={t('settings.workingSpace')}
              size="sm"
              value={String(settings.working_colour_space)}
              options={WORKING_SPACES.map((space) => ({
                value: String(space.value),
                label: t(space.label),
              }))}
              onValueChange={(value) => {
                void view.patch({ working_colour_space: Number(value) });
              }}
            />
          </section>

          <section className="flex flex-col gap-2.5">
            <SectionHeading>{t('settings.preview')}</SectionHeading>
            <Switch
              label={t('settings.useProxies')}
              hint={t('settings.useProxiesHint')}
              checked={settings.use_proxies}
              onCheckedChange={(next) => {
                void view.patch({ use_proxies: next });
              }}
            />
          </section>

          {view.error === null ? null : (
            <p className="text-xs text-danger" role="alert">
              {t('settings.refused', { detail: view.error.detail })}
            </p>
          )}

          {view.lastSummary === null ? null : (
            // A sentence from the service about what it just did: a change that
            // says nothing looks like a change that did nothing.
            <p className="text-xs text-ink-faint" role="status">
              {view.lastSummary}
            </p>
          )}

          {view.error === null ? null : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                view.refresh();
              }}
            >
              {t('settings.retry')}
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

/** One number field that commits on blur or Enter, and only when it changed. */
function DimensionField({
  label,
  value,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly onCommit: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));

  // Re-synced whenever the service answers with a different number: without
  // this, an undo would leave the field showing what the user typed rather
  // than what the settings are now.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit(): void {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      // Put back, rather than left showing something the settings are not.
      setDraft(String(value));
      return;
    }
    if (parsed === value) return;
    onCommit(parsed);
  }

  return (
    <TextField
      label={label}
      size="sm"
      inputMode="numeric"
      value={draft}
      onValueChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
      }}
    />
  );
}

const HEADING_CLASS = 'text-xs font-semibold uppercase tracking-wide text-ink-faint';

function SectionHeading({ children }: { readonly children: string }): React.JSX.Element {
  return <h3 className={HEADING_CLASS}>{children}</h3>;
}

function toRateOption(rate: number): SelectOption {
  return { value: String(rate), label: `${rate / 1000} kHz` };
}
