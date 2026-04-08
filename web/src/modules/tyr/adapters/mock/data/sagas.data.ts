import type { Saga, Phase, DispatcherState, SessionInfo } from '../../../models';

// ── Saga 1: Storage Health Observer ────────────────────────────────────

const saga1Id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const saga1Phase1Id = 'p1a1b2c3-d4e5-6789-0abc-def123456789';
const saga1Phase2Id = 'p2a1b2c3-d4e5-6789-0abc-def123456789';

const saga1Phase1Raids = [
  {
    id: 'r1a1b2c3-0001-6789-0abc-def123456789',
    phase_id: saga1Phase1Id,
    tracker_id: 'NIU-101',
    name: 'Add ZFS pool health check port',
    description:
      'Define a health check port for querying ZFS pool status and expose it via the adapter layer.',
    acceptance_criteria: [
      'IStorageHealthPort interface defined with getPoolStatus()',
      'ZfsHealthAdapter implements the port using zpool status parsing',
      'Unit tests cover healthy, degraded, and faulted pool states',
    ],
    declared_files: [
      'src/buri/ports/storage_health.py',
      'src/buri/adapters/zfs_health.py',
      'tests/test_adapters/test_zfs_health.py',
    ],
    estimate_hours: 3,
    status: 'merged' as const,
    confidence: 0.95,
    session_id: 'sess-1001',
    reviewer_session_id: null,
    review_round: 0,
    branch: 'feat/storage-health/zfs-port',
    chronicle_summary: 'Implemented ZFS health port and adapter with full test coverage.',
    retry_count: 0,
    created_at: '2026-03-18T09:00:00Z',
    updated_at: '2026-03-18T14:22:00Z',
  },
  {
    id: 'r1a1b2c3-0002-6789-0abc-def123456789',
    phase_id: saga1Phase1Id,
    tracker_id: 'NIU-102',
    name: 'Integrate health check into Skoll perception loop',
    description:
      'Wire the storage health port into the Skoll rapid-perception cycle so degraded pools trigger interrupts.',
    acceptance_criteria: [
      'Skoll checks storage health every cycle',
      'Degraded pool triggers Priority.HIGH interrupt signal',
      'Faulted pool triggers Priority.CRITICAL interrupt signal',
    ],
    declared_files: [
      'src/buri/regions/skoll/perception.py',
      'tests/test_regions/test_skoll_storage.py',
    ],
    estimate_hours: 2,
    status: 'running' as const,
    confidence: 0.72,
    session_id: 'sess-1002',
    reviewer_session_id: null,
    review_round: 0,
    branch: 'feat/storage-health/skoll-integration',
    chronicle_summary: null,
    retry_count: 0,
    created_at: '2026-03-18T14:30:00Z',
    updated_at: '2026-03-19T10:15:00Z',
  },
];

