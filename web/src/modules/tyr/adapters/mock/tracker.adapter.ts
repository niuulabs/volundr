import type { ITrackerBrowserService } from '../../ports';
import type { TrackerProject, TrackerMilestone, TrackerIssue, Saga, RepoInfo } from '../../models';

const MOCK_DELAY_MS = 150;

function delay(ms: number = MOCK_DELAY_MS): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Real data from Linear: Tyr — Saga Coordinator project
// ---------------------------------------------------------------------------

const mockProjects: TrackerProject[] = [
  {
    id: '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
    name: 'Tyr — Saga Coordinator',
    description:
      'Autonomous saga orchestrator: LLM decomposition, Völundr session dispatch, confidence-gated auto-merge, Linear as primary tracker backend',
    status: 'Planned',
    url: 'https://linear.app/niuu/project/tyr-saga-coordinator-179a14777c7b',
    milestone_count: 8,
    issue_count: 24,
  },
];

const mockRepos: RepoInfo[] = [
  {
    provider: 'github',
    org: 'niuulabs',
    name: 'volundr',
    clone_url: 'git@github.com:niuulabs/volundr.git',
    url: 'https://github.com/niuulabs/volundr',
    default_branch: 'main',
  },
  {
    provider: 'github',
    org: 'niuulabs',
    name: 'bifrost',
    clone_url: 'git@github.com:niuulabs/bifrost.git',
    url: 'https://github.com/niuulabs/bifrost',
    default_branch: 'main',
  },
  {
    provider: 'github',
    org: 'niuulabs',
    name: 'niuu-infra',
    clone_url: 'git@github.com:niuulabs/niuu-infra.git',
    url: 'https://github.com/niuulabs/niuu-infra',
    default_branch: 'main',
  },
];

const mockMilestones: Map<string, TrackerMilestone[]> = new Map([
  [
    '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
    [
      {
        id: 'dc726480-8062-4933-8b97-a57f2d442e54',
        project_id: '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
        name: 'Phase I — Foundation',
        description:
          'Domain model, port interfaces, FastAPI skeleton, hexagonal layout, PostgreSQL schema, configuration system',
        sort_order: 0,
        progress: 1.0,
      },
      {
        id: 'f1430cc0-c5d1-4051-9051-e80b5239d8b9',
        project_id: '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
        name: 'Phase II — Tracker Adapters',
        description:
          'TrackerPort interface, LinearAdapter (Project=Saga, Milestone=Phase, Issue=Raid), NativeAdapter (PostgreSQL fallback)',
        sort_order: 1,
        progress: 0.67,
      },
      {
        id: '7c763a2f-27dc-4d7b-a0bc-e0cfc4ade2cc',
        project_id: '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
        name: 'Phase III — LLM Decomposition',
        description:
          'LLMPort interface, BifröstAdapter, decomposition prompt, structured saga JSON output, initial confidence scoring',
        sort_order: 2,
        progress: 0.0,
      },
      {
        id: '32264d9f-b532-4cc8-8864-25a6458f6cfc',
        project_id: '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
        name: 'Phase IV — Git Model',
        description:
          'GitPort interface, GitHubAdapter, feature branch creation, raid branch per session, merge into feature branch',
        sort_order: 3,
        progress: 0.0,
      },
      {
        id: 'a5354979-1eac-4dc1-9b69-309790b1c876',
        project_id: '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
        name: 'Phase V — Dispatcher',
        description:
          'VölundrPort interface, VölundrHTTPAdapter, SSE subscription manager, dispatcher loop, phase gate logic',
        sort_order: 4,
        progress: 0.0,
      },
      {
        id: '64838d14-abeb-4bed-b269-b289d2d027bb',
        project_id: '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
        name: 'Phase VI — Confidence Engine',
        description:
          'ConfidencePort interface, scoring rules, configurable threshold, auto-merge gate, REVIEW trigger, rollup',
        sort_order: 5,
        progress: 0.0,
      },
      {
        id: 'bf658113-e320-4ffa-84af-2bb3e49e6177',
        project_id: '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
        name: 'Phase VII — Review Flow',
        description:
          'Human review endpoints, chronicle summary, approve/reject/retry, merge to feature branch, final MR',
        sort_order: 6,
        progress: 0.0,
      },
      {
        id: 'c883f25e-2932-43d4-92b8-327b5e55f000',
        project_id: '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
        name: 'Phase VIII — UI & Integration',
        description:
          'Wire React UI to REST API and SSE stream. End-to-end: decomposition, dispatcher, session chronicle, review',
        sort_order: 7,
        progress: 0.0,
      },
    ],
  ],
]);

