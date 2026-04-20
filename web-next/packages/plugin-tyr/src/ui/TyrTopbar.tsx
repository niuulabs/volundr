/**
 * TyrTopbar — dispatcher status chips rendered in the shell topbar-right area.
 *
 * Shown when the tyr plugin is active. Displays:
 *   • dispatcher on/off  (kind=ok/dim)
 *   • threshold value     (kind=dim)
 *   • concurrent X/Y      (kind=dim)
 *
 * When the user is on a /tyr/settings/* route, the settings breadcrumb
 * is shown instead (via SettingsTopbar).
 */

import { useRouterState } from '@tanstack/react-router';
import { useDispatcherState } from './useDispatcherState';
import { SettingsTopbar } from './settings/SettingsTopbar';

interface ChipProps {
  kind: 'ok' | 'err' | 'dim';
  icon: string;
  label: string;
}

function DispatcherChip({ kind, icon, label }: ChipProps) {
  return (
    <span
      className={`niuu-inline-flex niuu-items-center niuu-gap-1 niuu-px-2 niuu-py-0.5 niuu-rounded-full niuu-text-xs niuu-font-mono tyr-topbar-chip tyr-topbar-chip--${kind}`}
      data-testid={`tyr-chip-${label.replace(/[\s/]/g, '-')}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

function DispatcherStats() {
  const { data: state } = useDispatcherState();

  if (!state) {
    return (
      <div className="niuu-flex niuu-items-center niuu-gap-2" data-testid="tyr-topbar">
        <DispatcherChip kind="dim" icon="◌" label="dispatcher …" />
      </div>
    );
  }

  const thresholdDisplay = (state.threshold / 100).toFixed(2);

  return (
    <div className="niuu-flex niuu-items-center niuu-gap-2" data-testid="tyr-topbar">
      <DispatcherChip
        kind={state.running ? 'ok' : 'dim'}
        icon="●"
        label={`dispatcher ${state.running ? 'on' : 'off'}`}
      />
      <DispatcherChip kind="dim" icon="◈" label={`threshold ${thresholdDisplay}`} />
      <DispatcherChip
        kind="dim"
        icon="⇥"
        label={`concurrent ${state.maxConcurrentRaids}`}
      />
    </div>
  );
}

export function TyrTopbar() {
  const { location } = useRouterState({ select: (s) => ({ location: s.location }) });
  const pathname = location.pathname;

  // Settings routes show the breadcrumb instead
  if (pathname === '/tyr/settings' || pathname.startsWith('/tyr/settings/')) {
    return <SettingsTopbar />;
  }

  return <DispatcherStats />;
}
