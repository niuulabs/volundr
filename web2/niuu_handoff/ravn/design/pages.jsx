/* global React, RAVN_DATA, PersonaAvatar, StateDot, StateBadge, BudgetBar, Sparkline, MountChip, DeployBadge, Metric, Seg, Kbd */
// ─── Ravn pages — ravens (detail), budget ──
// Triggers + Log are now folded into RavnDetail. Events moved into Personas.

const { useState: usePg, useMemo: usePm, useEffect: usePe } = React;

// ══════════════════════════════════════════════════════════════
// RAVENS VIEW — three layouts (split, table, cards)
// ══════════════════════════════════════════════════════════════

function RavensView({ ctx }) {
  const { tweaks, selectedRavnId, selectRaven } = ctx;
  const layout = tweaks.ravensLayout || 'split';
  const { RAVENS } = window.RAVN_DATA;
  const selected = window.RAVN_DATA.RAVEN_BY_ID[selectedRavnId] || RAVENS[0];

  if (layout === 'table') return <RavensTable ravens={RAVENS} selected={selected} select={selectRaven}/>;
  if (layout === 'cards') return <RavensCards ravens={RAVENS} selected={selected} select={selectRaven}/>;
  return <RavensSplit ravens={RAVENS} selected={selected} select={selectRaven}/>;
}

