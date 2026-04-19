/* global React, PERSONA_BY_ID */
const { useMemo: _useMemo } = React;

// ─── subscription / graph validation ───
// Given a workflow (nodes + edges), compute:
//  - produces set per node (from persona.produces)
//  - consumes set per node (from persona.consumes)
//  - dead-publisher:   a persona produces an event type that no successor consumes
//  - starved-consumer: a persona consumes event types but nothing upstream produces them
//  - orphan:           node has no edges
//  - cycle:            cycle detected in directed graph (except via loop-back to retry)

function collectProduces(node) {
  if (node.kind !== 'stage') return new Set();
  const out = new Set();
  (node.members || []).forEach(m => {
    const p = PERSONA_BY_ID[m.persona];
    if (p) p.produces.forEach(e => out.add(e));
  });
  return out;
}
function collectConsumes(node) {
  if (node.kind !== 'stage') return new Set();
  const out = new Set();
  (node.members || []).forEach(m => {
    const p = PERSONA_BY_ID[m.persona];
    if (p) p.consumes.forEach(e => out.add(e));
  });
  return out;
}

function validateWorkflow(wf) {
  const issues = []; // { severity, node_id?, member_index?, code, msg, fix? }
  const byId = Object.fromEntries(wf.nodes.map(n => [n.id, n]));
  const outs = {}, ins = {};
  wf.nodes.forEach(n => { outs[n.id]=[]; ins[n.id]=[]; });
  wf.edges.forEach(e => {
    if (outs[e.from]) outs[e.from].push(e.to);
    if (ins[e.to]) ins[e.to].push(e.from);
  });

  // ── fan-in analysis ──────────────────────────────
  // A node has fan-in when it has >1 incoming edge from distinct upstream branches.
  // For each fan-in target, check:
  //   (a) join-mode sanity: if joinMode === 'all', every branch must be reachable
  //       and not terminate early (otherwise the node will hang forever).
  //   (b) per-event coverage: if the node's personas consume an event, at least
  //       one branch must produce it. If ONLY SOME branches produce it and joinMode
  //       is 'all', warn about partial-upstream (event will be undefined on some paths).
  //   (c) duplicate-publisher: if multiple branches produce the same event, warn —
  //       the consumer will see N copies. joinMode='merge' is expected; others aren't.
  wf.nodes.forEach(n => {
    const inboundFrom = ins[n.id] || [];
    if (inboundFrom.length < 2) return;
    if (n.kind !== 'stage' && n.kind !== 'gate' && n.kind !== 'end') return;

    // collect produces per branch (walking upstream from each inbound edge root)
    const branchProduces = inboundFrom.map(upId => {
      const seen = new Set(); const queue = [upId]; const acc = new Set();
      while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        const node = byId[id];
        if (node) collectProduces(node).forEach(e => acc.add(e));
        (ins[id] || []).forEach(x => queue.push(x));
      }
      return { upId, produces: acc };
    });

    const joinMode = n.joinMode || 'all';
    const myConsumes = collectConsumes(n);

    // (b) partial-upstream for joinMode='all'
    if (joinMode === 'all') {
      myConsumes.forEach(evt => {
        const producingBranches = branchProduces.filter(b => b.produces.has(evt));
        const externalEvents = ['saga.requested','tracker.issue.ingested','investigate.requested','health.requested','release.requested'];
        if (externalEvents.includes(evt)) return;
        if (producingBranches.length === 0) return; // handled by starved-consumer upstream
        if (producingBranches.length < branchProduces.length) {
          const missing = branchProduces.filter(b => !b.produces.has(evt)).map(b => byId[b.upId]?.name || b.upId).join(', ');
          issues.push({
            severity: 'warn',
            code: 'partial-upstream',
            node_id: n.id,
            msg: `Fan-in "all" — ${evt} is only produced on ${producingBranches.length}/${branchProduces.length} branches. Missing on: ${missing}.`,
            fix: `Either change join-mode to "any", produce ${evt} on every branch, or remove it from this stage's consumes.`,
            event: evt,
          });
        }
      });
    }

    // (c) duplicate publisher across branches
    const eventToBranches = {};
    branchProduces.forEach(b => b.produces.forEach(evt => {
      (eventToBranches[evt] = eventToBranches[evt] || []).push(b.upId);
    }));
    Object.entries(eventToBranches).forEach(([evt, branches]) => {
      if (branches.length > 1 && myConsumes.has(evt) && joinMode !== 'merge') {
        issues.push({
          severity: 'warn',
          code: 'duplicate-publisher',
          node_id: n.id,
          msg: `Fan-in — ${evt} is produced by ${branches.length} upstream branches. This stage will receive duplicates.`,
          fix: `Set join-mode to "merge" to deduplicate, or make branches mutually exclusive with a condition.`,
          event: evt,
        });
      }
    });
  });

  // walk successors (transitive) from each node and collect downstream consumes
  const downstreamConsumes = {};
  const upstreamProduces = {};
  const visit = (start, dir='down') => {
    const seen = new Set(); const queue = [start]; const acc = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      if (id !== start) {
        const node = byId[id];
        if (node) (dir==='down' ? collectConsumes(node) : collectProduces(node)).forEach(e => acc.add(e));
      }
      (dir==='down' ? outs[id] : ins[id]).forEach(n => queue.push(n));
    }
    return acc;
  };
  wf.nodes.forEach(n => {
    downstreamConsumes[n.id] = visit(n.id, 'down');
    upstreamProduces[n.id] = visit(n.id, 'up');
  });

  // per-stage checks
  wf.nodes.forEach(n => {
    if (n.kind === 'stage') {
      (n.members||[]).forEach((m, i) => {
        const p = PERSONA_BY_ID[m.persona];
        if (!p) return;
        // each produced event must be consumed by some downstream
        p.produces.forEach(evt => {
          const consumedDown = downstreamConsumes[n.id].has(evt);
          const isTerminal = outs[n.id].length === 1 && byId[outs[n.id][0]]?.kind === 'end';
          if (!consumedDown && !isTerminal) {
            issues.push({
              severity: 'warn',
              code: 'dead-publisher',
              node_id: n.id, member_index: i,
              msg: `${p.name} publishes ${evt}, but no downstream persona subscribes.`,
              fix: `Add a consumer downstream, or override ${p.name}'s produces map.`,
              event: evt,
            });
          }
        });
        // each consumed event must be produced somewhere upstream (unless this is the first node after trigger)
        p.consumes.forEach(evt => {
          const hasUpstream = upstreamProduces[n.id].has(evt);
          const externalEvents = ['saga.requested','tracker.issue.ingested','investigate.requested','health.requested','release.requested'];
          if (externalEvents.includes(evt)) return; // external triggers are fine
          const directFromTrigger = ins[n.id].some(id => byId[id]?.kind === 'trigger');
          if (directFromTrigger) return;
          if (!hasUpstream) {
            issues.push({
              severity: 'err',
              code: 'starved-consumer',
              node_id: n.id, member_index: i,
              msg: `${p.name} subscribes to ${evt}, but no upstream persona produces it.`,
              fix: `Add an upstream producer, or remove ${evt} from this persona for this workflow.`,
              event: evt,
            });
          }
        });
      });
      if ((n.members||[]).length === 0) {
        issues.push({ severity:'warn', code:'empty-stage', node_id:n.id, msg:`Stage "${n.name}" has no personas assigned.`, fix:'Add at least one persona.' });
      }
    }
    // isolated node
    if (ins[n.id].length === 0 && outs[n.id].length === 0 && n.kind !== 'trigger') {
      issues.push({ severity:'warn', code:'orphan', node_id:n.id, msg:`Node "${n.name||n.id}" has no connections.` });
    }
  });

  // require at least one trigger and one end
  if (!wf.nodes.some(n => n.kind==='trigger'))
    issues.push({ severity:'err', code:'no-trigger', msg:'Workflow has no trigger node.' });
  if (!wf.nodes.some(n => n.kind==='end'))
    issues.push({ severity:'warn', code:'no-end', msg:'Workflow has no end node — it will never report completion.' });

  return {
    issues,
    hasErrors: issues.some(i => i.severity === 'err'),
    inbound: ins,      // map nodeId -> [upstream nodeIds]
    outbound: outs,    // map nodeId -> [downstream nodeIds]
    summary: {
      errs: issues.filter(i => i.severity==='err').length,
      warns: issues.filter(i => i.severity==='warn').length,
    },
  };
}

