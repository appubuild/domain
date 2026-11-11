/** The title bar: what this window is, and the two controls that belong to the
 *  window rather than to a project.
 *
 *  Deliberately not a fake operating-system title bar. Minimize, maximize and
 *  close are the desktop shell's to draw, and they arrive with it (stage 11);
 *  a web page that painted its own close button would be a web page that
 *  closes the tab instead. What is here is what no platform gives us: the name
 *  of the project, and the window's own settings.
 */

import { useTheme } from '../../core/theme/context';
import { useI18n } from '../../core/i18n/context';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Menu, type MenuItem } from '../../ui/Menu';
import { useAnchoredMenu } from '../../ui/useAnchoredMenu';

export interface TitleBarProps {
  /** The project the window is showing, or `null` when it is showing none. */
  readonly projectName: string | null;
  readonly projectDirty?: boolean | undefined;
  readonly onOpenPalette: () => void;
}

export function TitleBar({
  projectName,
  projectDirty = false,
  onOpenPalette,
}: TitleBarProps): React.JSX.Element {
  const { t } = useI18n();
  const { theme, themes, setThemeById } = useTheme();
  const themeMenu = useAnchoredMenu();

  const items: readonly MenuItem[] = themes.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    // A tick rather than a radio role: the menu is a list of commands, and the
    // one in force is named by the tick rather than by a second widget.
    ...(candidate.id === theme.id ? { icon: 'check' as const } : {}),
    onSelect: () => {
      setThemeById(candidate.id);
    },
  }));

  return (
    <header className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-3">
      <span className="text-xs font-semibold tracking-wide text-ink">{t('app.name')}</span>

      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-dim">
        <span className="truncate">{projectName ?? t('shell.titleBar.noProject')}</span>
        {projectDirty ? (
          // A dot and not a red title: the project's name is how you find it,
          // and turning the name red is how you make it hard to read.
          <span
            className="size-1.5 shrink-0 rounded-full bg-warning"
            title={t('shell.status.unsaved')}
          />
        ) : null}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <IconButton
          icon="search"
          label={t('shell.titleBar.commands')}
          variant="ghost"
          onClick={onOpenPalette}
        />
        <Button
          variant="ghost"
          size="sm"
          iconEnd="chevron-down"
          {...themeMenu.triggerProps}
          // Right-aligned: the trigger is at the edge of the window, and a menu
          // that opened off-screen would be a menu that did not open.
        >
          {t('shell.titleBar.theme')}
        </Button>
        <Menu
          open={themeMenu.isOpen}
          align="end"
          anchor={themeMenu.anchor}
          trigger={themeMenu.trigger}
          label={t('shell.titleBar.theme')}
          items={items}
          onClose={themeMenu.close}
        />
      </div>
    </header>
  );
}
