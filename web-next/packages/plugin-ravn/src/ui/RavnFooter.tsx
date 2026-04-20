/**
 * RavnFooter — status chips rendered in the shell footer when Ravn is active.
 */

import { useRavens } from './hooks/useRavens';
import { useSessions } from './hooks/useSessions';

export function RavnFooter() {
  const { data: ravens } = useRavens();
  const { data: sessions } = useSessions();

  const ravnList = ravens ?? [];
  const activeRavens = ravnList.filter((r) => r.status === 'active').length;
  const totalRavens = ravnList.length;
  const openSessions = (sessions ?? []).filter((s) => s.status === 'running').length;

  return (
    <div className="niuu-flex niuu-items-center niuu-gap-1" data-testid="ravn-footer">
      <span className="niuu-shell__footer-chip" data-testid="footer-chip-ravens">
        ravens{' '}
        <span className="niuu-shell__footer-chip-dot" data-state={activeRavens > 0 ? 'ok' : 'warn'}>
          ●
        </span>{' '}
        {activeRavens}/{totalRavens}
      </span>
      <span className="niuu-shell__footer-chip-sep">│</span>
      <span className="niuu-shell__footer-chip" data-testid="footer-chip-sessions">
        sessions{' '}
        <span className="niuu-shell__footer-chip-dot" data-state={openSessions > 0 ? 'ok' : 'warn'}>
          ●
        </span>{' '}
        {openSessions} active
      </span>
    </div>
  );
}
