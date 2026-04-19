import type { IRegistryRepository } from '../ports/IRegistryRepository';
import type { ILiveTopologyStream } from '../ports/ILiveTopologyStream';
import type { IEventStream } from '../ports/IEventStream';
import type { TypeRegistry } from '../domain/registry';
import type { TopologySnapshot } from '../domain/topology';
import type { EventSource } from '../domain/events';

// ── Seed registry — ported from data.jsx::DEFAULT_REGISTRY ────────────────
// Matches SDD §4.1 entity-type schema.
const SEED_REGISTRY: TypeRegistry = {
  version: 7,
  updatedAt: '2026-04-15T09:24:11Z',
  types: [
    // Topology
    {
      id: 'realm',
      label: 'Realm',
      rune: 'ᛞ',
      icon: 'globe',
      shape: 'ring',
      color: 'ice-100',
      size: 18,
      border: 'solid',
      canContain: ['cluster', 'host', 'ravn_long', 'valkyrie', 'printer', 'vaettir', 'beacon'],
      parentTypes: [],
      category: 'topology',
      description:
        'VLAN-scoped network zone — asgard, midgard, svartalfheim, etc. Every entity lives in exactly one realm.',
      fields: [
        { key: 'vlan', label: 'VLAN', type: 'number', required: true },
        { key: 'dns', label: 'DNS zone', type: 'string', required: true },
        { key: 'purpose', label: 'Purpose', type: 'string' },
      ],
    },
    {
      id: 'cluster',
      label: 'Cluster',
      rune: 'ᚲ',
      icon: 'layers',
      shape: 'ring-dashed',
      color: 'ice-200',
      size: 14,
      border: 'dashed',
      canContain: ['service', 'raid', 'tyr', 'bifrost', 'volundr', 'valkyrie', 'mimir'],
      parentTypes: ['realm'],
      category: 'topology',
      description:
        'Kubernetes cluster nested inside a realm. Valaskjálf, Valhalla, Nóatún, Eitri, Glitnir, Járnviðr.',
      fields: [
        { key: 'purpose', label: 'Purpose', type: 'string' },
        { key: 'nodes', label: 'Nodes', type: 'number' },
      ],
    },
    // Hardware
    {
      id: 'host',
      label: 'Host',
      rune: 'ᚦ',
      icon: 'server',
      shape: 'rounded-rect',
      color: 'slate-400',
      size: 22,
      border: 'solid',
      canContain: ['ravn_long', 'service'],
      parentTypes: ['realm'],
      category: 'hardware',
      description: 'Bare-metal or VM. DGX Sparks, Mac minis, EPYC boxes, user laptops.',
      fields: [
        { key: 'hw', label: 'Hardware', type: 'string' },
        { key: 'os', label: 'OS', type: 'string' },
        { key: 'cores', label: 'Cores', type: 'number' },
        { key: 'ram', label: 'RAM', type: 'string' },
        { key: 'gpu', label: 'GPU', type: 'string' },
      ],
    },
    // Agents
    {
      id: 'ravn_long',
      label: 'Long-lived Ravn',
      rune: 'ᚱ',
      icon: 'bird',
      shape: 'diamond',
      color: 'brand',
      size: 11,
      border: 'solid',
      canContain: [],
      parentTypes: ['host', 'cluster', 'realm'],
      category: 'agent',
      description:
        'Persistent raven agent bound to a host or free-orbiting around Mímir. Persona, specialty, tool access.',
      fields: [
        {
          key: 'persona',
          label: 'Persona',
          type: 'select',
          options: ['thought', 'memory', 'strength', 'battle', 'noise', 'valkyrie'],
        },
        { key: 'specialty', label: 'Specialty', type: 'string' },
        { key: 'tokens', label: 'Tokens', type: 'number' },
      ],
    },
    {
      id: 'ravn_raid',
      label: 'Raid Ravn',
      rune: 'ᚲ',
      icon: 'bird',
      shape: 'triangle',
      color: 'ice-300',
      size: 8,
      border: 'solid',
      canContain: [],
      parentTypes: ['raid'],
      category: 'agent',
      description: 'Ephemeral raven conscripted into a raid. Coord, Reviewer, or Scholar role.',
      fields: [
        {
          key: 'role',
          label: 'Role',
          type: 'select',
          options: ['coord', 'reviewer', 'scholar'],
        },
        { key: 'confidence', label: 'Confidence', type: 'number' },
      ],
    },
    {
      id: 'skuld',
      label: 'Skuld',
      rune: 'ᛜ',
      icon: 'radio',
      shape: 'hex',
      color: 'ice-200',
      size: 9,
      border: 'solid',
      canContain: [],
      parentTypes: ['raid', 'cluster'],
      category: 'agent',
      description: 'WebSocket broker — pair-bonded to a raid for chat fan-out.',
      fields: [],
    },
    {
      id: 'valkyrie',
      label: 'Valkyrie',
      rune: 'ᛒ',
      icon: 'shield',
      shape: 'chevron',
      color: 'brand-400',
      size: 13,
      border: 'solid',
      canContain: [],
      parentTypes: ['cluster', 'realm'],
      category: 'agent',
      description:
        'Autonomous guardian agent. Takes action at the cluster level — restarts, failovers, scale events.',
      fields: [
        { key: 'specialty', label: 'Specialty', type: 'string' },
        {
          key: 'autonomy',
          label: 'Autonomy',
          type: 'select',
          options: ['full', 'notify', 'restricted'],
        },
      ],
    },
    // Coordinators
    {
      id: 'tyr',
      label: 'Týr',
      rune: 'ᛃ',
      icon: 'git-branch',
      shape: 'square',
      color: 'brand',
      size: 16,
      border: 'solid',
      canContain: [],
      parentTypes: ['cluster', 'realm'],
      category: 'coordinator',
      description:
        'Saga / raid orchestrator. One per cluster; dispatches raids to coordinate work across Völundrs.',
      fields: [
        { key: 'activeSagas', label: 'Active sagas', type: 'number' },
        { key: 'pendingRaids', label: 'Pending raids', type: 'number' },
        { key: 'mode', label: 'Mode', type: 'select', options: ['active', 'standby'] },
      ],
    },
    {
      id: 'bifrost',
      label: 'Bifröst',
      rune: 'ᚨ',
      icon: 'waves',
      shape: 'pentagon',
      color: 'brand',
      size: 15,
      border: 'solid',
      canContain: ['model'],
      parentTypes: ['cluster', 'realm'],
      category: 'coordinator',
      description:
        'LLM gateway. Routes inference to providers — Anthropic, OpenAI, Google, local Ollama, local vLLM.',
      fields: [
        { key: 'reqPerMin', label: 'Req/min', type: 'number' },
        { key: 'cacheHitRate', label: 'Cache hit %', type: 'number' },
        { key: 'providers', label: 'Providers', type: 'tags' },
      ],
    },
    {
      id: 'volundr',
      label: 'Völundr',
      rune: 'ᚲ',
      icon: 'hammer',
      shape: 'square',
      color: 'brand',
      size: 16,
      border: 'solid',
      canContain: [],
      parentTypes: ['cluster', 'realm'],
      category: 'coordinator',
      description:
        'Session forge — spawns and manages remote development pods. Directly connected to Týrs.',
      fields: [
        { key: 'activeSessions', label: 'Active', type: 'number' },
        { key: 'maxSessions', label: 'Max', type: 'number' },
      ],
    },
    // Knowledge
    {
      id: 'mimir',
      label: 'Mímir',
      rune: 'ᛗ',
      icon: 'book-open',
      shape: 'mimir',
      color: 'ice-100',
      size: 42,
      border: 'solid',
      canContain: ['mimir_sub'],
      parentTypes: ['cluster', 'realm'],
      category: 'knowledge',
      description:
        'The well of knowledge. Primary indexer. All long-lived ravens read from and write to Mímir.',
      fields: [
        { key: 'pages', label: 'Pages', type: 'number' },
        { key: 'writes', label: 'Writes', type: 'number' },
      ],
    },
    {
      id: 'mimir_sub',
      label: 'Sub-Mímir',
      rune: 'ᛗ',
      icon: 'book-marked',
      shape: 'mimir-small',
      color: 'ice-200',
      size: 18,
      border: 'solid',
      canContain: [],
      parentTypes: ['mimir'],
      category: 'knowledge',
      description: 'Domain-scoped Mímir — code, ops, lore. Sits in orbit around the primary Mímir.',
      fields: [{ key: 'purpose', label: 'Purpose', type: 'string' }],
    },
    // Infrastructure / Devices
    {
      id: 'service',
      label: 'Service',
      rune: 'ᛦ',
      icon: 'box',
      shape: 'dot',
      color: 'ice-300',
      size: 8,
      border: 'solid',
      canContain: [],
      parentTypes: ['cluster', 'host'],
      category: 'infrastructure',
      description:
        'Kubernetes workload — Sleipnir, Keycloak, OpenBao, Cerbos, Harbor, Grafana, vLLM, Ollama, etc.',
      fields: [
        {
          key: 'svcType',
          label: 'Type',
          type: 'select',
          options: [
            'rabbitmq',
            'auth',
            'secrets',
            'authz',
            'database',
            'inference',
            'registry',
            'gitops',
            'dashboard',
            'logs',
            'traces',
            'media',
            'manufacturing',
            'orchestrator',
          ],
        },
      ],
    },
    {
      id: 'model',
      label: 'LLM Model',
      rune: 'ᛖ',
      icon: 'cpu',
      shape: 'dot',
      color: 'slate-300',
      size: 7,
      border: 'solid',
      canContain: [],
      parentTypes: ['bifrost', 'realm'],
      category: 'knowledge',
      description:
        'Inference endpoint behind Bifröst. External (Anthropic, OpenAI, Google) drawn as long threads; internal (vLLM, Ollama) short.',
      fields: [
        { key: 'provider', label: 'Provider', type: 'string' },
        { key: 'location', label: 'Location', type: 'select', options: ['internal', 'external'] },
      ],
    },
    {
      id: 'printer',
      label: 'Resin Printer',
      rune: 'ᛈ',
      icon: 'printer',
      shape: 'square-sm',
      color: 'slate-400',
      size: 10,
      border: 'solid',
      canContain: [],
      parentTypes: ['realm'],
      category: 'device',
      description:
        'SLA resin printer on YDP WebSocket. Saturn 4 Ultras named after legendary weapons.',
      fields: [{ key: 'model', label: 'Model', type: 'string' }],
    },
    {
      id: 'vaettir',
      label: 'Vættir Room Node',
      rune: 'ᚹ',
      icon: 'mic',
      shape: 'square-sm',
      color: 'slate-400',
      size: 9,
      border: 'solid',
      canContain: [],
      parentTypes: ['realm'],
      category: 'device',
      description:
        'ESP32 room presence node — mmWave, mic, speaker. Named for the locale it inhabits.',
      fields: [{ key: 'sensors', label: 'Sensors', type: 'tags' }],
    },
    {
      id: 'beacon',
      label: 'Presence Beacon',
      rune: 'ᚠ',
      icon: 'wifi',
      shape: 'dot',
      color: 'slate-400',
      size: 5,
      border: 'dashed',
      canContain: [],
      parentTypes: ['realm'],
      category: 'device',
      description: 'ESPresense BLE beacon — low-power wireless presence detection.',
      fields: [],
    },
    // Composite
    {
      id: 'raid',
      label: 'Raid',
      rune: 'ᚷ',
      icon: 'users',
      shape: 'halo',
      color: 'brand',
      size: 50,
      border: 'dashed',
      canContain: ['ravn_raid', 'skuld'],
      parentTypes: ['cluster'],
      category: 'composite',
      description:
        'Ephemeral flock — ravens dispatched by a Týr to execute a saga. Forms, works, dissolves.',
      fields: [
        { key: 'purpose', label: 'Purpose', type: 'string' },
        {
          key: 'state',
          label: 'State',
          type: 'select',
          options: ['forming', 'working', 'dissolving'],
        },
        { key: 'composition', label: 'Composition', type: 'tags' },
      ],
    },
  ],
};