const saga1Phase2Raids = [
  {
    id: 'r1a1b2c3-0003-6789-0abc-def123456789',
    phase_id: saga1Phase2Id,
    tracker_id: 'NIU-103',
    name: 'Add Prometheus metrics for pool health',
    description:
      'Expose storage health metrics via the existing Prometheus endpoint so Grafana dashboards can visualize pool status.',
    acceptance_criteria: [
      'buri_storage_pool_status gauge metric exposed',
      'buri_storage_pool_errors_total counter metric exposed',
      'Grafana dashboard JSON updated with storage panel',
    ],
    declared_files: [
      'src/buri/adapters/metrics.py',
      'dashboards/storage-health.json',
      'tests/test_adapters/test_metrics_storage.py',
    ],
    estimate_hours: 2,
    status: 'pending' as const,
    confidence: 0.6,
    session_id: null,
    reviewer_session_id: null,
    review_round: 0,
    branch: null,
    chronicle_summary: null,
    retry_count: 0,
    created_at: '2026-03-19T08:00:00Z',
    updated_at: '2026-03-19T08:00:00Z',
  },
  {
    id: 'r1a1b2c3-0004-6789-0abc-def123456789',
    phase_id: saga1Phase2Id,
    tracker_id: 'NIU-104',
    name: 'Recovery runbook for degraded pools',
    description:
      'Create an automated recovery runbook that Odin can execute when a pool enters degraded state.',
    acceptance_criteria: [
      'Runbook YAML created in runbooks/storage-recovery.yaml',
      'Odin decision handler recognizes storage degradation signals',
      'Integration test validates end-to-end signal to recovery flow',
    ],
    declared_files: [
      'runbooks/storage-recovery.yaml',
      'src/buri/regions/modi/decisions/storage.py',
      'tests/test_integration/test_storage_recovery.py',
    ],
    estimate_hours: 4,
    status: 'review' as const,
    confidence: 0.55,
    session_id: 'sess-1004',
    reviewer_session_id: null,
    review_round: 0,
    branch: 'feat/storage-health/recovery-runbook',
    chronicle_summary:
      'Runbook and decision handler implemented. Awaiting human review of recovery logic.',
    retry_count: 1,
    created_at: '2026-03-19T10:00:00Z',
    updated_at: '2026-03-20T16:45:00Z',
  },
  {
    id: 'r1a1b2c3-0005-6789-0abc-def123456789',
    phase_id: saga1Phase2Id,
    tracker_id: 'NIU-105',
    name: 'E2E test for storage health pipeline',
    description:
      'End-to-end test that simulates pool degradation and validates the full signal chain from Skoll to Odin recovery.',
    acceptance_criteria: [
      'E2E test simulates degraded pool via mock adapter',
      'Validates interrupt signal reaches Odin within 5s',
      'Validates recovery runbook is triggered',
    ],
    declared_files: ['tests/test_e2e/test_storage_pipeline.py'],
    estimate_hours: 3,
    status: 'failed' as const,
    confidence: 0.4,
    session_id: 'sess-1005',
    reviewer_session_id: null,
    review_round: 0,
    branch: 'feat/storage-health/e2e-test',
    chronicle_summary:
      'CI failed: nng synapse timeout in e2e harness. Needs retry with increased timeout config.',
    retry_count: 2,
    created_at: '2026-03-20T09:00:00Z',
    updated_at: '2026-03-21T08:30:00Z',
  },
];

// ── Saga 2: Auth Middleware Rewrite ────────────────────────────────────

const saga2Id = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const saga2Phase1Id = 'p1b2c3d4-e5f6-7890-1bcd-ef1234567890';

const saga2Phase1Raids = [
  {
    id: 'r2b2c3d4-0001-7890-1bcd-ef1234567890',
    phase_id: saga2Phase1Id,
    tracker_id: 'NIU-111',
    name: 'Extract OIDC token validation into identity adapter',
    description:
      'Refactor the auth middleware to use the identity adapter pattern, removing direct Keycloak coupling.',
    acceptance_criteria: [
      'IIdentityPort interface with validate_token() and get_claims()',
      'OidcIdentityAdapter implements the port using generic OIDC discovery',
      'Existing Keycloak tests pass with the new adapter',
    ],
    declared_files: [
      'src/buri/ports/identity.py',
      'src/buri/adapters/oidc_identity.py',
      'tests/test_adapters/test_oidc_identity.py',
    ],
    estimate_hours: 5,
    status: 'running' as const,
    confidence: 0.68,
    session_id: 'sess-2001',
    reviewer_session_id: null,
    review_round: 0,
    branch: 'feat/auth-rewrite/identity-adapter',
    chronicle_summary: null,
    retry_count: 0,
    created_at: '2026-03-19T11:00:00Z',
    updated_at: '2026-03-21T09:00:00Z',
  },
  {
    id: 'r2b2c3d4-0002-7890-1bcd-ef1234567890',
    phase_id: saga2Phase1Id,
    tracker_id: 'NIU-112',
    name: 'Update Envoy ext_authz filter config',
    description:
      'Update the Envoy configuration to use the new identity adapter endpoint instead of the legacy Keycloak-specific path.',
    acceptance_criteria: [
      'Envoy ext_authz points to /auth/validate',
      'Helm chart values updated for new auth endpoint',
      'Integration test validates token flow through Envoy',
    ],
    declared_files: [
      'charts/volundr/templates/envoy-config.yaml',
      'charts/volundr/values.yaml',
      'tests/test_integration/test_envoy_auth.py',
    ],
    estimate_hours: 2,
    status: 'queued' as const,
    confidence: 0.5,
    session_id: null,
    reviewer_session_id: null,
    review_round: 0,
    branch: null,
    chronicle_summary: null,
    retry_count: 0,
    created_at: '2026-03-20T08:00:00Z',
    updated_at: '2026-03-20T08:00:00Z',
  },
];

// ── Exports ───────────────────────────────────────────────────────────

