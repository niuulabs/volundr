import type { ITrackerBrowserService } from '../../ports';
import type { TrackerProject, TrackerMilestone, TrackerIssue, Saga } from '../../models';

const MOCK_DELAY_MS = 150;

function delay(ms: number = MOCK_DELAY_MS): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const mockProjects: TrackerProject[] = [
  {
    id: 'proj-1',
    name: 'Buri Core Platform',
    description:
      'Core cognitive platform implementing the six-region architecture with nng synapses and distributed blackboard.',
    status: 'started',
    url: 'https://linear.app/niuu/project/buri-core',
    milestone_count: 3,
    issue_count: 8,
  },
  {
    id: 'proj-2',
    name: 'Tyr Saga Coordinator',
    description:
      'Automated decomposition of feature specs into phased raids with confidence tracking and auto-merge.',
    status: 'started',
    url: 'https://linear.app/niuu/project/tyr-saga',
    milestone_count: 2,
    issue_count: 5,
  },
  {
    id: 'proj-3',
    name: 'Volundr Web Dashboard',
    description:
      'Operational dashboard for monitoring system health, managing integrations, and viewing logs.',
    status: 'planned',
    url: 'https://linear.app/niuu/project/volundr-web',
    milestone_count: 4,
    issue_count: 11,
  },
];

const mockMilestones: Map<string, TrackerMilestone[]> = new Map([
  [
    'proj-1',
    [
      {
        id: 'ms-1a',
        project_id: 'proj-1',
        name: 'Region Bootstrap',
        description: 'Set up all six regions with nng communication',
        sort_order: 0,
        progress: 0.75,
      },
      {
        id: 'ms-1b',
        project_id: 'proj-1',
        name: 'Blackboard Integration',
        description: 'Distributed blackboard for shared state',
        sort_order: 1,
        progress: 0.4,
      },
      {
        id: 'ms-1c',
        project_id: 'proj-1',
        name: 'Persistence Layer',
        description: 'Minni YAML persistence and vector store',
        sort_order: 2,
        progress: 0.1,
      },
    ],
  ],
  [
    'proj-2',
    [
      {
        id: 'ms-2a',
        project_id: 'proj-2',
        name: 'Decomposition Engine',
        description: 'LLM-driven spec decomposition into phases and raids',
        sort_order: 0,
        progress: 0.6,
      },
      {
        id: 'ms-2b',
        project_id: 'proj-2',
        name: 'Dispatcher & Scheduling',
        description: 'Priority-based raid dispatch with confidence gating',
        sort_order: 1,
        progress: 0.2,
      },
    ],
  ],
  [
    'proj-3',
    [
      {
        id: 'ms-3a',
        project_id: 'proj-3',
        name: 'Dashboard Layout',
        description: 'AppShell, sidebar, and routing',
        sort_order: 0,
        progress: 0.9,
      },
      {
        id: 'ms-3b',
        project_id: 'proj-3',
        name: 'Saga Management UI',
        description: 'Views for sagas, phases, and raids',
        sort_order: 1,
        progress: 0.55,
      },
      {
        id: 'ms-3c',
        project_id: 'proj-3',
        name: 'Settings & Integrations',
        description: 'Configuration and IDP integration screens',
        sort_order: 2,
        progress: 0.3,
      },
      {
        id: 'ms-3d',
        project_id: 'proj-3',
        name: 'Tracker Import',
        description: 'Import projects from Linear into saga structure',
        sort_order: 3,
        progress: 0.0,
      },
    ],
  ],
]);