function RavensSplit({ ravens, selected, select }) {
  const [q, setQ] = usePg('');
  const [groupBy, setGroupBy] = usePg('location'); // location | persona | state | none

  const filtered = usePm(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ravens;
    return ravens.filter(r =>
      r.name.toLowerCase().includes(needle) ||
      r.persona.toLowerCase().includes(needle) ||
      r.location.toLowerCase().includes(needle) ||
      r.state.toLowerCase().includes(needle)
    );
  }, [ravens, q]);

  const groups = usePm(() => {
    if (groupBy === 'none') return [{ key: 'all', ravens: filtered }];
    const keyFn = r => r[groupBy];
    const map = {};
    for (const r of filtered) (map[keyFn(r)] = map[keyFn(r)] || []).push(r);
    return Object.keys(map).sort().map(k => ({ key: k, ravens: map[k] }));
  }, [filtered, groupBy]);

  const activeCount = ravens.filter(r=>r.state==='active').length;
  const failedCount = ravens.filter(r=>r.state==='failed').length;

  return (
    <div className="rv-split">
      <div className="rv-list">
        <div className="rv-list-head">
          <div className="rv-list-head-row">
            <h3>Fleet</h3>
            <div className="rv-list-head-counts mono dim sm">
              <span>{ravens.length} total</span>
              <span className="sep">·</span>
              <span className="ok">{activeCount} active</span>
              {failedCount > 0 && <><span className="sep">·</span><span className="err">{failedCount} failed</span></>}
            </div>
          </div>
          <div className="rv-list-head-ctrl">
            <input
              className="rv-search input mono"
              placeholder="filter by name, persona, location…"
              value={q}
              onChange={e=>setQ(e.target.value)}
            />
            <div className="rv-groupseg">
              {[
                {v:'location', l:'loc'},
                {v:'persona',  l:'persona'},
                {v:'state',    l:'state'},
                {v:'none',     l:'flat'},
              ].map(o => (
                <button key={o.v} className={groupBy===o.v?'on':''} onClick={()=>setGroupBy(o.v)}>{o.l}</button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="rv-list-empty mono dim sm">no ravens match "{q}"</div>
        )}

        {groups.map(g => (
          <div key={g.key} className="rv-list-group">
            {groupBy !== 'none' && (
              <div className="rv-list-grouphead">
                <span className="mono">{g.key}</span>
                <span className="mono dim">{g.ravens.length}</span>
              </div>
            )}
            {g.ravens.map(r => (
              <button key={r.id}
                className={`rv-list-row ${selected.id===r.id?'active':''}`}
                onClick={()=>select(r.id)}>
                <span className="rv-state-col"><StateDot state={r.state}/></span>
                <PersonaAvatar name={r.persona} size={22}/>
                <div className="rv-idcol">
                  <div className="rv-name mono">{r.name}</div>
                  <div className="rv-persona mono dim">{r.persona}</div>
                </div>
                <div className="rv-loccol mono dim">
                  <div>{r.location}</div>
                  <div className="dim2">{r.deployment}</div>
                </div>
                <div className="rv-sesscol">
                  <div className="mono">{r.openSessions}</div>
                  <div className="mono dim">sess</div>
                </div>
                <div className="rv-budgetcol">
                  <BudgetBar spent={r.budget.spentUsd} cap={r.budget.capUsd} size="sm"/>
                  <div className="mono dim">${r.budget.spentUsd.toFixed(2)}/${r.budget.capUsd.toFixed(2)}</div>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
      <RavnDetail ravn={selected}/>
    </div>
  );
}

function RavensTable({ ravens, selected, select }) {
  return (
    <div className="rv-table-wrap">
      <div className="rv-table-head">
        <h3>All ravens</h3>
        <span className="mono dim">table view · click row to select</span>
      </div>
      <div className="rv-tablescroll">
      <table className="rv-table">
        <thead>
          <tr>
            <th>State</th>
            <th>Name</th>
            <th>Persona</th>
            <th>Location</th>
            <th>Deploy</th>
            <th>Cascade</th>
            <th>Sessions</th>
            <th>Total</th>
            <th>Budget</th>
            <th>Triggers</th>
            <th>Last</th>
          </tr>
        </thead>
        <tbody>
          {ravens.map(r => (
            <tr key={r.id} className={selected.id===r.id?'active':''} onClick={()=>select(r.id)}>
              <td><StateDot state={r.state}/> <span className="mono sm">{r.state}</span></td>
              <td><span className="mono"><strong>{r.name}</strong></span></td>
              <td><span className="rv-cell-persona"><PersonaAvatar name={r.persona} size={16}/><span className="mono">{r.persona}</span></span></td>
              <td className="mono">{r.location}</td>
              <td className="mono dim">{r.deployment}</td>
              <td className="mono dim">{r.cascadeMode}</td>
              <td className="mono">{r.openSessions}</td>
              <td className="mono dim">{r.totalSessions}</td>
              <td style={{minWidth:120}}><BudgetBar spent={r.budget.spentUsd} cap={r.budget.capUsd} size="sm"/></td>
              <td className="mono dim">{r.triggers.length || '—'}</td>
              <td className="mono dim">{r.lastActivity}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function RavensCards({ ravens, selected, select }) {
  return (
    <div className="rv-cards-wrap">
      <div className="rv-cards">
        {ravens.map(r => (
          <button key={r.id}
            className={`rv-card ${selected.id===r.id?'active':''} rv-state-${r.state}`}
            onClick={()=>select(r.id)}>
            <div className="rv-card-head">
              <PersonaAvatar name={r.persona} size={26}/>
              <div>
                <div className="mono" style={{fontSize:13, fontWeight:600}}>{r.name}</div>
                <div className="mono dim sm">{r.persona}</div>
              </div>
              <StateBadge state={r.state}/>
            </div>
            <div className="rv-card-meta">
              <Metric label="loc" value={r.location}/>
              <Metric label="deploy" value={r.deployment}/>
              <Metric label="cascade" value={r.cascadeMode}/>
            </div>
            <div className="rv-card-bars">
              <div className="rv-card-bar-lbl">
                <span className="mono dim">budget</span>
                <span className="mono">${r.budget.spentUsd.toFixed(2)} / ${r.budget.capUsd.toFixed(2)}</span>
              </div>
              <BudgetBar spent={r.budget.spentUsd} cap={r.budget.capUsd} size="md"/>
            </div>
            <div className="rv-card-foot">
              <span className="mono">{r.openSessions}/{r.totalSessions} sess</span>
              <span className="mono dim">{r.lastActivity}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// RAVN DETAIL — now the home for Identity, Runtime, Triggers, Log, Mounts, Sessions
// ══════════════════════════════════════════════════════════════
function RavnDetail({ ravn }) {
  const { SESSIONS, TRIGGERS, LOG } = window.RAVN_DATA;
  const ravnSessions = SESSIONS.filter(s => s.ravnId === ravn.id);
  const ravnTriggers = TRIGGERS.filter(t => t.ravens.includes(ravn.id));
  const ravnLog = LOG.filter(e => e.ravnId === ravn.id);
  const persona = window.RAVN_DATA.PERSONA_BY_NAME[ravn.persona];

  const [section, setSection] = usePg('overview');

  return (
    <div className="rv-detail">
      <div className="rv-detail-head">
        <div className="rv-dh-left">
          <PersonaAvatar name={ravn.persona} size={44}/>
          <div>
            <div className="rv-dh-name mono">{ravn.name}</div>
            <div className="rv-dh-sub mono dim">
              {ravn.persona} <span className="sep">·</span> {ravn.location} <span className="sep">·</span> {ravn.deployment}
            </div>
          </div>
        </div>
        <div className="rv-dh-right">
          <StateBadge state={ravn.state}/>
          <button className="btn btn-sm">pause</button>
          <button className="btn btn-sm btn-primary">open session</button>
        </div>
      </div>

      {/* Inline section tabs — reveals triggers/log inside the raven, not as separate pages */}
      <nav className="rv-sectabs">
        <button className={section==='overview'?'active':''} onClick={()=>setSection('overview')}>
          overview
        </button>
        <button className={section==='triggers'?'active':''} onClick={()=>setSection('triggers')}>
          triggers <span className="rv-sectabs-n mono">{ravnTriggers.length}</span>
        </button>
        <button className={section==='activity'?'active':''} onClick={()=>setSection('activity')}>
          activity <span className="rv-sectabs-n mono">{ravnLog.length}</span>
        </button>
        <button className={section==='sessions'?'active':''} onClick={()=>setSection('sessions')}>
          sessions <span className="rv-sectabs-n mono">{ravnSessions.length}</span>
        </button>
        <button className={section==='connectivity'?'active':''} onClick={()=>setSection('connectivity')}>
          connectivity
        </button>
      </nav>

      {section === 'overview'     && <RavnSecOverview     ravn={ravn} persona={persona}/>}
      {section === 'triggers'     && <RavnSecTriggers     ravn={ravn} triggers={ravnTriggers}/>}
      {section === 'activity'     && <RavnSecActivity     ravn={ravn} log={ravnLog}/>}
      {section === 'sessions'     && <RavnSecSessions     ravn={ravn} sessions={ravnSessions}/>}
      {section === 'connectivity' && <RavnSecConnectivity ravn={ravn}/>}
    </div>
  );
}

// ─── SECTION: OVERVIEW (identity + runtime + mounts + compact budget line) ──
function RavnSecOverview({ ravn, persona }) {
  const pct = ravn.budget.capUsd > 0 ? (ravn.budget.spentUsd / ravn.budget.capUsd) * 100 : 0;
  return (
    <div className="rv-detail-grid">
      <section className="rv-panel">
        <div className="rv-panel-head"><h4>Identity</h4></div>
        <div className="rv-panel-body rv-kv">
          <div><span className="k">id</span><span className="v mono">{ravn.id}</span></div>
          <div><span className="k">persona</span><span className="v mono">{ravn.persona}</span></div>
          <div><span className="k">role</span><span className="v mono">{persona?.role}</span></div>
          <div><span className="k">specialisations</span><span className="v mono">{ravn.specialisations.join(', ') || '—'}</span></div>
        </div>
      </section>

      <section className="rv-panel">
        <div className="rv-panel-head"><h4>Runtime</h4></div>
        <div className="rv-panel-body rv-kv">
          <div><span className="k">state</span><span className="v"><StateBadge state={ravn.state}/></span></div>
          <div><span className="k">cascade</span><span className="v mono">{ravn.cascadeMode}</span></div>
          <div><span className="k">checkpoints</span><span className="v mono">{ravn.checkpointEnabled ? ravn.checkpointStrategy : 'off'}</span></div>
          <div><span className="k">output</span><span className="v mono">{ravn.outputMode}</span></div>
          <div><span className="k">last activity</span><span className="v mono">{ravn.lastActivity}</span></div>
          <div><span className="k">sessions</span><span className="v mono">{ravn.openSessions} open / {ravn.totalSessions} total</span></div>
          <div><span className="k">today's spend</span>
            <span className="v">
              <span className="mono">${ravn.budget.spentUsd.toFixed(2)}</span>
              <span className="mono dim"> of ${ravn.budget.capUsd.toFixed(2)}</span>
              <span className={`rv-pct-pill mono ${pct>80?'warn':pct>50?'mid':'ok'}`}>{pct.toFixed(0)}%</span>
            </span>
          </div>
        </div>
      </section>

      <section className="rv-panel rv-panel-wide">
        <div className="rv-panel-head">
          <h4>Mímir mounts</h4>
          <span className="mono dim">{ravn.mimirMounts.length} mounts</span>
        </div>
        <div className="rv-panel-body">
          <div className="rv-mounts">
            {ravn.mimirMounts.map(m => (
              <MountChip key={m.name} name={m.name} role={m.role} priority={m.priority}/>
            ))}
          </div>
          {Object.keys(ravn.mimirWriteRouting).length > 0 && (
            <div className="rv-routing">
              <div className="mono dim sm" style={{marginBottom:6}}>write routing</div>
              <table className="rv-routing-table">
                <tbody>
                  {Object.entries(ravn.mimirWriteRouting).map(([tag, mount]) => (
                    <tr key={tag}>
                      <td className="mono">{tag}</td>
                      <td className="mono dim">→</td>
                      <td className="mono">{mount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── SECTION: TRIGGERS (per-raven + inline add) ──
function RavnSecTriggers({ ravn, triggers }) {
  const [adding, setAdding] = usePg(false);
  const [form, setForm] = usePg({ kind: 'cron', schedule: '0 9 * * *', topic: '', description: '', producesEvent: '' });

  return (
    <div className="rv-sec-triggers">
      <div className="rv-sec-head">
        <div>
          <h4>Triggers bound to this raven</h4>
          <p className="mono dim sm">Cron schedules, event subscriptions, or gateway messages that auto-dispatch this raven.</p>
        </div>
        {!adding && <button className="btn btn-sm btn-primary" onClick={()=>setAdding(true)}>+ Add trigger</button>}
      </div>

      {adding && (
        <div className="rv-tg-newform">
          <div className="rv-tg-newform-head">
            <span className="mono">new trigger → {ravn.name}</span>
            <button className="btn btn-xs" onClick={()=>setAdding(false)}>cancel</button>
          </div>
          <div className="rv-tg-newform-body">
            <label className="rv-tg-field">
              <span className="mono dim sm">kind</span>
              <div className="rv-tg-kindseg">
                {['cron','event','gateway'].map(k => (
                  <button key={k} className={form.kind===k?'on':''} onClick={()=>setForm({...form, kind:k})}>{k}</button>
                ))}
              </div>
            </label>
            {form.kind === 'cron' && (
              <label className="rv-tg-field">
                <span className="mono dim sm">schedule (cron)</span>
                <input className="input mono" value={form.schedule} onChange={e=>setForm({...form, schedule:e.target.value})} placeholder="0 9 * * *"/>
              </label>
            )}
            {form.kind !== 'cron' && (
              <label className="rv-tg-field">
                <span className="mono dim sm">{form.kind === 'event' ? 'event topic' : 'gateway channel'}</span>
                <input className="input mono" value={form.topic} onChange={e=>setForm({...form, topic:e.target.value})} placeholder={form.kind==='event' ? 'github.pr.opened' : 'telegram.msg'}/>
              </label>
            )}
            <label className="rv-tg-field rv-tg-field-wide">
              <span className="mono dim sm">description</span>
              <input className="input" value={form.description} onChange={e=>setForm({...form, description:e.target.value})} placeholder="what this trigger does"/>
            </label>
            <label className="rv-tg-field">
              <span className="mono dim sm">emits (optional)</span>
              <input className="input mono" value={form.producesEvent} onChange={e=>setForm({...form, producesEvent:e.target.value})} placeholder="e.g. review.verdict"/>
            </label>
          </div>
          <div className="rv-tg-newform-foot">
            <span className="mono dim sm">trigger will be saved to {ravn.persona}.triggers[] + wired on the event bus</span>
            <button className="btn btn-sm btn-primary" onClick={()=>setAdding(false)}>bind trigger</button>
          </div>
        </div>
      )}

      {triggers.length === 0 && !adding && (
        <div className="rv-empty-tg">
          <div className="empty-rune">ᛞ</div>
          <div className="empty-title">No triggers bound</div>
          <div className="empty-sub mono dim">This raven runs on-demand only. Add a cron schedule or event subscription above.</div>
        </div>
      )}

      <div className="rv-tg-list">
        {triggers.map(t => (
          <div key={t.id} className={`rv-tg-card ${t.enabled?'':'disabled'}`}>
            <div className="rv-tg-card-l">
              <span className={`tg-kind tg-kind-${t.kind}`}>{t.kind}</span>
              <div className="rv-tg-card-body">
                <div className="rv-tg-card-id mono">{t.id}</div>
                <div className="rv-tg-card-desc">{t.description}</div>
                <div className="rv-tg-card-meta mono dim sm">
                  <span className="mono">{t.kind === 'cron' ? t.schedule : t.topic}</span>
                  {t.producesEvent && <><span className="sep">·</span><span>emits <span className="mono accent">{t.producesEvent}</span></span></>}
                  <span className="sep">·</span>
                  <span>last fired {t.lastFired ? new Date(t.lastFired).toISOString().slice(5,16).replace('T',' ') : '—'}</span>
                  {t.ravens.length > 1 && (
                    <><span className="sep">·</span><span>shared with {t.ravens.length - 1} other{t.ravens.length===2?'':'s'}</span></>
                  )}
                </div>
              </div>
            </div>
            <div className="rv-tg-card-r">
              <button className={`switch ${t.enabled?'on':''}`}/>
              <button className="btn btn-xs">edit</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SECTION: ACTIVITY (per-raven log tail + filter) ──
function RavnSecActivity({ ravn, log }) {
  const [kind, setKind] = usePg('all');
  const kinds = ['all','iter','tool','emit','wait','budget','trigger','done','idle','suspend'];
  const filtered = kind === 'all' ? log : log.filter(e => e.kind === kind);

  return (
    <div className="rv-sec-activity">
      <div className="rv-sec-head">
        <div>
          <h4>Activity — {ravn.name}</h4>
          <p className="mono dim sm">Live tail: iterations, tool calls, emits, fan-in waits, budget warnings.</p>
        </div>
        <Seg options={kinds.map(k=>({value:k,label:k}))} value={kind} onChange={setKind}/>
      </div>

      {filtered.length === 0 && (
        <div className="rv-empty-tg">
          <div className="empty-rune">ᚾ</div>
          <div className="empty-title">No matching entries</div>
          <div className="empty-sub mono dim">Widen the filter or pick a different kind.</div>
        </div>
      )}

      <div className="rv-act-list">
        {filtered.map((e,i) => (
          <div key={i} className="rv-act-row">
            <span className="rv-act-t mono">{e.ts}</span>
            <span className={`lg-kind lg-kind-${e.kind}`}>{e.kind}</span>
            <span className="rv-act-msg">{e.body}</span>
            {e.costUsd != null && <span className="rv-act-cost mono">${e.costUsd.toFixed(3)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SECTION: SESSIONS (per-raven) ──
function RavnSecSessions({ ravn, sessions }) {
  return (
    <div className="rv-sec-sessions">
      <div className="rv-sec-head">
        <div>
          <h4>Sessions — {ravn.name}</h4>
          <p className="mono dim sm">Interactive threads running against this raven.</p>
        </div>
        <button className="btn btn-sm btn-primary">+ New session</button>
      </div>

      {sessions.length === 0 && (
        <div className="rv-empty-tg">
          <div className="empty-rune">ᛃ</div>
          <div className="empty-title">No sessions yet</div>
          <div className="empty-sub mono dim">Open a session to start an interactive thread.</div>
        </div>
      )}

      <div className="rv-sess-list2">
        {sessions.map(s => (
          <div key={s.id} className="rv-sess-card">
            <div className="rv-sess-card-l">
              <StateDot state={s.state==='completed'?'idle':s.state==='failed'?'failed':'active'}/>
              <div>
                <div className="rv-sess-card-t mono">{s.title}</div>
                <div className="rv-sess-card-m mono dim sm">{s.id} <span className="sep">·</span> {s.state} <span className="sep">·</span> {s.messageCount} msgs <span className="sep">·</span> {(s.tokenCount/1000).toFixed(1)}k tok</div>
              </div>
            </div>
            <div className="rv-sess-card-r">
              <span className="mono">${s.costUsd.toFixed(2)}</span>
              <button className="btn btn-xs">open</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SECTION: CONNECTIVITY ──
function RavnSecConnectivity({ ravn }) {
  return (
    <div className="rv-sec-conn">
      <div className="rv-sec-head">
        <div>
          <h4>Connectivity — {ravn.name}</h4>
          <p className="mono dim sm">What this raven can talk to. MCP tool servers, gateway channels, event subscriptions.</p>
        </div>
      </div>
      <div className="rv-detail-grid">
        <section className="rv-panel rv-panel-wide">
          <div className="rv-panel-head"><h4>MCP servers</h4><span className="mono dim">{ravn.mcpServers.length}</span></div>
          <div className="rv-panel-body">
            <div className="chip-row">
              {ravn.mcpServers.map(s => <span key={s} className="chip chip-mcp mono">{s}</span>)}
              {ravn.mcpServers.length===0 && <span className="dim mono sm">none</span>}
            </div>
          </div>
        </section>
        <section className="rv-panel rv-panel-wide">
          <div className="rv-panel-head"><h4>Gateway channels</h4><span className="mono dim">{ravn.gatewayChannels.length}</span></div>
          <div className="rv-panel-body">
            <div className="chip-row">
              {ravn.gatewayChannels.map(c => <span key={c} className="chip chip-gw mono">{c}</span>)}
              {ravn.gatewayChannels.length===0 && <span className="dim mono sm">none</span>}
            </div>
          </div>
        </section>
        <section className="rv-panel rv-panel-wide">
          <div className="rv-panel-head"><h4>Event subscriptions</h4><span className="mono dim">{ravn.sleipnirTopics.length}</span></div>
          <div className="rv-panel-body">
            <div className="chip-row">
              {ravn.sleipnirTopics.map(t => <span key={t} className="chip chip-topic mono">{t}</span>)}
              {ravn.sleipnirTopics.length===0 && <span className="dim mono sm">none</span>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

window.RavensView = RavensView;

// ══════════════════════════════════════════════════════════════
// BUDGET VIEW — REDESIGNED as an operational control panel
// Answers: are we burning too fast? who's the driver? who's near cap? what should I change?
// ══════════════════════════════════════════════════════════════
function BudgetView({ ctx }) {
  const { RAVENS, BUDGET_HOURLY, SESSIONS } = window.RAVN_DATA;

  // Time setup: assume "now" is hour 18 of the day (we're mid-afternoon).
  // Hours elapsed today = 18. Hours remaining = 6. This drives projection math.
  const HOURS_ELAPSED = 18;
  const HOURS_REMAINING = 24 - HOURS_ELAPSED;

  const totalSpent = RAVENS.reduce((a,r)=>a + r.budget.spentUsd, 0);
  const totalCap   = RAVENS.reduce((a,r)=>a + r.budget.capUsd, 0);

  // Recent burn: avg last 3 hours of BUDGET_HOURLY summed across fleet = $/hr
  const recentBurnPerHr = usePm(() => {
    let sum = 0;
    for (const rid of Object.keys(BUDGET_HOURLY)) {
      const h = BUDGET_HOURLY[rid];
      sum += (h.slice(-3).reduce((a,v)=>a+v,0) / 3);
    }
    return sum;
  }, []);

  const projectedEOD = totalSpent + (recentBurnPerHr * HOURS_REMAINING);
  const projectedPct = totalCap > 0 ? (projectedEOD / totalCap) * 100 : 0;
  const projectedOverBy = Math.max(0, projectedEOD - totalCap);

  // Fleet hourly (for chart)
  const fleetHourly = usePm(()=>{
    const hours = 24;
    const sum = new Array(hours).fill(0);
    for (const rid of Object.keys(BUDGET_HOURLY)) {
      BUDGET_HOURLY[rid].forEach((v,i)=>{ sum[i] += v; });
    }
    return sum.map(v=>+v.toFixed(3));
  }, []);

  // Per-raven analysis
  const analysis = usePm(() => {
    return RAVENS.map(r => {
      const hours = BUDGET_HOURLY[r.id] || [];
      const recent = hours.slice(-3).reduce((a,v)=>a+v,0) / 3; // avg last 3h
      const projected = r.budget.spentUsd + recent * HOURS_REMAINING;
      const pct = r.budget.capUsd > 0 ? r.budget.spentUsd / r.budget.capUsd : 0;
      const projPct = r.budget.capUsd > 0 ? projected / r.budget.capUsd : 0;
      const earlierAvg = hours.length > 6 ? hours.slice(-9,-3).reduce((a,v)=>a+v,0) / 6 : recent;
      const trend = recent - earlierAvg; // +ve = accelerating
      return { r, recent, projected, pct, projPct, trend, hours };
    });
  }, []);

  // Categorize for the "Needs attention" rail
  const nearCap   = analysis.filter(a => a.pct >= 0.7 && a.pct < 1.0).sort((a,b)=>b.pct-a.pct);
  const overCap   = analysis.filter(a => a.pct >= 1.0);
  const willExceed= analysis.filter(a => a.pct < 1.0 && a.projPct >= 1.0).sort((a,b)=>b.projPct-a.projPct);
  const accelerating = analysis.filter(a => a.trend > 0.005 && a.pct < 0.7).sort((a,b)=>b.trend-a.trend).slice(0,3);
  const underUtilized = analysis.filter(a => a.pct < 0.1 && a.r.budget.capUsd >= 0.5).sort((a,b)=>a.pct-b.pct).slice(0,3);

  // Top drivers today (absolute spend)
  const topDrivers = usePm(() => [...analysis].sort((a,b)=>b.r.budget.spentUsd - a.r.budget.spentUsd).slice(0,5), [analysis]);

  return (
    <div className="bg2-root">
      {/* ─── Headline: today's burn situation ─── */}
      <div className="bg2-hero">
        <div className="bg2-hero-l">
          <div className="bg2-hero-label mono dim">today · {HOURS_ELAPSED}h of 24h elapsed</div>
          <div className="bg2-hero-num">
            <span className="bg2-spent mono">${totalSpent.toFixed(2)}</span>
            <span className="bg2-of mono dim">spent of</span>
            <span className="bg2-cap mono dim">${totalCap.toFixed(2)}</span>
          </div>
          <div className={`bg2-projection mono ${projectedOverBy>0?'over':'ok'}`}>
            {projectedOverBy > 0 ? (
              <>projecting <strong>${projectedEOD.toFixed(2)}</strong> by EOD · <strong>${projectedOverBy.toFixed(2)} over</strong> aggregate cap</>
            ) : (
              <>projecting <strong>${projectedEOD.toFixed(2)}</strong> by EOD · <strong>${(totalCap - projectedEOD).toFixed(2)} headroom</strong></>
            )}
          </div>
        </div>
        <div className="bg2-hero-r">
          {/* Runway bar: shows elapsed spent, projected-to-come, cap marker */}
          <BudgetRunwayBar spent={totalSpent} projected={projectedEOD} cap={totalCap} elapsedFrac={HOURS_ELAPSED/24} />
          <div className="bg2-runway-axis mono dim sm">
            <span>0</span>
            <span>now · ${totalSpent.toFixed(2)}</span>
            <span>eod · ${projectedEOD.toFixed(2)}</span>
            <span>cap · ${totalCap.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* ─── Needs attention rail ─── */}
      <div className="bg2-attention">
        <AttentionCol kind="err" icon="⊘" title="Over cap" count={overCap.length} empty="No ravens over cap — good.">
          {overCap.map(a => <AttnRow key={a.r.id} a={a} rightLabel={`${(a.pct*100).toFixed(0)}%`}/>)}
        </AttentionCol>
        <AttentionCol kind="warn" icon="⚠" title="Will exceed cap by EOD" count={willExceed.length} empty="No projected overruns.">
          {willExceed.map(a => <AttnRow key={a.r.id} a={a} rightLabel={`proj ${(a.projPct*100).toFixed(0)}%`}/>)}
        </AttentionCol>
        <AttentionCol kind="mid" icon="◐" title="Near cap (≥70%)" count={nearCap.length} empty="No ravens near cap.">
          {nearCap.map(a => <AttnRow key={a.r.id} a={a} rightLabel={`${(a.pct*100).toFixed(0)}%`}/>)}
        </AttentionCol>
        <AttentionCol kind="info" icon="↗" title="Accelerating" count={accelerating.length} empty="Burn is steady across the fleet.">
          {accelerating.map(a => <AttnRow key={a.r.id} a={a} rightLabel={`+$${a.trend.toFixed(3)}/h`}/>)}
        </AttentionCol>
      </div>

      {/* ─── Body: two cols ─── */}
      <div className="bg2-body">
        <section className="bg2-panel bg2-panel-wide">
          <div className="bg2-panel-head">
            <h4>Top drivers today</h4>
            <span className="mono dim sm">ravens ranked by absolute $ spent</span>
          </div>
          <div className="bg2-panel-body">
            {topDrivers.map((a, i) => {
              const shareOfFleet = totalSpent > 0 ? a.r.budget.spentUsd / totalSpent : 0;
              return (
                <div key={a.r.id} className="bg2-driver-row">
                  <span className="bg2-driver-rank mono dim">{i+1}</span>
                  <PersonaAvatar name={a.r.persona} size={18}/>
                  <span className="bg2-driver-name mono">{a.r.name}</span>
                  <span className="bg2-driver-persona mono dim sm">{a.r.persona}</span>
                  <span className="bg2-driver-share">
                    <span className="bg2-driver-sharebar"><span style={{width: (shareOfFleet*100)+'%'}}/></span>
                    <span className="mono dim sm">{(shareOfFleet*100).toFixed(0)}% of fleet</span>
                  </span>
                  <span className="bg2-driver-spark"><Sparkline values={a.hours} w={100} h={22}/></span>
                  <span className="bg2-driver-spent mono">${a.r.budget.spentUsd.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg2-panel">
          <div className="bg2-panel-head">
            <h4>Recommended changes</h4>
            <span className="mono dim sm">suggested cap adjustments</span>
          </div>
          <div className="bg2-panel-body bg2-recs">
            {willExceed.slice(0,3).map(a => {
              const suggested = Math.ceil(a.projected * 1.2 * 100) / 100;
              return (
                <div key={a.r.id} className="bg2-rec">
                  <div className="bg2-rec-head">
                    <span className="mono accent">{a.r.name}</span>
                    <span className="badge warn sm">will exceed</span>
                  </div>
                  <div className="bg2-rec-body mono sm">
                    projected ${a.projected.toFixed(2)} · current cap ${a.r.budget.capUsd.toFixed(2)}
                  </div>
                  <div className="bg2-rec-action mono sm">
                    <span className="dim">→ raise cap to</span> <span className="accent">${suggested.toFixed(2)}</span>
                    <button className="btn btn-xs" style={{marginLeft:'auto'}}>apply</button>
                  </div>
                </div>
              );
            })}
            {underUtilized.map(a => {
              const suggested = Math.max(0.1, Math.round(a.r.budget.spentUsd * 4 * 100) / 100 || a.r.budget.capUsd * 0.3);
              return (
                <div key={a.r.id} className="bg2-rec">
                  <div className="bg2-rec-head">
                    <span className="mono accent">{a.r.name}</span>
                    <span className="badge sm">underused</span>
                  </div>
                  <div className="bg2-rec-body mono sm">
                    used ${a.r.budget.spentUsd.toFixed(2)} of ${a.r.budget.capUsd.toFixed(2)} cap
                  </div>
                  <div className="bg2-rec-action mono sm">
                    <span className="dim">→ lower cap to</span> <span className="accent">${suggested.toFixed(2)}</span>
                    <button className="btn btn-xs" style={{marginLeft:'auto'}}>apply</button>
                  </div>
                </div>
              );
            })}
            {willExceed.length === 0 && underUtilized.length === 0 && (
              <div className="rv-empty-mini">Caps look appropriate. No changes suggested.</div>
            )}
          </div>
        </section>
      </div>

      {/* ─── Fleet chart ─── */}
      <section className="bg2-panel bg2-panel-chart">
        <div className="bg2-panel-head">
          <h4>Fleet burn · last 24h</h4>
          <span className="mono dim sm">
            peak ${Math.max(...fleetHourly).toFixed(2)}/h · avg ${(fleetHourly.reduce((a,v)=>a+v,0)/24).toFixed(2)}/h · now ${recentBurnPerHr.toFixed(2)}/h
          </span>
        </div>
        <div className="bg2-chart-body">
          <Sparkline values={fleetHourly} w={1200} h={140}/>
          <div className="bg2-chart-axis mono dim sm">
            {Array.from({length:9}).map((_,i)=>(
              <span key={i}>{(-24 + i*3)}h</span>
            ))}
            <span>now</span>
          </div>
        </div>
      </section>

      {/* ─── Full table (collapsed by default) ─── */}
      <FullFleetBudgetTable analysis={analysis} />
    </div>
  );
}

// Custom budget visualization: shows spent-so-far + projected-spend + cap
function BudgetRunwayBar({ spent, projected, cap, elapsedFrac }) {
  const capW = 100;
  const spentW = cap > 0 ? Math.min(100, (spent/cap)*100) : 0;
  const projW = cap > 0 ? Math.min(100, Math.max(0, ((projected-spent)/cap)*100)) : 0;
  const over = projected > cap;
  // elapsed-time marker on a time axis overlay
  const elapsedX = elapsedFrac * 100;
  return (
    <div className="bg2-runway">
      <div className="bg2-runway-track" style={{width: capW+'%'}}>
        <div className="bg2-runway-spent" style={{width: spentW+'%'}}/>
        <div className={`bg2-runway-proj ${over?'over':''}`} style={{left: spentW+'%', width: projW+'%'}}/>
        <div className="bg2-runway-capmark" style={{left: 100+'%'}} title="cap"/>
        <div className="bg2-runway-nowmark" style={{left: elapsedX+'%'}} title="now (time elapsed)"/>
      </div>
    </div>
  );
}

function AttentionCol({ kind, icon, title, count, empty, children }) {
  return (
    <div className={`bg2-attn bg2-attn-${kind}`}>
      <div className="bg2-attn-head">
        <span className="bg2-attn-icon">{icon}</span>
        <span className="bg2-attn-title">{title}</span>
        <span className="mono dim sm">{count}</span>
      </div>
      <div className="bg2-attn-body">
        {count === 0 ? <div className="bg2-attn-empty mono dim sm">{empty}</div> : children}
      </div>
    </div>
  );
}

function AttnRow({ a, rightLabel }) {
  return (
    <div className="bg2-attn-row">
      <PersonaAvatar name={a.r.persona} size={16}/>
      <span className="mono">{a.r.name}</span>
      <span className="mono dim sm">${a.r.budget.spentUsd.toFixed(2)}/${a.r.budget.capUsd.toFixed(2)}</span>
      <span className="bg2-attn-right mono">{rightLabel}</span>
    </div>
  );
}

function FullFleetBudgetTable({ analysis }) {
  const [open, setOpen] = usePg(false);
  const sorted = [...analysis].sort((a,b)=>b.pct - a.pct);
  return (
    <section className="bg2-panel">
      <button className="bg2-panel-head bg2-expand" onClick={()=>setOpen(o=>!o)}>
        <h4>Full fleet table <span className="mono dim sm">{analysis.length} ravens</span></h4>
        <span className="mono dim">{open ? '−' : '+'}</span>
      </button>
      {open && (
      <div className="bg2-panel-body" style={{padding:0}}>
        <table className="bg-table">
          <thead>
            <tr>
              <th>Raven</th>
              <th>Persona</th>
              <th style={{minWidth:240}}>Today</th>
              <th>Spent</th>
              <th>Cap</th>
              <th>%</th>
              <th>Proj EOD</th>
              <th>Burn (24h)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(a => (
              <tr key={a.r.id}>
                <td><span className="bg-name mono">{a.r.name}</span></td>
                <td><span className="rv-cell-persona"><PersonaAvatar name={a.r.persona} size={16}/><span className="mono">{a.r.persona}</span></span></td>
                <td><BudgetBar spent={a.r.budget.spentUsd} cap={a.r.budget.capUsd} size="md"/></td>
                <td className="mono">${a.r.budget.spentUsd.toFixed(2)}</td>
                <td className="mono dim">${a.r.budget.capUsd.toFixed(2)}</td>
                <td className="mono">{(a.pct*100).toFixed(0)}%</td>
                <td className={`mono ${a.projPct>=1?'err-ink':a.projPct>=0.8?'warn-ink':'dim'}`}>${a.projected.toFixed(2)}</td>
                <td><Sparkline values={a.hours} w={120} h={24}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

window.BudgetView = BudgetView;
