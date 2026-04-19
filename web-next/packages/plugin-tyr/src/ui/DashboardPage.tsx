import { useQueries } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useService } from '@niuulabs/plugin-sdk';
import {
  KpiStrip,
  KpiCard,
  StatusBadge,
  ConfidenceBadge,
  LoadingState,
  ErrorState,
  EmptyState,
  StateDot,
  Rune,
} from '@niuulabs/ui';
import type { ITyrService } from '../ports';
import { useSagas } from './useSagas';
import { useDispatcher } from './useDispatcher';

export function DashboardPage() {
  const navigate = useNavigate();
  const tyr = useService<ITyrService>('tyr');
  const { data: sagas, isLoading, isError, error } = useSagas();
  const { data: dispatcher } = useDispatcher();

  const phaseQueries = useQueries({
    queries: (sagas ?? []).map((s) => ({
      queryKey: ['tyr', 'phases', s.id],
      queryFn: () => tyr.getPhases(s.id),
    })),
  });

  const allRaids = phaseQueries.flatMap((q) => q.data ?? []).flatMap((p) => p.raids);
  const runningRaids = allRaids.filter((r) => r.status === 'running').length;
  const blockedRaids = allRaids.filter(
    (r) => r.status === 'failed' || r.status === 'escalated',
  ).length;

  const activeSagas = (sagas ?? []).filter((s) => s.status === 'active');
  const completedSagas = (sagas ?? []).filter((s) => s.status === 'complete');
  const avgConfidence =
    activeSagas.length > 0
      ? Math.round(activeSagas.reduce((sum, s) => sum + s.confidence, 0) / activeSagas.length)
      : 0;

  if (isLoading) return <LoadingState label="Loading dashboard…" />;
  if (isError)
    return <ErrorState message={error instanceof Error ? error.message : 'Failed to load sagas'} />;

  return (
    <div className="niuu-p-6 niuu-space-y-6">
      <header className="niuu-flex niuu-items-center niuu-gap-3">
        <Rune glyph="ᛏ" size={28} />
        <h2 className="niuu-m-0 niuu-text-xl niuu-font-semibold niuu-text-text-primary">
          Tyr · Dashboard
        </h2>
        {dispatcher?.running && <StateDot state="healthy" pulse />}
      </header>

      <KpiStrip aria-label="Tyr KPI metrics">
        <KpiCard label="Active Sagas" value={activeSagas.length} />
        <KpiCard label="Running Raids" value={runningRaids} />
        <KpiCard
          label="Blocked Raids"
          value={blockedRaids}
          deltaTrend={blockedRaids > 0 ? 'down' : 'neutral'}
        />
        <KpiCard label="Confidence Avg" value={`${avgConfidence}%`} />
        <KpiCard label="Dispatcher" value={dispatcher?.running ? 'running' : 'stopped'} />
      </KpiStrip>

      <div className="niuu-grid niuu-grid-cols-2 niuu-gap-6">
        <section aria-label="Active sagas">
          <h3 className="niuu-text-sm niuu-font-semibold niuu-text-text-secondary niuu-mb-3 niuu-uppercase niuu-tracking-wide">
            Active Sagas
          </h3>
          {activeSagas.length === 0 ? (
            <EmptyState title="No active sagas" description="All sagas are complete or failed." />
          ) : (
            <ul className="niuu-list-none niuu-p-0 niuu-m-0 niuu-space-y-2">
              {activeSagas.map((saga) => (
                <li key={saga.id}>
                  <button
                    type="button"
                    className="niuu-w-full niuu-text-left niuu-p-3 niuu-rounded-md niuu-bg-bg-secondary niuu-border niuu-border-border niuu-cursor-pointer"
                    onClick={() =>
                      void navigate({
                        to: '/tyr/sagas/$sagaId',
                        params: { sagaId: saga.id },
                      })
                    }
                    aria-label={`View saga ${saga.name}`}
                  >
                    <div className="niuu-flex niuu-items-center niuu-justify-between niuu-gap-2">
                      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-min-w-0">
                        <StatusBadge status="active" />
                        <span className="niuu-text-sm niuu-font-medium niuu-text-text-primary niuu-truncate">
                          {saga.name}
                        </span>
                      </div>
                      <ConfidenceBadge value={saga.confidence / 100} />
                    </div>
                    <p className="niuu-mt-1 niuu-mb-0 niuu-text-xs niuu-text-text-muted">
                      {saga.trackerId} · {saga.featureBranch}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Recent completions">
          <h3 className="niuu-text-sm niuu-font-semibold niuu-text-text-secondary niuu-mb-3 niuu-uppercase niuu-tracking-wide">
            Recent Completions
          </h3>
          {completedSagas.length === 0 ? (
            <EmptyState title="No completed sagas" />
          ) : (
            <ul className="niuu-list-none niuu-p-0 niuu-m-0 niuu-space-y-2">
              {completedSagas.map((saga) => (
                <li
                  key={saga.id}
                  className="niuu-p-3 niuu-rounded-md niuu-bg-bg-secondary niuu-border niuu-border-border"
                >
                  <div className="niuu-flex niuu-items-center niuu-justify-between niuu-gap-2">
                    <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-min-w-0">
                      <StatusBadge status="complete" />
                      <span className="niuu-text-sm niuu-font-medium niuu-text-text-primary niuu-truncate">
                        {saga.name}
                      </span>
                    </div>
                    <ConfidenceBadge value={saga.confidence / 100} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {dispatcher && (
        <section aria-label="Dispatcher summary">
          <h3 className="niuu-text-sm niuu-font-semibold niuu-text-text-secondary niuu-mb-3 niuu-uppercase niuu-tracking-wide">
            Dispatcher
          </h3>
          <div className="niuu-p-4 niuu-rounded-md niuu-bg-bg-secondary niuu-border niuu-border-border">
            <div className="niuu-flex niuu-gap-8 niuu-text-sm niuu-flex-wrap">
              <div>
                <span className="niuu-text-xs niuu-text-text-muted niuu-uppercase niuu-tracking-wide">
                  Status
                </span>
                <div className="niuu-mt-1 niuu-flex niuu-items-center niuu-gap-1">
                  <StateDot
                    state={dispatcher.running ? 'healthy' : 'idle'}
                    pulse={dispatcher.running}
                  />
                  <span className="niuu-font-medium">
                    {dispatcher.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
              </div>
              <div>
                <span className="niuu-text-xs niuu-text-text-muted niuu-uppercase niuu-tracking-wide">
                  Threshold
                </span>
                <div className="niuu-mt-1 niuu-font-semibold">{dispatcher.threshold}%</div>
              </div>
              <div>
                <span className="niuu-text-xs niuu-text-text-muted niuu-uppercase niuu-tracking-wide">
                  Concurrent Raids
                </span>
                <div className="niuu-mt-1 niuu-font-semibold">{dispatcher.maxConcurrentRaids}</div>
              </div>
              <div>
                <span className="niuu-text-xs niuu-text-text-muted niuu-uppercase niuu-tracking-wide">
                  Auto Continue
                </span>
                <div className="niuu-mt-1 niuu-font-semibold">
                  {dispatcher.autoContinue ? 'Yes' : 'No'}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {allRaids.filter((r) => r.status === 'failed').length > 0 && (
        <section aria-label="Failed raids">
          <h3 className="niuu-text-sm niuu-font-semibold niuu-text-text-secondary niuu-mb-3 niuu-uppercase niuu-tracking-wide">
            Failed Raids
          </h3>
          <ul className="niuu-list-none niuu-p-0 niuu-m-0 niuu-space-y-2">
            {allRaids
              .filter((r) => r.status === 'failed')
              .map((raid) => (
                <li
                  key={raid.id}
                  className="niuu-p-3 niuu-rounded-md niuu-bg-bg-secondary niuu-border niuu-border-border"
                >
                  <div className="niuu-flex niuu-items-center niuu-gap-2">
                    <StatusBadge status="failed" />
                    <span className="niuu-text-sm niuu-text-text-primary">{raid.name}</span>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
