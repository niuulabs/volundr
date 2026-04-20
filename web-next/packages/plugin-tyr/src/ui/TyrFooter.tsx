/**
 * TyrFooter — status chips rendered in the shell footer when Tyr is active.
 *
 * Matches web2 pattern: api ● connected │ sleipnir ● 12.1k evt/s │ mímir ● idx 2.3M
 */

import { useDispatcherState } from './useDispatcherState';

interface FooterChipProps {
  name: string;
  state: 'ok' | 'warn' | 'err';
  value: string;
}

function FooterChip({ name, state, value }: FooterChipProps) {
  return (
    <>
      <span className="niuu-shell__footer-chip" data-testid={`footer-chip-${name}`}>
        {name}{' '}
        <span className="niuu-shell__footer-chip-dot" data-state={state}>
          ●
        </span>{' '}
        {value}
      </span>
      <span className="niuu-shell__footer-chip-sep">│</span>
    </>
  );
}

export function TyrFooter() {
  const { data: state } = useDispatcherState();

  const apiState = state ? 'ok' : 'warn';
  const apiLabel = state ? 'connected' : 'connecting';

  return (
    <div className="niuu-flex niuu-items-center niuu-gap-1" data-testid="tyr-footer">
      <FooterChip name="api" state={apiState} value={apiLabel} />
      <FooterChip name="dispatcher" state={state?.running ? 'ok' : 'warn'} value={state?.running ? 'active' : 'paused'} />
      <span className="niuu-shell__footer-chip" data-testid="footer-chip-threshold">
        threshold{' '}
        <span className="niuu-shell__footer-chip-dot" data-state="ok">●</span>{' '}
        {state ? (state.threshold / 100).toFixed(2) : '—'}
      </span>
    </div>
  );
}