// ── Seed topology snapshot ─────────────────────────────────────────────────
const SEED_SNAPSHOT: TopologySnapshot = {
  entities: [
    {
      id: 'realm-asgard',
      typeId: 'realm',
      name: 'asgard',
      parentId: null,
      fields: { vlan: 10, dns: 'asgard.local', purpose: 'primary compute' },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'cluster-valaskjalf',
      typeId: 'cluster',
      name: 'valaskjalf',
      parentId: 'realm-asgard',
      fields: { purpose: 'AI workloads', nodes: 8 },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'host-dgx-01',
      typeId: 'host',
      name: 'dgx-spark-01',
      parentId: 'realm-asgard',
      fields: {
        hw: 'DGX Spark',
        os: 'Ubuntu 24.04',
        cores: 80,
        ram: '96GB',
        gpu: 'Grace Blackwell',
      },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'mimir-yggdrasil',
      typeId: 'mimir',
      name: 'yggdrasil',
      parentId: 'cluster-valaskjalf',
      fields: { pages: 42000, writes: 8730 },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'tyr-01',
      typeId: 'tyr',
      name: 'tyr-valaskjalf',
      parentId: 'cluster-valaskjalf',
      fields: { activeSagas: 3, pendingRaids: 1, mode: 'active' },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'raid-ragnarok-01',
      typeId: 'raid',
      name: 'ragnarok-01',
      parentId: 'cluster-valaskjalf',
      fields: {
        purpose: 'audit code review',
        state: 'working',
        composition: ['coord', 'reviewer', 'scholar'],
      },
      status: 'processing',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'ravn-huginn',
      typeId: 'ravn_long',
      name: 'huginn',
      parentId: 'host-dgx-01',
      fields: { persona: 'thought', specialty: 'code analysis', tokens: 140000 },
      status: 'observing',
      updatedAt: '2026-04-19T00:00:00Z',
    },
  ],
  connections: [
    { id: 'conn-tyr-raid', sourceId: 'tyr-01', targetId: 'raid-ragnarok-01', kind: 'dashed-anim' },
    { id: 'conn-ravn-mimir', sourceId: 'ravn-huginn', targetId: 'mimir-yggdrasil', kind: 'soft' },
  ],
};