const mockIssues: Map<string, TrackerIssue[]> = new Map([
  [
    '87bcbd9f-205c-4e4c-990d-492509c8fe9f',
    [
      // Phase I — Foundation (done)
      {
        id: 'niu-182',
        identifier: 'NIU-182',
        title: 'Domain model: Saga, Phase, Raid entities and state machine',
        description: 'Define the core domain entities and state machine.',
        status: 'Done',
        assignee: 'Jozef Van Eenbergen',
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-182',
        milestone_id: 'dc726480-8062-4933-8b97-a57f2d442e54',
      },
      {
        id: 'niu-183',
        identifier: 'NIU-183',
        title: 'Port interfaces: TrackerPort, VölundrPort, LLMPort, GitPort, ConfidencePort',
        description: 'Define all port interfaces as abstract base classes.',
        status: 'Done',
        assignee: 'Jozef Van Eenbergen',
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-183',
        milestone_id: 'dc726480-8062-4933-8b97-a57f2d442e54',
      },
      {
        id: 'niu-184',
        identifier: 'NIU-184',
        title: 'FastAPI skeleton: hexagonal layout, asyncpg pool, dependency injection',
        description: 'Scaffold the FastAPI application with hexagonal layout.',
        status: 'Done',
        assignee: 'Jozef Van Eenbergen',
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-184',
        milestone_id: 'dc726480-8062-4933-8b97-a57f2d442e54',
      },
      {
        id: 'niu-185',
        identifier: 'NIU-185',
        title: 'PostgreSQL schema: sagas, phases, raids, confidence_events, dispatcher_state',
        description: 'PostgreSQL schema for Tyr-local state.',
        status: 'Done',
        assignee: 'Jozef Van Eenbergen',
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-185',
        milestone_id: 'dc726480-8062-4933-8b97-a57f2d442e54',
      },
      {
        id: 'niu-216',
        identifier: 'NIU-216',
        title: 'Tyr migrations: create migrations/tyr/ with initial schema',
        description: 'Create Tyr migration directory with initial schema.',
        status: 'Done',
        assignee: 'Jozef Van Eenbergen',
        labels: ['Feature'],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-216',
        milestone_id: 'dc726480-8062-4933-8b97-a57f2d442e54',
      },

      // Phase II — Tracker Adapters (in progress)
      {
        id: 'niu-186',
        identifier: 'NIU-186',
        title: 'TrackerPort interface: finalize CRUD contract',
        description: 'Define TrackerPort as the abstraction boundary between Tyr and any tracker.',
        status: 'Done',
        assignee: 'Jozef Van Eenbergen',
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-186',
        milestone_id: 'f1430cc0-c5d1-4051-9051-e80b5239d8b9',
      },
      {
        id: 'niu-187',
        identifier: 'NIU-187',
        title: 'LinearAdapter: Project=Saga, Milestone=Phase, Issue=Raid',
        description: 'Implement LinearAdapter(TrackerPort) — the primary tracker backend.',
        status: 'Done',
        assignee: 'Jozef Van Eenbergen',
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-187',
        milestone_id: 'f1430cc0-c5d1-4051-9051-e80b5239d8b9',
      },
      {
        id: 'niu-188',
        identifier: 'NIU-188',
        title: 'NativeAdapter: full TrackerPort implementation in PostgreSQL',
        description: 'Pure PostgreSQL fallback for local dev and air-gapped environments.',
        status: 'Backlog',
        assignee: null,
        labels: [],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-188',
        milestone_id: 'f1430cc0-c5d1-4051-9051-e80b5239d8b9',
      },

      // Phase III — LLM Decomposition
      {
        id: 'niu-189',
        identifier: 'NIU-189',
        title: 'LLMPort + BifröstAdapter: spec decomposition with confidence self-scoring',
        description: 'Implement LLMPort and BifröstAdapter for spec decomposition.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-189',
        milestone_id: '7c763a2f-27dc-4d7b-a0bc-e0cfc4ade2cc',
      },

      // Phase IV — Git Model
      {
        id: 'niu-191',
        identifier: 'NIU-191',
        title: 'GitPort interface: branch and merge contract',
        description: 'Define GitPort as the abstraction over all git operations.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-191',
        milestone_id: '32264d9f-b532-4cc8-8864-25a6458f6cfc',
      },
      {
        id: 'niu-192',
        identifier: 'NIU-192',
        title: 'GitHubAdapter: implement GitPort against GitHub REST API',
        description: 'Implement GitHubAdapter(GitPort) using the GitHub REST API.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-192',
        milestone_id: '32264d9f-b532-4cc8-8864-25a6458f6cfc',
      },
      {
        id: 'niu-193',
        identifier: 'NIU-193',
        title:
          'POST /sagas/commit: persist decomposition, create tracker entities, create feature branch',
        description:
          'Takes a previewed SagaStructure, persists it, creates tracker entities and branch.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-193',
        milestone_id: '32264d9f-b532-4cc8-8864-25a6458f6cfc',
      },

      // Phase V — Dispatcher
      {
        id: 'niu-194',
        identifier: 'NIU-194',
        title: 'VölundrPort interface: session spawn, poll, chronicle, PR status',
        description: 'Define VölundrPort — the abstraction over all Völundr session operations.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-194',
        milestone_id: 'a5354979-1eac-4dc1-9b69-309790b1c876',
      },
      {
        id: 'niu-195',
        identifier: 'NIU-195',
        title: 'VölundrHTTPAdapter + SSE subscription manager',
        description: 'Implement VölundrHTTPAdapter(VölundrPort) and SSE subscription manager.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-195',
        milestone_id: 'a5354979-1eac-4dc1-9b69-309790b1c876',
      },
      {
        id: 'niu-196',
        identifier: 'NIU-196',
        title:
          'Dispatcher loop: poll PENDING raids, file scope validation, spawn sessions, phase gate',
        description: 'Background asyncio loop that owns the full raid lifecycle.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-196',
        milestone_id: 'a5354979-1eac-4dc1-9b69-309790b1c876',
      },
      {
        id: 'niu-203',
        identifier: 'NIU-203',
        title: 'Raid completion detection: sentinel + git + CI layered model',
        description: 'Defines how Tyr accurately determines whether a raid is complete.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-203',
        milestone_id: 'a5354979-1eac-4dc1-9b69-309790b1c876',
      },

      // Phase VI — Confidence Engine
      {
        id: 'niu-197',
        identifier: 'NIU-197',
        title: 'ConfidencePort interface: event-driven scoring contract',
        description: 'Define ConfidencePort as the scoring abstraction.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-197',
        milestone_id: '64838d14-abeb-4bed-b269-b289d2d027bb',
      },
      {
        id: 'niu-198',
        identifier: 'NIU-198',
        title:
          'DefaultConfidenceAdapter: scoring rules, auto-merge gate, file scope breach detection',
        description: 'Concrete scoring engine backed by PostgreSQL.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-198',
        milestone_id: '64838d14-abeb-4bed-b269-b289d2d027bb',
      },

      // Phase VII — Review Flow
      {
        id: 'niu-199',
        identifier: 'NIU-199',
        title: 'Review endpoints: GET review state, POST approve / reject / retry',
        description: 'Human review endpoints — gate between session completing and branch merging.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-199',
        milestone_id: 'bf658113-e320-4ffa-84af-2bb3e49e6177',
      },
      {
        id: 'niu-200',
        identifier: 'NIU-200',
        title: 'Final MR creation: feature branch → main on saga completion',
        description: 'Automatically create the final MR from feature branch to main.',
        status: 'Backlog',
        assignee: null,
        labels: [],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-200',
        milestone_id: 'bf658113-e320-4ffa-84af-2bb3e49e6177',
      },

      // Phase VIII — UI & Integration
      {
        id: 'niu-190',
        identifier: 'NIU-190',
        title: 'Wire Tyr React UI to live API and SSE stream',
        description: 'Replace mock data with real API calls and hook up live state.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-190',
        milestone_id: 'c883f25e-2932-43d4-92b8-327b5e55f000',
      },
      {
        id: 'niu-201',
        identifier: 'NIU-201',
        title: 'Tyr SSE stream: GET /tyr/events with full event catalogue',
        description: 'Outbound SSE stream for real-time UI updates.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-201',
        milestone_id: 'c883f25e-2932-43d4-92b8-327b5e55f000',
      },
      {
        id: 'niu-202',
        identifier: 'NIU-202',
        title: 'REST API: complete read surface for sagas, phases, raids, sessions, dispatcher',
        description: 'Complete REST API surface — all read endpoints the UI needs.',
        status: 'Todo',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/niuu/issue/NIU-202',
        milestone_id: 'c883f25e-2932-43d4-92b8-327b5e55f000',
      },

      // Scaffold (done, no milestone)
      {
        id: 'niu-213',
        identifier: 'NIU-213',
        title: 'Web: scaffold Tyr UI module in modules/tyr/',
        description: 'Create the Tyr UI module scaffold.',
        status: 'Done',
        assignee: 'Jozef Van Eenbergen',
        labels: ['Feature'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-213',
        milestone_id: null,
      },
      {
        id: 'niu-214',
        identifier: 'NIU-214',
        title: 'Helm: create tyr subchart',
        description: 'Tyr Helm subchart at charts/tyr/.',
        status: 'Done',
        assignee: 'Jozef Van Eenbergen',
        labels: ['Feature'],
        priority: 2,
        url: 'https://linear.app/niuu/issue/NIU-214',
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

  async listRepos(): Promise<RepoInfo[]> {
    await delay();
    return [...mockRepos];
  }

  async importProject(projectId: string, repos: string[]): Promise<Saga> {
    await delay(500);
    const project = mockProjects.find(p => p.id === projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const slug = project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);
    return {
      id: crypto.randomUUID(),
      tracker_id: project.id,
      tracker_type: 'linear',
      slug,
      name: project.name,
      repos,
      feature_branch: `feat/${slug}`,
      status: 'active',
      confidence: 0.0,
      created_at: new Date().toISOString(),
      phase_summary: { total: 8, completed: 1 },
    };
  }
}