const mockIssues: Map<string, TrackerIssue[]> = new Map([
  [
    'proj-1',
    [
      {
        id: 'iss-1a1',
        identifier: 'NIU-101',
        title: 'Implement Skoll rapid perception loop',
        description: '',
        status: 'done',
        assignee: 'alice',
        labels: ['region', 'skoll'],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-101',
        milestone_id: 'ms-1a',
      },
      {
        id: 'iss-1a2',
        identifier: 'NIU-102',
        title: 'Wire nng pub/sub synapses between regions',
        description: '',
        status: 'in_progress',
        assignee: 'bob',
        labels: ['synapse'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-102',
        milestone_id: 'ms-1a',
      },
      {
        id: 'iss-1a3',
        identifier: 'NIU-103',
        title: 'Add Hati pattern recognition port',
        description: '',
        status: 'in_progress',
        assignee: null,
        labels: ['region', 'hati'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-103',
        milestone_id: 'ms-1a',
      },
      {
        id: 'iss-1b1',
        identifier: 'NIU-110',
        title: 'Design blackboard schema',
        description: '',
        status: 'todo',
        assignee: null,
        labels: ['blackboard'],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-110',
        milestone_id: 'ms-1b',
      },
      {
        id: 'iss-1b2',
        identifier: 'NIU-111',
        title: 'Implement attention field in blackboard',
        description: '',
        status: 'todo',
        assignee: 'charlie',
        labels: ['blackboard'],
        priority: 3,
        url: 'https://linear.app/niuu/issue/NIU-111',
        milestone_id: 'ms-1b',
      },
      {
        id: 'iss-1c1',
        identifier: 'NIU-120',
        title: 'Create Minni YAML serialization',
        description: '',
        status: 'backlog',
        assignee: null,
        labels: ['saga', 'persistence'],
        priority: 3,
        url: 'https://linear.app/niuu/issue/NIU-120',
        milestone_id: 'ms-1c',
      },
      {
        id: 'iss-1c2',
        identifier: 'NIU-121',
        title: 'Vector store adapter for Saga memory',
        description: '',
        status: 'backlog',
        assignee: null,
        labels: ['saga', 'persistence'],
        priority: 4,
        url: 'https://linear.app/niuu/issue/NIU-121',
        milestone_id: 'ms-1c',
      },
      {
        id: 'iss-1x1',
        identifier: 'NIU-130',
        title: 'Spike: evaluate nng vs ZeroMQ latency',
        description: '',
        status: 'done',
        assignee: 'alice',
        labels: ['spike'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-130',
        milestone_id: null,
      },
    ],
  ],
  [
    'proj-2',
    [
      {
        id: 'iss-2a1',
        identifier: 'NIU-201',
        title: 'LLM decomposition prompt engineering',
        description: '',
        status: 'done',
        assignee: 'bob',
        labels: ['decomposition'],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-201',
        milestone_id: 'ms-2a',
      },
      {
        id: 'iss-2a2',
        identifier: 'NIU-202',
        title: 'Phase dependency graph builder',
        description: '',
        status: 'in_progress',
        assignee: 'alice',
        labels: ['decomposition'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-202',
        milestone_id: 'ms-2a',
      },
      {
        id: 'iss-2b1',
        identifier: 'NIU-210',
        title: 'Priority queue for raid dispatch',
        description: '',
        status: 'todo',
        assignee: null,
        labels: ['dispatcher'],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-210',
        milestone_id: 'ms-2b',
      },
      {
        id: 'iss-2b2',
        identifier: 'NIU-211',
        title: 'Confidence gating logic',
        description: '',
        status: 'todo',
        assignee: null,
        labels: ['dispatcher'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-211',
        milestone_id: 'ms-2b',
      },
      {
        id: 'iss-2x1',
        identifier: 'NIU-220',
        title: 'Add tracker import endpoint',
        description: '',
        status: 'backlog',
        assignee: null,
        labels: ['api'],
        priority: 3,
        url: 'https://linear.app/niuu/issue/NIU-220',
        milestone_id: null,
      },
    ],
  ],
  [
    'proj-3',
    [
      {
        id: 'iss-3a1',
        identifier: 'NIU-301',
        title: 'AppShell with sidebar navigation',
        description: '',
        status: 'done',
        assignee: 'charlie',
        labels: ['ui'],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-301',
        milestone_id: 'ms-3a',
      },
      {
        id: 'iss-3a2',
        identifier: 'NIU-302',
        title: 'Theme provider and design tokens',
        description: '',
        status: 'done',
        assignee: 'charlie',
        labels: ['ui', 'design'],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-302',
        milestone_id: 'ms-3a',
      },
      {
        id: 'iss-3b1',
        identifier: 'NIU-310',
        title: 'SagasView list with confidence badges',
        description: '',
        status: 'done',
        assignee: 'alice',
        labels: ['ui', 'saga'],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-310',
        milestone_id: 'ms-3b',
      },
      {
        id: 'iss-3b2',
        identifier: 'NIU-311',
        title: 'DetailView with PhaseBlock and RaidRow',
        description: '',
        status: 'in_progress',
        assignee: 'bob',
        labels: ['ui', 'saga'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-311',
        milestone_id: 'ms-3b',
      },
      {
        id: 'iss-3b3',
        identifier: 'NIU-312',
        title: 'NewSagaView decomposition form',
        description: '',
        status: 'in_progress',
        assignee: 'alice',
        labels: ['ui'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-312',
        milestone_id: 'ms-3b',
      },
      {
        id: 'iss-3c1',
        identifier: 'NIU-320',
        title: 'Settings page with IDP configuration',
        description: '',
        status: 'todo',
        assignee: null,
        labels: ['settings'],
        priority: 3,
        url: 'https://linear.app/niuu/issue/NIU-320',
        milestone_id: 'ms-3c',
      },
      {
        id: 'iss-3c2',
        identifier: 'NIU-321',
        title: 'Integration adapter management UI',
        description: '',
        status: 'todo',
        assignee: null,
        labels: ['settings'],
        priority: 3,
        url: 'https://linear.app/niuu/issue/NIU-321',
        milestone_id: 'ms-3c',
      },
      {
        id: 'iss-3d1',
        identifier: 'NIU-330',
        title: 'TrackerBrowser component hierarchy',
        description: '',
        status: 'backlog',
        assignee: null,
        labels: ['ui', 'import'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-330',
        milestone_id: 'ms-3d',
      },
      {
        id: 'iss-3d2',
        identifier: 'NIU-331',
        title: 'Import wizard with repo selection',
        description: '',
        status: 'backlog',
        assignee: null,
        labels: ['ui', 'import'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-331',
        milestone_id: 'ms-3d',
      },
      {
        id: 'iss-3d3',
        identifier: 'NIU-332',
        title: 'Project-to-saga mapping logic',
        description: '',
        status: 'backlog',
        assignee: null,
        labels: ['import'],
        priority: 3,
        url: 'https://linear.app/niuu/issue/NIU-332',
        milestone_id: 'ms-3d',
      },
      {
        id: 'iss-3x1',
        identifier: 'NIU-340',
        title: 'Add dark mode toggle to settings',
        description: '',
        status: 'todo',
        assignee: null,
        labels: ['ui'],
        priority: 4,
        url: 'https://linear.app/niuu/issue/NIU-340',
        milestone_id: null,
      },
    ],
  ],
]);

export class MockTrackerBrowserService implements ITrackerBrowserService {
  async listProjects(): Promise<TrackerProject[]> {
    await delay();
    return [...mockProjects];
  }

  async getProject(projectId: string): Promise<TrackerProject> {
    await delay(100);
    const project = mockProjects.find(p => p.id === projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return { ...project };
  }

  async listMilestones(projectId: string): Promise<TrackerMilestone[]> {
    await delay();
    const milestones = mockMilestones.get(projectId);
    if (!milestones) {
      return [];
    }
    return milestones.map(m => ({ ...m }));
  }

  async listIssues(projectId: string, milestoneId?: string): Promise<TrackerIssue[]> {
    await delay(200);
    const issues = mockIssues.get(projectId);
    if (!issues) {
      return [];
    }
    if (milestoneId) {
      return issues
        .filter(i => i.milestone_id === milestoneId)
        .map(i => ({ ...i, labels: [...i.labels] }));
    }
    return issues.map(i => ({ ...i, labels: [...i.labels] }));
  }

  async importProject(projectId: string, repo: string, featureBranch: string): Promise<Saga> {
    await delay(500);
    const project = mockProjects.find(p => p.id === projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return {
      id: crypto.randomUUID(),
      tracker_id: `NIU-${Math.floor(Math.random() * 900) + 100}`,
      tracker_type: 'linear',
      slug: project.name.toLowerCase().replace(/\s+/g, '-'),
      name: project.name,
      repo,
      feature_branch: featureBranch,
      status: 'active',
      confidence: 0.5,
      created_at: new Date().toISOString(),
      phase_summary: { total: 0, completed: 0 },
    };
  }
}