// Emit a YAML-like serialization (not real YAML parser — just a nice display)
function workflowToYAML(wf) {
  const lines = [];
  lines.push(`# Workflow: ${wf.name}`);
  if (wf.description) lines.push(`# ${wf.description}`);
  lines.push(`name: "${wf.name}"`);
  lines.push(`version: "${wf.version || '0.1.0'}"`);
  lines.push(`stages:`);
  wf.nodes.filter(n => n.kind === 'stage').forEach(s => {
    lines.push(`  - name: ${s.name}`);
    if (s.joinMode && s.joinMode !== 'all') lines.push(`    join: ${s.joinMode}`);
    lines.push(`    personas:`);
    (s.members||[]).forEach(m => {
      lines.push(`      - name: ${m.persona}`);
      if (m.budget) lines.push(`        iteration_budget: ${m.budget}`);
    });
    // find edges w/ conditions targeting this stage
    const inEdges = wf.edges.filter(e => e.to === s.id && e.cond);
    if (inEdges.length)
      lines.push(`    condition: "${inEdges.map(e=>e.cond).join(' && ')}"`);
  });
  lines.push(`gates:`);
  wf.nodes.filter(n=>n.kind==='gate').forEach(g => lines.push(`  - name: ${g.name}`));
  lines.push(`conditions:`);
  wf.nodes.filter(n=>n.kind==='cond').forEach(c => lines.push(`  - ${c.name}: "${c.expr || ''}"`));
  return lines.join('\n');
}

function highlightYAML(src) {
  const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return esc(src)
    .replace(/(^#.*)/gm, '<span class="yml-comment">$1</span>')
    .replace(/^(\s*)([a-zA-Z_][\w-]*):/gm, '$1<span class="yml-key">$2</span>:')
    .replace(/"([^"]*)"/g, '<span class="yml-str">"$1"</span>')
    .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="yml-num">$1</span>');
}

Object.assign(window, { validateWorkflow, workflowToYAML, highlightYAML });
