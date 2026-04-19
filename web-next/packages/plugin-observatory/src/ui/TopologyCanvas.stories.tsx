import type { Meta, StoryObj } from '@storybook/react';
import { TopologyCanvas } from './TopologyCanvas';
import type { TopologySnapshot } from '../domain/topology';
import storyStyles from './TopologyCanvas.stories.module.css';

// ── Mock data ─────────────────────────────────────────────────────────────────

const FULL_SNAPSHOT: TopologySnapshot = {
  entities: [
    // Mímir
    {
      id: 'mimir-main',
      typeId: 'mimir',
      name: 'Yggdrasil',
      parentId: null,
      fields: { pages: 42000, writes: 8730 },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Sub-Mímirs
    {
      id: 'mimir-code',
      typeId: 'mimir_sub',
      name: 'Mímir/Code',
      parentId: 'mimir-main',
      fields: { purpose: 'codebase navigation' },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'mimir-ops',
      typeId: 'mimir_sub',
      name: 'Mímir/Ops',
      parentId: 'mimir-main',
      fields: { purpose: 'runbooks' },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Realms
    {
      id: 'realm-asgard',
      typeId: 'realm',
      name: 'Asgard',
      parentId: null,
      fields: { vlan: 90, dns: 'asgard.niuu.world', purpose: 'AI compute' },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'realm-vanaheim',
      typeId: 'realm',
      name: 'Vanaheim',
      parentId: null,
      fields: { vlan: 80, dns: 'vanaheim.niuu.world', purpose: 'infrastructure' },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'realm-svartalfheim',
      typeId: 'realm',
      name: 'Svartalfheim',
      parentId: null,
      fields: { vlan: 40, dns: 'svartalfheim.niuu.world', purpose: 'workshop' },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'realm-midgard',
      typeId: 'realm',
      name: 'Midgard',
      parentId: null,
      fields: { vlan: 60, dns: 'midgard.niuu.world', purpose: 'home / general' },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Clusters
    {
      id: 'cluster-valaskjalf',
      typeId: 'cluster',
      name: 'Valaskjálf',
      parentId: 'realm-asgard',
      fields: { purpose: 'DGX Spark', nodes: 8 },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'cluster-eitri',
      typeId: 'cluster',
      name: 'Eitri',
      parentId: 'realm-svartalfheim',
      fields: { purpose: 'workshop k8s', nodes: 3 },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Hosts
    {
      id: 'host-tanngrisnir',
      typeId: 'host',
      name: 'Tanngrisnir',
      parentId: 'realm-asgard',
      fields: { hw: 'DGX Spark', os: 'Ubuntu 24', cores: 144, ram: '1TiB', gpu: 'GH200' },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'host-saga',
      typeId: 'host',
      name: 'Saga',
      parentId: 'realm-vanaheim',
      fields: { hw: 'TrueNAS', os: 'TrueNAS Scale', cores: 16 },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Coordinators
    {
      id: 'tyr-01',
      typeId: 'tyr',
      name: 'Tyr',
      parentId: 'cluster-valaskjalf',
      fields: { activeSagas: 3, pendingRaids: 2, mode: 'active' },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'bifrost-01',
      typeId: 'bifrost',
      name: 'Bifrost',
      parentId: 'cluster-valaskjalf',
      fields: { reqPerMin: 42, cacheHitRate: 0.68, providers: ['Anthropic', 'OpenAI', 'Google'] },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'volundr-01',
      typeId: 'volundr',
      name: 'Völundr',
      parentId: 'cluster-valaskjalf',
      fields: { activeSessions: 5, maxSessions: 20 },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Models (Bifröst fan-out)
    {
      id: 'model-claude',
      typeId: 'model',
      name: 'Claude Sonnet',
      parentId: 'bifrost-01',
      fields: { provider: 'Anthropic', location: 'external' },
      status: 'idle',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'model-gpt4',
      typeId: 'model',
      name: 'GPT-4o',
      parentId: 'bifrost-01',
      fields: { provider: 'OpenAI', location: 'external' },
      status: 'idle',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'model-ollama',
      typeId: 'model',
      name: 'Ollama',
      parentId: 'bifrost-01',
      fields: { provider: 'Local', location: 'internal' },
      status: 'idle',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Agents
    {
      id: 'ravn-huginn',
      typeId: 'ravn_long',
      name: 'Huginn',
      parentId: 'host-tanngrisnir',
      fields: { persona: 'thought', specialty: 'code analysis', tokens: 140000 },
      status: 'observing',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'ravn-muninn',
      typeId: 'ravn_long',
      name: 'Muninn',
      parentId: 'host-tanngrisnir',
      fields: { persona: 'memory', specialty: 'history', tokens: 180000 },
      status: 'running',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'raid-ragnarok',
      typeId: 'raid',
      name: 'ragnarok-01',
      parentId: 'cluster-valaskjalf',
      fields: { purpose: 'audit code review', state: 'working', composition: ['coord', 'reviewer'] },
      status: 'processing',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Services
    {
      id: 'svc-pg',
      typeId: 'service',
      name: 'PostgreSQL',
      parentId: 'cluster-valaskjalf',
      fields: { svcType: 'database' },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    {
      id: 'svc-keycloak',
      typeId: 'service',
      name: 'Keycloak',
      parentId: 'cluster-valaskjalf',
      fields: { svcType: 'auth' },
      status: 'healthy',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Valkyrie
    {
      id: 'valk-brynhildr',
      typeId: 'valkyrie',
      name: 'Brynhildr',
      parentId: 'realm-vanaheim',
      fields: { specialty: 'production guardian', autonomy: 'full' },
      status: 'observing',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // Device
    {
      id: 'beacon-office',
      typeId: 'beacon',
      name: 'ESPresense/Office',
      parentId: 'realm-midgard',
      fields: {},
      status: 'idle',
      updatedAt: '2026-04-19T00:00:00Z',
    },
  ],
  connections: [
    { id: 'c1', sourceId: 'tyr-01',     targetId: 'volundr-01',   kind: 'solid'       },
    { id: 'c2', sourceId: 'tyr-01',     targetId: 'raid-ragnarok', kind: 'dashed-anim' },
    { id: 'c3', sourceId: 'bifrost-01', targetId: 'model-claude',  kind: 'dashed-long' },
    { id: 'c4', sourceId: 'bifrost-01', targetId: 'model-gpt4',    kind: 'dashed-long' },
    { id: 'c5', sourceId: 'ravn-huginn',targetId: 'mimir-main',    kind: 'soft'        },
    { id: 'c6', sourceId: 'ravn-muninn',targetId: 'mimir-main',    kind: 'soft'        },
    { id: 'c7', sourceId: 'tyr-01',     targetId: 'ravn-huginn',   kind: 'raid'        },
  ],
};

const meta: Meta<typeof TopologyCanvas> = {
  title: 'Observatory/TopologyCanvas',
  component: TopologyCanvas,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className={storyStyles.storyWrap}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TopologyCanvas>;

export const WithMockTopology: Story = {
  name: 'Mock topology (full)',
  args: {
    snapshot: FULL_SNAPSHOT,
    showMinimap: true,
  },
};

export const MinimapHidden: Story = {
  name: 'Minimap hidden',
  args: {
    snapshot: FULL_SNAPSHOT,
    showMinimap: false,
  },
};

export const EmptyState: Story = {
  name: 'Empty / loading (null snapshot)',
  args: {
    snapshot: null,
    showMinimap: true,
  },
};

export const MinimalTopology: Story = {
  name: 'Minimal — Mímir + two realms + Týr',
  args: {
    snapshot: {
      entities: [
        {
          id: 'mimir-main',
          typeId: 'mimir',
          name: 'Yggdrasil',
          parentId: null,
          fields: { pages: 100, writes: 10 },
          status: 'running',
          updatedAt: '2026-04-19T00:00:00Z',
        },
        {
          id: 'realm-a',
          typeId: 'realm',
          name: 'Asgard',
          parentId: null,
          fields: { vlan: 90, dns: 'asgard.local' },
          status: 'healthy',
          updatedAt: '2026-04-19T00:00:00Z',
        },
        {
          id: 'realm-b',
          typeId: 'realm',
          name: 'Vanaheim',
          parentId: null,
          fields: { vlan: 80, dns: 'vanaheim.local' },
          status: 'healthy',
          updatedAt: '2026-04-19T00:00:00Z',
        },
        {
          id: 'tyr-01',
          typeId: 'tyr',
          name: 'Tyr',
          parentId: 'realm-a',
          fields: { activeSagas: 1, pendingRaids: 0, mode: 'active' },
          status: 'running',
          updatedAt: '2026-04-19T00:00:00Z',
        },
      ],
      connections: [
        { id: 'c1', sourceId: 'tyr-01', targetId: 'mimir-main', kind: 'soft' },
      ],
    },
    showMinimap: true,
  },
};
