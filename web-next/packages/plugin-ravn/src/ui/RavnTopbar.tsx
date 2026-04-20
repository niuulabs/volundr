/**
 * RavnTopbar — stat chips rendered in the shell topbar right section.
 *
 * Shown when the ravn plugin is active (shell calls topbarRight only for
 * the active plugin, so no route check is needed).
 *
 * Chips:
 *   • {activeRavens} active  (kind=ok, dot=●)
 *   • {failedRavens} failed  (kind=err, conditional)
 *   • {openSessions} sessions (kind=dim, icon=◷)
 */

import { useRavens } from './hooks/useRavens';
import { useSessions } from './hooks/useSessions';

interface TopbarChipProps {
  kind: 'ok' | 'err' | 'dim';
  icon: string;
  label: string;
}

function TopbarChip({ kind, icon, label }: TopbarChipProps) {
  return (
    <span
      className={`niuu-inline-flex niuu-items-center niuu-gap-1 niuu-px-2 niuu-py-0.5 niuu-rounded-full niuu-text-xs niuu-font-mono rv-topbar-chip rv-topbar-chip--${kind}`}
      data-testid={`topbar-chip-${kind}`}
    >
      <span className="rv-topbar-chip__dot" aria-hidden="true">
        {icon}
      </span>
      {label}
    </span>
  );
}

export function RavnTopbar() {
  const { data: ravens } = useRavens();
  const { data: sessions } = useSessions();

  const ravnList = ravens ?? [];
  const activeRavens = ravnList.filter((r) => r.status === 'active').length;
  const failedRavens = ravnList.filter((r) => r.status === 'failed').length;
  const openSessions = (sessions ?? []).filter((s) => s.status === 'running').length;

  return (
    <div className="niuu-flex niuu-items-center niuu-gap-2" data-testid="ravn-topbar">
      <TopbarChip kind="ok" icon="●" label={`${activeRavens} active`} />
      {failedRavens > 0 && <TopbarChip kind="err" icon="●" label={`${failedRavens} failed`} />}
      <TopbarChip kind="dim" icon="◷" label={`${openSessions} sessions`} />
    </div>
  );
}