export const mockSagas: Saga[] = [
  {
    id: saga1Id,
    tracker_id: 'NIU-100',
    tracker_type: 'linear',
    slug: 'storage-health-observer',
    name: 'Storage Health Observer',
    repos: ['niuulabs/volundr'],
    feature_branch: 'feat/storage-health',
    status: 'active',
    confidence: 0.72,
    created_at: '2026-03-18T08:30:00Z',
    phase_summary: { total: 2, completed: 1 },
  },
  {
    id: saga2Id,
    tracker_id: 'NIU-110',
    tracker_type: 'linear',
    slug: 'auth-middleware-rewrite',
    name: 'Auth Middleware Rewrite',
    repos: ['niuulabs/volundr'],
    feature_branch: 'feat/auth-rewrite',
    status: 'active',
    confidence: 0.59,
    created_at: '2026-03-19T10:00:00Z',
    phase_summary: { total: 1, completed: 0 },
  },
];

export const mockPhases = new Map<string, Phase[]>([
  [
    saga1Id,
    [
      {
        id: saga1Phase1Id,
        saga_id: saga1Id,
        tracker_id: 'NIU-100',
        number: 1,
        name: 'Core Health Check Infrastructure',
        status: 'active',
        confidence: 0.84,
        raids: saga1Phase1Raids,
      },
      {
        id: saga1Phase2Id,
        saga_id: saga1Id,
        tracker_id: 'NIU-100',
        number: 2,
        name: 'Observability & Recovery',
        status: 'gated',
        confidence: 0.52,
        raids: saga1Phase2Raids,
      },
    ],
  ],
  [
    saga2Id,
    [
      {
        id: saga2Phase1Id,
        saga_id: saga2Id,
        tracker_id: 'NIU-110',
        number: 1,
        name: 'Identity Adapter Extraction',
        status: 'active',
        confidence: 0.59,
        raids: saga2Phase1Raids,
      },
    ],
  ],
]);

export const mockDispatcherState: DispatcherState = {
  id: 'dispatcher-001',
  running: true,
  threshold: 0.6,
  max_concurrent_raids: 3,
  updated_at: '2026-03-21T08:00:00Z',
};

export const mockSessions: SessionInfo[] = [
  {
    session_id: 'sess-1002',
    status: 'running',
    chronicle_lines: [
      '[09:15] Started raid NIU-102: Integrate health check into Skoll perception loop',
      '[09:16] Reading src/buri/regions/skoll/perception.py',
      '[09:18] Adding storage health check to perception cycle',
      '[09:22] Running tests... 14/16 passing',
    ],
    branch: 'feat/storage-health/skoll-integration',
    confidence: 0.72,
    raid_name: 'Integrate health check into Skoll perception loop',
    saga_name: 'Storage Health Observer',
  },
  {
    session_id: 'sess-1004',
    status: 'review',
    chronicle_lines: [
      '[14:00] Started raid NIU-104: Recovery runbook for degraded pools',
      '[14:05] Created runbooks/storage-recovery.yaml',
      '[14:12] Implemented Odin decision handler',
      '[14:30] All tests passing. Waiting for human review.',
    ],
    branch: 'feat/storage-health/recovery-runbook',
    confidence: 0.55,
    raid_name: 'Recovery runbook for degraded pools',
    saga_name: 'Storage Health Observer',
  },
  {
    session_id: 'sess-2001',
    status: 'running',
    chronicle_lines: [
      '[11:00] Started raid NIU-111: Extract OIDC token validation',
      '[11:02] Analyzing existing Keycloak middleware',
      '[11:10] Defining IIdentityPort interface',
      '[11:25] Implementing OidcIdentityAdapter',
    ],
    branch: 'feat/auth-rewrite/identity-adapter',
    confidence: 0.68,
    raid_name: 'Extract OIDC token validation into identity adapter',
    saga_name: 'Auth Middleware Rewrite',
  },
];

export const mockDispatcherLog: string[] = [
  '[2026-03-21T08:00:01Z] Dispatcher started (threshold=0.6)',
  '[2026-03-21T08:00:02Z] Scanning pending raids...',
  '[2026-03-21T08:00:02Z] Raid NIU-103 (confidence=0.60) meets threshold, queuing',
  '[2026-03-21T08:00:03Z] Raid NIU-112 (confidence=0.50) below threshold, skipping',
  '[2026-03-21T08:01:00Z] Checking running sessions: 2 active',
  '[2026-03-21T08:01:01Z] Session sess-1002 healthy (NIU-102)',
  '[2026-03-21T08:01:01Z] Session sess-2001 healthy (NIU-111)',
  '[2026-03-21T08:02:00Z] Scanning pending raids...',
  '[2026-03-21T08:02:01Z] No new raids above threshold',
];
