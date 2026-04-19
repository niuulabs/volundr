/* global React, RAVN_DATA, PersonaAvatar, StateBadge, Seg, Kbd, Metric */
// ─── Ravn sessions page — thread + chat + timeline ──

const { useState: useSv, useMemo: useSvm, useEffect: useSve, useRef: useSvr } = React;

function SessionsView({ ctx }) {
  const { selectedSessionId, selectSession } = ctx;
  const { SESSIONS, SESSION_MESSAGES, RAVEN_BY_ID, PERSONA_BY_NAME } = window.RAVN_DATA;
  const session = SESSIONS.find(s => s.id === selectedSessionId) || SESSIONS[0];
  const raven = RAVEN_BY_ID[session.ravnId];
  const persona = PERSONA_BY_NAME[raven?.persona];

  // Messages: use the rich one for s-419, else synthesize a short one
  const messages = SESSION_MESSAGES[session.id] || synthesiseMessages(session, raven);

  const scrollRef = useSvr(null);
  useSve(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [session.id]);

  return (
    <div className="ss-root">
      {/* Session header */}
      <div className="ss-head">
        <div className="ss-head-l">
          <PersonaAvatar name={raven?.persona} size={34}/>
          <div className="ss-head-title">
            <div className="ss-title-row">
              <h2 className="ss-title">{session.title}</h2>
              <StateBadge state={session.state}/>
            </div>
            <div className="ss-head-meta mono dim sm">
              <span>{session.id}</span>
              <span className="sep">·</span>
              <span>raven: <strong className="fg">{raven?.name}</strong></span>
              <span className="sep">·</span>
              <span>persona: <strong className="fg">{raven?.persona}</strong></span>
              {session.triggerId && <><span className="sep">·</span><span>trigger: <strong className="fg">{session.triggerId}</strong></span></>}
            </div>
          </div>
        </div>
        <div className="ss-head-r">
          <Metric label="msgs" value={session.messageCount}/>
          <Metric label="tokens" value={fmtNum(session.tokenCount)}/>
          <Metric label="cost" value={'$'+session.costUsd.toFixed(2)} accent/>
          <div className="ss-head-actions">
            <button className="btn btn-sm">export</button>
            {session.state === 'active' && <button className="btn btn-sm">pause</button>}
            {session.state === 'active' && <button className="btn btn-sm btn-danger">abort</button>}
          </div>
        </div>
      </div>

      {/* Body: transcript + context */}
      <div className="ss-body">
        {/* Transcript */}
        <div className="ss-chat">
          <div className="ss-chat-toolbar mono sm dim">
            <span>filter:</span>
            <Seg size="sm" value="all" onChange={()=>{}} options={[
              {value:'all',label:'all'},
              {value:'chat',label:'chat only'},
              {value:'tools',label:'+ tools'},
              {value:'system',label:'+ system'},
            ]}/>
            <span className="sep">·</span>
            <span>jump: <Kbd>j</Kbd>/<Kbd>k</Kbd></span>
            <span className="ss-chat-follow">
              <span className="state-dot ok pulse"/>
              <span>following tail</span>
            </span>
          </div>

          <div className="ss-scroll" ref={scrollRef}>
            {messages.map((m, i) => <Message key={i} m={m} persona={raven?.persona}/>)}
            {session.state === 'active' && <ActiveCursor persona={raven?.persona}/>}
          </div>

          {session.state === 'active' ? (
            <div className="ss-composer">
              <div className="ss-composer-prefix mono dim">you →</div>
              <textarea className="ss-composer-ta" placeholder="Steer the raven… (shift-enter for newline, enter to send)" rows={2}/>
              <div className="ss-composer-actions">
                <span className="mono dim sm"><Kbd>/</Kbd> commands</span>
                <button className="btn btn-sm btn-primary">send</button>
              </div>
            </div>
          ) : (
            <div className="ss-composer closed">
              <span className="mono dim">session {session.state} · {fmtAt(session.lastAt)} · read-only</span>
              <button className="btn btn-sm">resume in new session</button>
            </div>
          )}
        </div>

        {/* Context drawer (timeline, injects, emissions) */}
        <aside className="ss-aside">
          <section className="ss-sec">
            <h4>Summary</h4>
            <p className="ss-summary">{session.summary}</p>
          </section>

          <section className="ss-sec">
            <h4>Timeline</h4>
            <Timeline messages={messages} startedAt={session.startedAt}/>
          </section>

          <section className="ss-sec">
            <h4>Injects <span className="mono dim sm">context this session has loaded</span></h4>
            <ul className="ss-inject-list mono sm">
              {(persona?.consumes?.injects || ['repo.tree','code.diff']).map(inj => (
                <li key={inj}><span className="chip chip-inject mono">{inj}</span> <span className="dim">· loaded</span></li>
              ))}
            </ul>
          </section>

          <section className="ss-sec">
            <h4>Emissions <span className="mono dim sm">events this session will produce</span></h4>
            {persona?.produces?.event ? (
              <div className="ss-emit">
                <span className="chip chip-event mono">{persona.produces.event}</span>
                {persona.produces.schema && (
                  <div className="ss-emit-schema mono sm">
                    {Object.entries(persona.produces.schema).map(([k,v]) => (
                      <div key={k}><span className="k">{k}</span>: <span className="v dim">{v}</span></div>
                    ))}
                  </div>
                )}
                <div className="ss-emit-status mono sm">
                  {messages.some(m => m.kind==='emit')
                    ? <><span className="state-dot ok"/>emitted at {messages.find(m=>m.kind==='emit').ts}</>
                    : <><span className="state-dot warn"/>pending · will emit on final answer</>}
                </div>
              </div>
            ) : <div className="rv-empty-mini">no emission configured</div>}
          </section>

          <section className="ss-sec">
            <h4>Raven</h4>
            <div className="ss-raven-card">
              <div className="ss-raven-row">
                <span className="mono dim sm">name</span>
                <span className="mono fg">{raven?.name}</span>
              </div>
              <div className="ss-raven-row">
                <span className="mono dim sm">location</span>
                <span className="mono fg">{raven?.location}</span>
              </div>
              <div className="ss-raven-row">
                <span className="mono dim sm">deploy</span>
                <span className="mono fg">{raven?.deployment}</span>
              </div>
              <div className="ss-raven-row">
                <span className="mono dim sm">budget</span>
                <span className="mono fg">${raven?.budget.spentUsd.toFixed(2)} / ${raven?.budget.capUsd.toFixed(2)}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Message({ m, persona }) {
  if (m.kind === 'user') {
    return (
      <div className="ss-msg ss-msg-user">
        <div className="ss-msg-rail"><span className="ss-msg-author mono">you</span></div>
        <div className="ss-msg-body">
          <div className="ss-msg-text">{m.body}</div>
          <div className="ss-msg-meta mono dim sm">{m.ts}</div>
        </div>
      </div>
    );
  }
  if (m.kind === 'assistant') {
    return (
      <div className="ss-msg ss-msg-asst">
        <div className="ss-msg-rail"><PersonaAvatar name={persona} size={22}/></div>
        <div className="ss-msg-body">
          <div className="ss-msg-author mono">{persona || 'raven'}</div>
          <div className="ss-msg-text ss-msg-prose">{m.body.split('\n').map((l,i)=><div key={i}>{l}</div>)}</div>
          <div className="ss-msg-meta mono dim sm">{m.ts}</div>
        </div>
      </div>
    );
  }
  if (m.kind === 'thought') {
    return (
      <div className="ss-msg ss-msg-thought">
        <div className="ss-msg-rail"><span className="ss-thought-glyph">∴</span></div>
        <div className="ss-msg-body">
          <div className="ss-msg-author mono dim">thought · {m.ts}</div>
          <div className="ss-msg-text ss-thought-text">{m.body}</div>
        </div>
      </div>
    );
  }
  if (m.kind === 'tool') {
    return (
      <div className="ss-msg ss-msg-tool">
        <div className="ss-msg-rail"><span className="ss-tool-glyph mono">⌁</span></div>
        <div className="ss-msg-body">
          <div className="ss-tool-line mono sm">
            <span className="ss-tool-name">{m.name}</span>
            <span className="dim">(</span><span className="ss-tool-args">{m.args}</span><span className="dim">)</span>
            <span className="ss-tool-arrow dim">→</span>
            <span className="ss-tool-result">{m.result}</span>
            <span className="dim ss-msg-ts"> · {m.ts}</span>
          </div>
        </div>
      </div>
    );
  }
  if (m.kind === 'emit') {
    return (
      <div className="ss-msg ss-msg-emit">
        <div className="ss-msg-rail"><span className="ss-emit-glyph mono">↗</span></div>
        <div className="ss-msg-body">
          <div className="ss-emit-line mono sm">
            <span className="dim">emit</span>
            <span className="chip chip-event mono">{m.body}</span>
            {m.attrs && <span className="dim">· {Object.entries(m.attrs).map(([k,v])=>`${k}=${v}`).join(' ')}</span>}
            <span className="dim ss-msg-ts"> · {m.ts}</span>
          </div>
        </div>
      </div>
    );
  }
  // system
  return (
    <div className="ss-msg ss-msg-sys">
      <div className="ss-msg-rail"><span className="mono dim">sys</span></div>
      <div className="ss-sys-line mono sm dim">{m.body} <span className="ss-msg-ts">· {m.ts}</span></div>
    </div>
  );
}

function ActiveCursor({ persona }) {
  return (
    <div className="ss-msg ss-msg-asst ss-msg-cursor">
      <div className="ss-msg-rail"><PersonaAvatar name={persona} size={22}/></div>
      <div className="ss-msg-body">
        <div className="ss-msg-author mono">{persona}</div>
        <div className="ss-thinking">
          <span className="ss-think-dot"/>
          <span className="ss-think-dot" style={{animationDelay:'120ms'}}/>
          <span className="ss-think-dot" style={{animationDelay:'240ms'}}/>
          <span className="mono dim sm">thinking…</span>
        </div>
      </div>
    </div>
  );
}

function Timeline({ messages, startedAt }) {
  const items = messages.map(m => ({
    kind: m.kind,
    ts: m.ts,
    label: timelineLabel(m),
  }));
  return (
    <ol className="ss-timeline">
      <li className="ss-tl-item ss-tl-start">
        <span className="ss-tl-dot"/>
        <span className="mono dim sm">started · {fmtAt(startedAt)}</span>
      </li>
      {items.map((it, i) => (
        <li key={i} className={`ss-tl-item kind-${it.kind}`}>
          <span className="ss-tl-dot"/>
          <span className="mono sm ss-tl-ts">{it.ts}</span>
          <span className="mono sm ss-tl-label">{it.label}</span>
        </li>
      ))}
    </ol>
  );
}

function timelineLabel(m) {
  switch (m.kind) {
    case 'system':    return 'session init';
    case 'user':      return 'user instruction';
    case 'assistant': return 'raven answer';
    case 'thought':   return 'reasoning';
    case 'tool':      return `tool · ${m.name}`;
    case 'emit':      return `emit · ${m.body}`;
    default:          return m.kind;
  }
}

function synthesiseMessages(session, raven) {
  // Short synthesis for sessions without a rich transcript
  const ts = session.lastAt ? session.lastAt.slice(11,19) : '00:00:00';
  const startTs = session.startedAt ? session.startedAt.slice(11,19) : '00:00:00';
  const msgs = [
    { kind:'system', ts:startTs, body:`session init · raven=${session.ravnId}${session.triggerId?` · trigger=${session.triggerId}`:''}` },
    { kind:'user', ts:startTs, body: taskLine(session) },
    { kind:'thought', ts:startTs, body:`Persona=${raven?.persona}. ${session.summary}` },
  ];
  if (session.state !== 'active') {
    msgs.push({ kind:'assistant', ts, body: session.summary });
    if (session.state === 'completed') msgs.push({ kind:'emit', ts, body:'work.completed' });
    if (session.state === 'failed')    msgs.push({ kind:'system', ts, body:'session aborted — budget exceeded' });
  } else {
    msgs.push({ kind:'tool', ts, name:'read', args:'…', result:'loaded' });
  }
  return msgs;
}
function taskLine(s) {
  if (s.triggerId) return `Triggered by ${s.triggerId}: ${s.title}`;
  return `Manual: ${s.title}`;
}
function fmtAt(iso) {
  if (!iso) return '—';
  return iso.slice(11,16) + ' ' + iso.slice(0,10);
}
function fmtNum(n) {
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return String(n);
}

window.SessionsView = SessionsView;
