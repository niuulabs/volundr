/* global React */
// ─── Völundr · Templates · Credentials · Clusters · Launch ────

const { useState: useTS, useMemo: useTM } = React;

// ════════════════════════════════════════════════════════════
// ═══ TEMPLATES ══════════════════════════════════════════════
function TemplatesView({ ctx }) {
  const tpl = window.VOL_DATA.TEMPLATE_BY_NAME[ctx.selectedTemplate] || window.VOL_DATA.TEMPLATES[0];
  const [tab, setTab] = useTS('overview');
  return (
    <div className="v-page v-page-tpl">
      <header className="v-tpl-head">
        <div className="v-tpl-head-left">
          <div className="v-tpl-title-row">
            <CliBadge cli={tpl.cli}/>
            <h1 className="v-tpl-name mono">{tpl.name}</h1>
            {tpl.default && <span className="v-badge-tiny">default</span>}
            <span className="mono dim v-tpl-usage">· {tpl.usage} sessions launched</span>
          </div>
          <p className="v-tpl-desc">{tpl.desc}</p>
        </div>
        <div className="v-tpl-actions">
          <button className="v-btn v-btn-ghost">clone</button>
          <button className="v-btn v-btn-ghost">edit</button>
          <button className="v-btn v-btn-primary"
                  onClick={()=>{ ctx.selectTemplate(tpl.name); ctx.setShowLaunch(true); }}>
            <Icon.plus/>&nbsp;launch from this
          </button>
        </div>
      </header>

      <div className="v-tpl-tabs">
        {['overview','workspace','runtime','mcp','skills','rules'].map(t => (
          <button key={t} className={`v-sub-tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{t}</button>
        ))}
      </div>

      <div className="v-tpl-body">
        {tab === 'overview' && <TplOverview tpl={tpl}/>}
        {tab === 'workspace' && <TplWorkspace tpl={tpl}/>}
        {tab === 'runtime' && <TplRuntime tpl={tpl}/>}
        {tab === 'mcp' && <TplMcp tpl={tpl}/>}
        {tab === 'skills' && <TplPlaceholder label={`skills (${tpl.skills||0})`} empty={!tpl.skills}/>}
        {tab === 'rules'  && <TplPlaceholder label={`rules (${tpl.rules||0})`} empty={!tpl.rules}/>}
      </div>
    </div>
  );
}

function TplOverview({ tpl }) {
  return (
    <div className="v-tpl-grid">
      <Card title="CLI & model">
        <KV k="cli"   v={<CliBadge cli={tpl.cli}/>}/>
        <KV k="model" v={<ModelChip alias={tpl.model}/>}/>
      </Card>
      <Card title="Resources">
        <KV k="cpu" v={<span className="mono">{tpl.resources.cpu} cores</span>}/>
        <KV k="mem" v={<span className="mono">{tpl.resources.mem}</span>}/>
        <KV k="gpu" v={<span className="mono">{tpl.resources.gpu !== '0' ? `${tpl.resources.gpu} gpu` : '—'}</span>}/>
      </Card>
      <Card title="Workspace">
        {(tpl.repos||[]).length === 0 && !tpl.mounts
          ? <div className="v-empty-inline mono dim">blank · no sources</div>
          : <>
              {(tpl.repos||[]).map(r => (
                <div key={r} className="v-tpl-src mono"><span className="v-source-icon">❯</span> niuu/{r}</div>
              ))}
              {(tpl.mounts||[]).map(m => (
                <div key={m} className="v-tpl-src mono"><span className="v-source-icon v-mount">⌂</span> {m}</div>
              ))}
            </>}
      </Card>
      <Card title="Extensions">
        <KV k="mcp"    v={<span className="mono">{(tpl.mcp||[]).join(' · ') || '—'}</span>}/>
        <KV k="skills" v={<span className="mono">{tpl.skills||0}</span>}/>
        <KV k="rules"  v={<span className="mono">{tpl.rules||0}</span>}/>
      </Card>
    </div>
  );
}

function TplWorkspace({ tpl }) {
  return (
    <div className="v-tpl-section">
      <div className="v-tpl-section-head"><h3>Workspace sources</h3></div>
      <div className="v-tpl-ws">
        {(tpl.repos||[]).map(r => (
          <div key={r} className="v-ws-row">
            <Icon.git/>
            <span className="mono">niuu/{r}</span>
            <span className="mono dim">@main · shallow clone · depth 50</span>
          </div>
        ))}
        {(tpl.mounts||[]).map(m => (
          <div key={m} className="v-ws-row">
            <Icon.mount/>
            <span className="mono">{m}</span>
            <span className="mono dim">· local mount · rsync · read-write</span>
          </div>
        ))}
        {(!tpl.repos || !tpl.repos.length) && (!tpl.mounts || !tpl.mounts.length) && (
          <div className="v-empty mono dim">no workspace sources — pod boots with empty /workspace</div>
        )}
      </div>
    </div>
  );
}

function TplRuntime({ tpl }) {
  return (
    <div className="v-tpl-grid">
      <Card title="Image">
        <KV k="base" v={<span className="mono">ghcr.io/niuu/forge:7.2</span>}/>
        <KV k="shell" v={<span className="mono">bash + zsh</span>}/>
        <KV k="editors" v={<span className="mono">nvim · helix</span>}/>
      </Card>
      <Card title="Lifecycle">
        <KV k="idle timeout" v={<span className="mono">30m</span>}/>
        <KV k="auto-archive" v={<span className="mono">7d</span>}/>
        <KV k="post-boot" v={<span className="mono dim">— (none)</span>}/>
      </Card>
    </div>
  );
}

function TplMcp({ tpl }) {
  const MCP = {
    filesystem:{ desc:'fs read/write + glob + grep', transport:'stdio' },
    git:       { desc:'git status/log/diff/commit + PRs', transport:'stdio' },
    linear:    { desc:'issues · comments · state transitions', transport:'http' },
  };
  return (
    <div className="v-tpl-mcp">
      {(tpl.mcp||[]).map(m => (
        <div key={m} className="v-mcp-row">
          <span className="v-mcp-dot"/>
          <span className="mono v-mcp-name">{m}</span>
          <span className="v-mcp-desc">{MCP[m]?.desc || 'mcp server'}</span>
          <span className="mono dim v-mcp-trans">{MCP[m]?.transport || 'stdio'}</span>
        </div>
      ))}
      {(!tpl.mcp||!tpl.mcp.length) && <div className="v-empty mono dim">no MCP servers enabled</div>}
    </div>
  );
}

function TplPlaceholder({ label, empty }) {
  return empty
    ? <div className="v-empty mono dim">no {label}</div>
    : <div className="v-empty mono dim">{label} — detail view</div>;
}

function Card({ title, children }) {
  return (
    <section className="v-card">
      <div className="v-card-head"><h4>{title}</h4></div>
      <div className="v-card-body">{children}</div>
    </section>
  );
}

function KV({ k, v }) {
  return (
    <div className="v-kv">
      <span className="v-kv-k mono dim">{k}</span>
      <span className="v-kv-v">{v}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ═══ CREDENTIALS ════════════════════════════════════════════
function CredentialsView({ ctx }) {
  return (
    <div className="v-page v-page-creds">
      <header className="v-creds-head">
        <div>
          <h1>Credentials</h1>
          <p className="dim">Secrets injected into pods as env vars or mounted files. Rotated centrally.</p>
        </div>
        <button className="v-btn v-btn-primary"><Icon.plus/>&nbsp;new credential</button>
      </header>

      <table className="v-creds-table">
        <thead>
          <tr>
            <th>name</th>
            <th>type</th>
            <th>keys</th>
            <th>scope</th>
            <th className="num">used</th>
            <th>updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {window.VOL_DATA.CREDENTIALS.map(c => (
            <tr key={c.id}>
              <td>
                <div className="v-cred-namecell">
                  <span className="v-cred-dot"/>
                  <span className="mono v-cred-name">{c.name}</span>
                </div>
              </td>
              <td><span className="v-cred-type mono">{c.type.replace('_',' ')}</span></td>
              <td>
                <div className="v-cred-keys">
                  {c.keys.map(k => <code key={k} className="v-cred-key">{k}</code>)}
                </div>
              </td>
              <td><span className="mono dim">{c.scope}</span></td>
              <td className="num mono">{c.used}</td>
              <td className="mono dim">{c.updated}</td>
              <td>
                <div className="v-cred-actions">
                  <IconBtn title="rotate"><Icon.refresh/></IconBtn>
                  <IconBtn title="copy"><Icon.copy/></IconBtn>
                  <IconBtn title="delete" danger><Icon.trash/></IconBtn>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ═══ CLUSTERS ═══════════════════════════════════════════════
function ClustersView({ ctx }) {
  const c = window.VOL_DATA.CLUSTER_BY_ID[ctx.selectedCluster] || window.VOL_DATA.CLUSTERS[0];
  const clusterSessions = window.VOL_DATA.SESSIONS.filter(s => s.cluster === c.id && (s.status==='active' || s.status==='booting'));

  return (
    <div className="v-page v-page-clusters">
      <header className="v-cl-head">
        <div>
          <div className="v-cl-title-row">
            <span className={`v-cluster-kind-badge v-cluster-${c.kind}`}>{c.kind}</span>
            <h1 className="v-cl-name">{c.name}</h1>
            <span className="mono dim">· {c.realm}</span>
            <StatusPill status={c.status==='healthy'?'active':c.status==='warning'?'booting':'error'}/>
          </div>
          <div className="v-cl-sub mono dim">{c.region} · {c.nodes.ready}/{c.nodes.total} nodes ready</div>
        </div>
        <div className="v-cl-actions">
          <button className="v-btn v-btn-ghost">cordon</button>
          <button className="v-btn v-btn-ghost">drain</button>
          <button className="v-btn v-btn-primary"
                  onClick={()=>{ ctx.setShowLaunch(true); }}>
            <Icon.plus/>&nbsp;forge here
          </button>
        </div>
      </header>

      <section className="v-cl-meters">
        <ResourcePanel label="CPU"   used={c.cpu.used} total={c.cpu.total} unit={c.cpu.unit}/>
        <ResourcePanel label="MEMORY" used={c.mem.used} total={c.mem.total} unit={c.mem.unit}/>
        <ResourcePanel label="GPU"    used={c.gpu?.used||0} total={c.gpu?.total||0} unit={c.gpu?.kind || '—'}/>
        <ResourcePanel label="DISK"   used={c.disk.used} total={c.disk.total} unit={c.disk.unit}/>
      </section>

      <div className="v-cl-grid">
        <section className="v-panel">
          <header className="v-panel-head">
            <div className="v-panel-title">
              <h2>Pods on this forge</h2>
              <span className="mono dim">{clusterSessions.length}</span>
            </div>
          </header>
          <div className="v-cl-podlist">
            {clusterSessions.length === 0
              ? <div className="v-empty mono dim">no active pods</div>
              : clusterSessions.map(s => (
                <button key={s.id} className="v-cl-pod" onClick={()=>{ ctx.selectSession(s.id); ctx.setTab('sessions'); }}>
                  <StatusDot status={s.status==='active' && s.activity==='idle'?'idle':s.status}/>
                  <span className="mono v-cl-pod-name">{s.name}</span>
                  <span className="mono dim">{s.cpu?.used?.toFixed(1)}c · {s.mem?.used?.toFixed(1)}Gi</span>
                  <CliBadge cli={s.cli} compact/>
                </button>
              ))}
          </div>
        </section>

        <section className="v-panel">
          <header className="v-panel-head">
            <div className="v-panel-title"><h2>Nodes</h2><span className="mono dim">{c.nodes.ready}/{c.nodes.total}</span></div>
          </header>
          <div className="v-cl-nodes">
            {Array.from({length: c.nodes.total}).map((_,i) => (
              <div key={i} className="v-cl-node">
                <div className="v-cl-node-head mono">
                  <span className="v-cl-node-dot" style={{background: i<c.nodes.ready ? 'var(--brand-500)' : 'var(--color-critical)'}}/>
                  {c.id}-{String(i+1).padStart(2,'0')}
                </div>
                <div className="v-cl-node-meters">
                  <MiniBar pct={Math.random()*0.7 + 0.1} label="cpu"/>
                  <MiniBar pct={Math.random()*0.7 + 0.1} label="mem"/>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ResourcePanel({ label, used, total, unit }) {
  const pct = total > 0 ? used / total : 0;
  return (
    <div className="v-rp">
      <div className="v-rp-head">
        <span className="v-rp-label">{label}</span>
        <span className="mono dim">{unit}</span>
      </div>
      <div className="v-rp-value mono">
        {total === 0 ? '—' : <>{used}<span className="dim op">/</span>{total}</>}
      </div>
      <div className="v-rp-bar">
        <div className="v-rp-fill" style={{width:`${(pct*100).toFixed(0)}%`, background: pct>0.85?'var(--color-critical)':pct>0.6?'var(--brand-400)':'var(--brand-500)'}}/>
      </div>
      <div className="v-rp-pct mono dim">{total===0 ? 'not provisioned' : `${(pct*100).toFixed(0)}% used`}</div>
    </div>
  );
}

function MiniBar({ pct, label }) {
  return (
    <div className="v-minibar">
      <span className="mono tiny dim">{label}</span>
      <div className="v-meter-bar tiny"><div className="v-meter-fill" style={{width:`${pct*100}%`}}/></div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ═══ LAUNCH WIZARD (modal) ══════════════════════════════════
function LaunchWizard({ ctx, onClose }) {
  const [step, setStep] = useTS('template'); // template · source · runtime · confirm · booting
  const [form, setForm] = useTS(() => {
    const tpl = window.VOL_DATA.TEMPLATE_BY_NAME[ctx.selectedTemplate] || window.VOL_DATA.TEMPLATES[0];
    return {
      template: tpl.name, cli: tpl.cli, model: tpl.model,
      cluster: ctx.selectedCluster,
      source: { type:'git', repo:'niuu/volundr', branch:'main' },
      name: '',
      resources: { ...tpl.resources },
      mcp: [...(tpl.mcp||[])],
      permission: 'restricted',
    };
  });
  const [bootProgress, setBootProgress] = useTS(0);
  const [bootStep, setBootStep] = useTS(0);

  React.useEffect(()=>{
    if (step !== 'booting') return;
    let i = 0;
    const tick = () => {
      i++;
      setBootStep(s => Math.min(s + 1, window.VOL_DATA.BOOT_STEPS.length - 1));
      setBootProgress(p => Math.min(1, p + 1/window.VOL_DATA.BOOT_STEPS.length));
      if (i < window.VOL_DATA.BOOT_STEPS.length - 1) {
        setTimeout(tick, 900);
      }
    };
    setTimeout(tick, 600);
  }, [step]);

  const steps = ['template','source','runtime','confirm'];
  const stepIdx = steps.indexOf(step);

  const update = (patch) => setForm(f => ({ ...f, ...patch }));

  return (
    <div className="v-overlay" onClick={onClose}>
      <div className="v-wizard" onClick={e=>e.stopPropagation()}>
        <header className="v-wiz-head">
          <div>
            <div className="v-wiz-kicker mono dim">forge a new session</div>
            <h2>{step === 'booting' ? 'Forging…' : 'Launch pod'}</h2>
          </div>
          <button className="v-wiz-close" onClick={onClose}><Icon.x/></button>
        </header>

        {step !== 'booting' && (
          <div className="v-wiz-steps">
            {steps.map((s, i) => (
              <div key={s} className={`v-wiz-step ${stepIdx===i?'active':''} ${stepIdx>i?'done':''}`}>
                <span className="v-wiz-step-n mono">{i+1}</span>
                <span>{s}</span>
                {i < steps.length-1 && <span className="v-wiz-step-sep"/>}
              </div>
            ))}
          </div>
        )}

        <div className="v-wiz-body">
          {step === 'template' && <WizTemplate form={form} update={update}/>}
          {step === 'source'   && <WizSource   form={form} update={update}/>}
          {step === 'runtime'  && <WizRuntime  form={form} update={update}/>}
          {step === 'confirm'  && <WizConfirm  form={form}/>}
          {step === 'booting'  && <WizBooting  form={form} bootStep={bootStep} progress={bootProgress}/>}
        </div>

        {step !== 'booting' && (
          <footer className="v-wiz-foot">
            {stepIdx > 0 ? <button className="v-btn v-btn-ghost" onClick={()=>setStep(steps[stepIdx-1])}>back</button> : <div/>}
            <div className="v-wiz-foot-right">
              {step === 'confirm'
                ? <button className="v-btn v-btn-primary" onClick={()=>setStep('booting')}><Icon.anvil/>&nbsp;forge session</button>
                : <button className="v-btn v-btn-primary" onClick={()=>setStep(steps[stepIdx+1])}>continue <Icon.chev/></button>}
            </div>
          </footer>
        )}

        {step === 'booting' && (
          <footer className="v-wiz-foot">
            <div/>
            <button className="v-btn v-btn-primary" disabled={bootProgress < 1} onClick={onClose}>
              {bootProgress < 1 ? 'booting…' : 'open pod →'}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function WizTemplate({ form, update }) {
  return (
    <div className="v-wiz-content">
      <div className="v-wiz-label">Template</div>
      <div className="v-wiz-templates">
        {window.VOL_DATA.TEMPLATES.map(t => (
          <button key={t.name}
                  className={`v-ql-card ${form.template===t.name?'selected':''}`}
                  onClick={()=>update({ template:t.name, cli:t.cli, model:t.model, mcp:[...(t.mcp||[])], resources:{...t.resources} })}>
            <div className="v-ql-head">
              <CliBadge cli={t.cli}/>
              {t.default && <span className="v-badge-tiny">default</span>}
            </div>
            <div className="v-ql-name mono">{t.name}</div>
            <div className="v-ql-desc">{t.desc}</div>
            <div className="v-ql-foot">
              <span className="mono dim">{t.resources.cpu}c · {t.resources.mem}</span>
              {t.resources.gpu !== '0' && <span className="mono v-ql-gpu">gpu {t.resources.gpu}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function WizSource({ form, update }) {
  return (
    <div className="v-wiz-content">
      <div className="v-wiz-label">Workspace source</div>
      <div className="v-wiz-srctabs">
        {['git','local_mount','blank'].map(t => (
          <button key={t} className={`v-sub-tab ${form.source.type===t?'active':''}`} onClick={()=>update({ source:{ type:t, repo:'niuu/volundr', branch:'main', path:'~/code/niuu' }})}>
            {t === 'local_mount' ? 'local mount' : t}
          </button>
        ))}
      </div>
      {form.source.type === 'git' && (
        <div className="v-wiz-form">
          <Field label="repository" value={form.source.repo} onChange={v=>update({ source:{...form.source, repo:v}})}/>
          <Field label="branch" value={form.source.branch} onChange={v=>update({ source:{...form.source, branch:v}})}/>
        </div>
      )}
      {form.source.type === 'local_mount' && (
        <div className="v-wiz-form">
          <Field label="path" value={form.source.path} onChange={v=>update({ source:{...form.source, path:v}})}/>
        </div>
      )}
      {form.source.type === 'blank' && (
        <div className="v-empty mono dim">pod will boot with empty /workspace</div>
      )}
      <div className="v-wiz-label" style={{marginTop:20}}>Session name (optional)</div>
      <Field placeholder="auto-generated from issue/branch if blank" value={form.name} onChange={v=>update({ name:v })}/>
    </div>
  );
}

function WizRuntime({ form, update }) {
  return (
    <div className="v-wiz-content">
      <div className="v-wiz-cols">
        <div>
          <div className="v-wiz-label">CLI & model</div>
          <div className="v-wiz-cli-row">
            {Object.entries(window.VOL_DATA.CLI_TOOLS).map(([id, t]) => (
              <button key={id} className={`v-wiz-cli ${form.cli===id?'selected':''}`} onClick={()=>update({ cli:id })}
                      style={form.cli===id ? { borderColor: t.color, background: `color-mix(in srgb, ${t.color} 10%, transparent)` } : {}}>
                <span className="mono" style={{color:t.color, fontSize:16}}>{t.rune}</span>
                <span className="mono">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="v-wiz-label" style={{marginTop:16}}>Model</div>
          <select className="v-input mono" value={form.model} onChange={e=>update({ model:e.target.value })}>
            {window.VOL_DATA.MODELS.map(m => <option key={m.alias} value={m.alias}>{m.alias} — {m.label} ({m.provider})</option>)}
          </select>
          <div className="v-wiz-label" style={{marginTop:16}}>Permission</div>
          <select className="v-input mono" value={form.permission} onChange={e=>update({ permission:e.target.value })}>
            <option value="restricted">restricted (ask before writes)</option>
            <option value="normal">normal (auto-write in workspace)</option>
            <option value="yolo">yolo (no prompts · use with care)</option>
          </select>
        </div>
        <div>
          <div className="v-wiz-label">Resources</div>
          <div className="v-wiz-res">
            <Field label="cpu (cores)" value={form.resources.cpu} onChange={v=>update({ resources:{...form.resources, cpu:v}})}/>
            <Field label="memory" value={form.resources.mem} onChange={v=>update({ resources:{...form.resources, mem:v}})}/>
            <Field label="gpu" value={form.resources.gpu} onChange={v=>update({ resources:{...form.resources, gpu:v}})}/>
          </div>
          <div className="v-wiz-label" style={{marginTop:16}}>Forge</div>
          <select className="v-input mono" value={form.cluster || ''} onChange={e=>update({ cluster:e.target.value })}>
            {window.VOL_DATA.CLUSTERS.map(c => {
              const hasGpu = c.gpu?.total > 0;
              const needGpu = form.resources.gpu !== '0';
              const disabled = needGpu && !hasGpu;
              return <option key={c.id} value={c.id} disabled={disabled}>{c.name} · {c.realm} {disabled ? '(no gpu)' : ''}</option>;
            })}
          </select>
        </div>
      </div>
    </div>
  );
}

function WizConfirm({ form }) {
  return (
    <div className="v-wiz-content">
      <div className="v-wiz-confirm">
        <ConfirmRow k="template" v={<span className="mono">{form.template}</span>}/>
        <ConfirmRow k="cli"      v={<CliBadge cli={form.cli}/>}/>
        <ConfirmRow k="model"    v={<ModelChip alias={form.model}/>}/>
        <ConfirmRow k="forge"    v={<ClusterChip id={form.cluster}/>}/>
        <ConfirmRow k="source"   v={<SourceLabel source={form.source}/>}/>
        <ConfirmRow k="resources" v={<span className="mono">{form.resources.cpu}c · {form.resources.mem}{form.resources.gpu!=='0'?` · gpu ${form.resources.gpu}`:''}</span>}/>
        <ConfirmRow k="mcp"       v={<span className="mono">{(form.mcp||[]).join(' · ') || '—'}</span>}/>
        <ConfirmRow k="permission" v={<span className="mono">{form.permission}</span>}/>
      </div>
    </div>
  );
}

function ConfirmRow({ k, v }) {
  return (
    <div className="v-wiz-conf-row">
      <span className="mono dim v-wiz-conf-k">{k}</span>
      <span className="v-wiz-conf-v">{v}</span>
    </div>
  );
}

function WizBooting({ form, bootStep, progress }) {
  return (
    <div className="v-wiz-content v-wiz-booting">
      <div className="v-forge-scene">
        <svg viewBox="0 0 200 80" className="v-forge-anvil" aria-hidden>
          <rect x="70" y="48" width="60" height="10" rx="1" fill="var(--brand-500)"/>
          <rect x="80" y="58" width="40" height="8" rx="1" fill="var(--brand-600)"/>
          <rect x="90" y="66" width="20" height="10" rx="1" fill="var(--brand-700)"/>
          <rect x="92" y="30" width="16" height="18" rx="2" fill="color-mix(in srgb, var(--brand-400) 60%, transparent)">
            <animate attributeName="opacity" values="0.6;1;0.7" dur="1.6s" repeatCount="indefinite"/>
          </rect>
          <circle cx="70" cy="20" r="1.2" fill="var(--brand-300)">
            <animate attributeName="cy" values="20;4;20" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="1;0;0" dur="2s" repeatCount="indefinite"/>
          </circle>
          <circle cx="100" cy="20" r="1.5" fill="var(--brand-400)">
            <animate attributeName="cy" values="20;0;20" dur="1.6s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="1;0;0" dur="1.6s" repeatCount="indefinite"/>
          </circle>
          <circle cx="130" cy="20" r="1.2" fill="var(--brand-300)">
            <animate attributeName="cy" values="20;6;20" dur="2.4s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="1;0;0" dur="2.4s" repeatCount="indefinite"/>
          </circle>
        </svg>
      </div>
      <div className="v-wiz-steplist">
        {window.VOL_DATA.BOOT_STEPS.map((s, i) => (
          <div key={s.id} className={`v-wiz-bstep ${i<bootStep?'done':''} ${i===bootStep?'active':''}`}>
            <span className="v-wiz-bstep-dot"/>
            <span className="mono">{s.label}</span>
            <span className="mono dim v-wiz-bstep-dur">{i<bootStep ? '✓' : i===bootStep ? '…' : `${s.dur}s`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div className="v-field">
      {label && <label className="mono dim">{label}</label>}
      <input className="v-input mono" value={value||''} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>
    </div>
  );
}

window.TemplatesView = TemplatesView;
window.CredentialsView = CredentialsView;
window.ClustersView = ClustersView;
window.LaunchWizard = LaunchWizard;
