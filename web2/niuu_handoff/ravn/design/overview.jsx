/* global React, RAVN_DATA, PersonaAvatar, StateDot, StateBadge, BudgetBar, Sparkline, MountChip, DeployBadge, Metric, Seg, Kbd */
// ─── Ravn — Overview page (fleet health, active ravens, budget burn) ─────

const { useState: useOS, useMemo: useOM } = React;

function OverviewView({ setTab, selectRaven }) {
  const { RAVENS, SESSIONS, LOG, TRIGGERS, BUDGET_HOURLY } = window.RAVN_DATA;

  const activeRavens = RAVENS.filter(r => r.state === 'active');
  const idleRavens   = RAVENS.filter(r => r.state === 'idle');
  const failedRavens = RAVENS.filter(r => r.state === 'failed');
  const suspRavens   = RAVENS.filter(r => r.state === 'suspended');
  const activeSessions = SESSIONS.filter(s => s.state === 'active');

  const totalSpent = RAVENS.reduce((a,r)=>a + r.budget.spentUsd, 0);
  const totalCap   = RAVENS.reduce((a,r)=>a + r.budget.capUsd, 0);
  const sessionSpend = activeSessions.reduce((a,s)=>a + s.costUsd, 0);

  // Aggregate hourly fleet spend
  const fleetHourly = useOM(() => {
    const hours = 24;
    const sum = new Array(hours).fill(0);
    for (const rid of Object.keys(BUDGET_HOURLY)) {
      BUDGET_HOURLY[rid].forEach((v,i)=>{ sum[i] += v; });
    }
    return sum.map(v=>+v.toFixed(3));
  }, []);

  // Top burners
  const topBurners = useOM(()=>{
    return [...RAVENS].map(r => ({ r, pct: r.budget.capUsd>0 ? r.budget.spentUsd/r.budget.capUsd : 0 }))
      .sort((a,b)=>b.pct-a.pct).slice(0,5);
  }, []);

  const activeByLocation = useOM(()=>{
    const map = {};
    for (const r of activeRavens) map[r.location] = (map[r.location]||0) + 1;
    return Object.entries(map).sort((a,b)=>b[1]-a[1]);
  }, []);

  return (
    <div className="ov-root">
      {/* KPI strip */}
      <div className="ov-kpis">
        <div className="ov-kpi">
          <div className="lbl">Ravens</div>
          <div className="val">{RAVENS.length}</div>
          <div className="sub">
            <span className="ok-ink">{activeRavens.length} active</span>
            <span className="sep">·</span>
            <span>{idleRavens.length} idle</span>
            {failedRavens.length>0 && <><span className="sep">·</span><span className="err-ink">{failedRavens.length} failed</span></>}
            {suspRavens.length>0 && <><span className="sep">·</span><span className="warn-ink">{suspRavens.length} suspended</span></>}
          </div>
        </div>
        <div className="ov-kpi">
          <div className="lbl">Open sessions</div>
          <div className="val">{activeSessions.length}</div>
          <div className="sub">
            <span>{activeSessions.reduce((a,s)=>a+s.messageCount,0)} msgs</span>
            <span className="sep">·</span>
            <span>{(activeSessions.reduce((a,s)=>a+s.tokenCount,0)/1000).toFixed(1)}k tok</span>
          </div>
        </div>
        <div className="ov-kpi">
          <div className="lbl">Spend today</div>
          <div className="val mono accent">${totalSpent.toFixed(2)}</div>
          <div className="sub">
            <span>of ${totalCap.toFixed(2)} cap</span>
            <span className="sep">·</span>
            <span>{((totalSpent/totalCap)*100).toFixed(0)}%</span>
          </div>
        </div>
        <div className="ov-kpi">
          <div className="lbl">Active triggers</div>
          <div className="val">{TRIGGERS.filter(t=>t.enabled).length}</div>
          <div className="sub"><span>{TRIGGERS.filter(t=>!t.enabled).length} paused</span></div>
        </div>
      </div>

      {/* Two-column body */}
      <div className="ov-body">
        <div className="ov-col">
          <div className="ov-section-head">
            <h3>Active ravens</h3>
            <button className="ov-link" onClick={()=>setTab('ravens')}>open directory →</button>
          </div>
          <div className="ov-active-list">
            {activeRavens.map(r => (
              <button key={r.id} className="ov-active-row" onClick={()=>{ selectRaven(r.id); setTab('ravens'); }}>
                <span className="state-col"><StateDot state={r.state}/></span>
                <PersonaAvatar name={r.persona} size={20}/>
                <span className="name mono">{r.name}</span>
                <span className="persona mono dim">{r.persona}</span>
                <span className="loc mono dim">@ {r.location}</span>
                <span className="sess mono dim">{r.openSessions} open</span>
                <span className="budget-col"><BudgetBar spent={r.budget.spentUsd} cap={r.budget.capUsd} size="sm"/></span>
                <span className="last mono dim">{r.lastActivity}</span>
              </button>
            ))}
          </div>

          <div className="ov-section-head" style={{marginTop: 'var(--space-6)'}}>
            <h3>By location</h3>
            <span className="meta mono">active ravens</span>
          </div>
          <div className="ov-loc-bars">
            {activeByLocation.map(([loc,n])=> {
              const max = activeByLocation[0][1] || 1;
              return (
                <div key={loc} className="ov-loc-row">
                  <span className="mono">{loc}</span>
                  <span className="bar"><span className="bar-fill" style={{width: (n/max)*100+'%'}}/></span>
                  <span className="mono dim">{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ov-col">
          <div className="ov-section-head">
            <h3>Fleet spend · 24h</h3>
            <span className="meta mono">${fleetHourly.reduce((a,v)=>a+v,0).toFixed(2)} total</span>
          </div>
          <div className="ov-sparkline-big">
            <Sparkline values={fleetHourly} w={520} h={100} />
            <div className="ov-spark-axis mono">
              <span>−24h</span><span>−12h</span><span>now</span>
            </div>
          </div>

          <div className="ov-section-head" style={{marginTop: 'var(--space-6)'}}>
            <h3>Top burners</h3>
            <button className="ov-link" onClick={()=>setTab('budget')}>budget page →</button>
          </div>
          <div className="ov-burners">
            {topBurners.map(({r,pct}) => (
              <button key={r.id} className="ov-burner-row" onClick={()=>{ selectRaven(r.id); setTab('ravens'); }}>
                <PersonaAvatar name={r.persona} size={18}/>
                <span className="name mono">{r.name}</span>
                <span className="burn-bar"><BudgetBar spent={r.budget.spentUsd} cap={r.budget.capUsd} size="sm"/></span>
                <span className="mono dim">{(pct*100).toFixed(0)}%</span>
                <span className="mono">${r.budget.spentUsd.toFixed(2)}</span>
              </button>
            ))}
          </div>

          <div className="ov-section-head" style={{marginTop: 'var(--space-6)'}}>
            <h3>Recent activity</h3>
            <span className="meta mono">fleet tail · last 9</span>
          </div>
          <div className="ov-log">
            {LOG.slice(0,9).map((e,i)=>(
              <div key={i} className="ov-log-row">
                <span className="t mono">{e.ts}</span>
                <span className={`k ${e.kind}`}>{e.kind}</span>
                <span className="r mono">{e.ravnId}</span>
                <span className="msg">{e.body}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.OverviewView = OverviewView;