// ── Mock interval (ms) between topology refreshes ─────────────────────────
const TOPOLOGY_REFRESH_INTERVAL_MS = 3000;

// ── Mock event emission interval (ms) ─────────────────────────────────────
const EVENT_EMIT_INTERVAL_MS = 2000;

// ── Factory functions ──────────────────────────────────────────────────────

export function createMockRegistryRepository(): IRegistryRepository {
  let stored: TypeRegistry = { ...SEED_REGISTRY, types: [...SEED_REGISTRY.types] };

  return {
    async loadRegistry() {
      await new Promise<void>((r) => setTimeout(r, 150));
      return stored;
    },
    async saveRegistry(registry) {
      await new Promise<void>((r) => setTimeout(r, 100));
      stored = registry;
    },
  };
}

export function createMockLiveTopologyStream(): ILiveTopologyStream {
  return {
    subscribe(onUpdate) {
      onUpdate(SEED_SNAPSHOT);
      const id = setInterval(() => onUpdate(SEED_SNAPSHOT), TOPOLOGY_REFRESH_INTERVAL_MS);
      return () => clearInterval(id);
    },
  };
}

export function createMockEventStream(): IEventStream {
  const SOURCES: EventSource[] = ['RAVN', 'TYR', 'MIMIR', 'BIFROST', 'RAID'];
  const SUBJECTS = ['huginn', 'tyr-valaskjalf', 'yggdrasil', 'bifrost-01', 'ragnarok-01'];

  return {
    subscribe(onEvent) {
      let counter = 0;
      const id = setInterval(() => {
        const source = SOURCES[counter % SOURCES.length] ?? 'RAVN';
        const subject = SUBJECTS[counter % SUBJECTS.length] ?? 'system';
        onEvent({
          id: `mock-evt-${counter}`,
          time: new Date().toISOString(),
          type: source,
          subject,
          body: `heartbeat ${counter}`,
        });
        counter++;
      }, EVENT_EMIT_INTERVAL_MS);
      return () => clearInterval(id);
    },
  };
}
