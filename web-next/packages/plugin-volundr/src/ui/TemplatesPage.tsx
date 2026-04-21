import { useState } from 'react';
import { Chip, LoadingState, ErrorState, Meter } from '@niuulabs/ui';
import type { Template } from '../domain/template';
import type { Mount, McpServer } from '../domain/pod';
import { useTemplates } from './useTemplates';
import { CliBadge } from './atoms';

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

const TABS = ['overview', 'workspace', 'runtime', 'mcp', 'skills', 'rules'] as const;
type TabId = (typeof TABS)[number];

// ---------------------------------------------------------------------------
// Helper: key-value row
// ---------------------------------------------------------------------------

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="niuu-flex niuu-items-baseline niuu-gap-3 niuu-py-1">
      <span className="niuu-w-24 niuu-shrink-0 niuu-font-mono niuu-text-xs niuu-text-text-muted">
        {label}
      </span>
      <span className="niuu-text-sm niuu-text-text-primary">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: detail card
// ---------------------------------------------------------------------------

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
      data-testid="detail-card"
    >
      <h4 className="niuu-text-xs niuu-font-semibold niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
        {title}
      </h4>
      <div className="niuu-flex niuu-flex-col">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Template list card (left side / grid)
// ---------------------------------------------------------------------------

function TemplateListCard({
  template,
  isSelected,
  onSelect,
}: {
  template: Template;
  isSelected: boolean;
  onSelect: (t: Template) => void;
}) {
  const { spec } = template;
  return (
    <button
      type="button"
      className={`niuu-flex niuu-w-full niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-p-4 niuu-text-left niuu-transition-colors ${
        isSelected
          ? 'niuu-border-brand niuu-bg-bg-secondary'
          : 'niuu-border-border-subtle niuu-bg-bg-secondary hover:niuu-border-border'
      }`}
      onClick={() => onSelect(template)}
      data-testid="template-card"
      aria-pressed={isSelected}
    >
      <div className="niuu-flex niuu-items-center niuu-gap-2">
        <span className="niuu-font-mono niuu-text-sm niuu-font-medium niuu-text-text-primary">
          {template.name}
        </span>
        {template.name === 'default' && (
          <span className="niuu-rounded niuu-bg-brand niuu-px-1.5 niuu-py-0.5 niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-text-bg-primary">
            default
          </span>
        )}
        <span className="niuu-ml-auto niuu-font-mono niuu-text-xs niuu-text-text-faint">
          v{template.version}
        </span>
      </div>
      <div className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
        {spec.image}:{spec.tag}
      </div>
      {template.description && (
        <p className="niuu-line-clamp-2 niuu-text-xs niuu-text-text-secondary">
          {template.description}
        </p>
      )}
      <div className="niuu-flex niuu-flex-wrap niuu-items-center niuu-gap-1.5">
        <Chip tone="default">
          {spec.resources.cpuRequest}c &middot; {spec.resources.memRequestMi}Mi
        </Chip>
        {spec.resources.gpuCount > 0 && (
          <Chip tone="brand">GPU &times;{spec.resources.gpuCount}</Chip>
        )}
        {template.usageCount !== undefined && (
          <span className="niuu-ml-auto niuu-font-mono niuu-text-xs niuu-text-text-faint">
            {template.usageCount} uses
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tab: Overview
// ---------------------------------------------------------------------------

function TplOverview({ template }: { template: Template }) {
  const { spec } = template;
  return (
    <div
      className="niuu-grid niuu-grid-cols-1 niuu-gap-4 sm:niuu-grid-cols-2"
      data-testid="tab-overview"
    >
      <DetailCard title="Identity">
        <KV label="name">
          <span className="niuu-font-mono">{template.name}</span>
        </KV>
        <KV label="version">
          <span className="niuu-font-mono">v{template.version}</span>
        </KV>
        <KV label="image">
          <span className="niuu-font-mono">
            {spec.image}:{spec.tag}
          </span>
        </KV>
      </DetailCard>

      <DetailCard title="Resources">
        <KV label="cpu">
          <span className="niuu-font-mono">
            {spec.resources.cpuRequest}&ndash;{spec.resources.cpuLimit} cores
          </span>
        </KV>
        <KV label="mem">
          <span className="niuu-font-mono">
            {spec.resources.memRequestMi}&ndash;{spec.resources.memLimitMi} Mi
          </span>
        </KV>
        <KV label="gpu">
          <span className="niuu-font-mono">
            {spec.resources.gpuCount > 0 ? `${spec.resources.gpuCount} gpu` : '\u2014'}
          </span>
        </KV>
      </DetailCard>

      <DetailCard title="Workspace">
        {spec.mounts.length === 0 ? (
          <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
            blank &middot; no sources
          </span>
        ) : (
          spec.mounts.map((m) => (
            <div key={m.name} className="niuu-flex niuu-items-center niuu-gap-1.5 niuu-py-0.5">
              <span className="niuu-text-text-muted" aria-hidden>
                {m.source.kind === 'git' ? '\u276F' : '\u2302'}
              </span>
              <span className="niuu-font-mono niuu-text-xs niuu-text-text-secondary">{m.name}</span>
            </div>
          ))
        )}
      </DetailCard>

      <DetailCard title="Extensions">
        <KV label="tools">
          <span className="niuu-font-mono">
            {spec.tools.length > 0 ? spec.tools.join(' \u00b7 ') : '\u2014'}
          </span>
        </KV>
        <KV label="env vars">
          <span className="niuu-font-mono">{Object.keys(spec.env).length}</span>
        </KV>
        <KV label="secrets">
          <span className="niuu-font-mono">{spec.envSecretRefs.length}</span>
        </KV>
      </DetailCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Workspace
// ---------------------------------------------------------------------------

function mountDescription(m: Mount): string {
  switch (m.source.kind) {
    case 'git':
      return `@${m.source.branch} \u00b7 shallow clone`;
    case 'pvc':
      return `pvc:${m.source.name} \u00b7 persistent`;
    case 'secret':
      return `secret:${m.source.name}`;
    case 'configmap':
      return `configmap:${m.source.name}`;
  }
}

function TplWorkspace({ template }: { template: Template }) {
  const { spec } = template;
  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-4" data-testid="tab-workspace">
      <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">Workspace sources</h3>
      <div className="niuu-flex niuu-flex-col niuu-gap-2">
        {spec.mounts.length === 0 ? (
          <p className="niuu-font-mono niuu-text-sm niuu-text-text-faint">
            no workspace sources &mdash; pod boots with empty /workspace
          </p>
        ) : (
          spec.mounts.map((m) => (
            <div
              key={m.name}
              className="niuu-flex niuu-items-center niuu-gap-3 niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-3"
            >
              <span className="niuu-text-text-muted" aria-hidden>
                {m.source.kind === 'git' ? '\u276F' : '\u2302'}
              </span>
              <span className="niuu-font-mono niuu-text-sm niuu-text-text-primary">{m.name}</span>
              <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
                {mountDescription(m)}
              </span>
              <span className="niuu-ml-auto niuu-font-mono niuu-text-xs niuu-text-text-faint">
                {m.readOnly ? 'read-only' : 'read-write'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Runtime
// ---------------------------------------------------------------------------

function TplRuntime({ template }: { template: Template }) {
  const { spec } = template;
  return (
    <div
      className="niuu-grid niuu-grid-cols-1 niuu-gap-4 sm:niuu-grid-cols-2"
      data-testid="tab-runtime"
    >
      <DetailCard title="Container image">
        <KV label="image">
          <span className="niuu-font-mono">{spec.image}</span>
        </KV>
        <KV label="tag">
          <span className="niuu-font-mono">{spec.tag}</span>
        </KV>
      </DetailCard>

      <DetailCard title="Lifecycle">
        <KV label="TTL">
          <span className="niuu-font-mono">{Math.round(spec.ttlSec / 60)}m</span>
        </KV>
        <KV label="idle timeout">
          <span className="niuu-font-mono">{Math.round(spec.idleTimeoutSec / 60)}m</span>
        </KV>
      </DetailCard>

      <DetailCard title="Resource limits">
        <Meter
          used={Number(spec.resources.cpuRequest)}
          limit={Number(spec.resources.cpuLimit)}
          label="CPU"
          unit="c"
        />
        <Meter
          used={spec.resources.memRequestMi}
          limit={spec.resources.memLimitMi}
          label="Mem"
          unit="Mi"
        />
        {spec.resources.gpuCount > 0 && (
          <KV label="gpu">
            <span className="niuu-font-mono">{spec.resources.gpuCount}</span>
          </KV>
        )}
      </DetailCard>

      <DetailCard title="Environment">
        {Object.keys(spec.env).length === 0 && spec.envSecretRefs.length === 0 ? (
          <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
            no env vars configured
          </span>
        ) : (
          <>
            {Object.entries(spec.env).map(([k, v]) => (
              <KV key={k} label={k}>
                <span className="niuu-font-mono">{v}</span>
              </KV>
            ))}
            {spec.envSecretRefs.map((ref) => (
              <KV key={ref} label={ref}>
                <span className="niuu-font-mono niuu-text-text-faint">***</span>
              </KV>
            ))}
          </>
        )}
      </DetailCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: MCP
// ---------------------------------------------------------------------------

function McpServerCard({ server }: { server: McpServer }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="niuu-overflow-hidden niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary"
      data-testid="mcp-server-card"
    >
      <button
        type="button"
        className="niuu-flex niuu-w-full niuu-items-center niuu-gap-3 niuu-px-4 niuu-py-3 niuu-text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={server.name}
      >
        <span className="niuu-h-2 niuu-w-2 niuu-shrink-0 niuu-rounded-full niuu-bg-brand" aria-hidden />
        <span className="niuu-font-mono niuu-text-sm niuu-font-medium niuu-text-text-primary">
          {server.name}
        </span>
        <span className="niuu-truncate niuu-font-mono niuu-text-xs niuu-text-text-muted">
          {server.connectionString}
        </span>
        <span className="niuu-ml-auto niuu-shrink-0 niuu-font-mono niuu-text-xs niuu-text-text-faint">
          {server.transport}
        </span>
        <span className="niuu-shrink-0 niuu-text-xs niuu-text-text-faint" aria-hidden>
          {expanded ? '▴' : '▾'}
        </span>
      </button>
      {expanded && (
        <div className="niuu-flex niuu-flex-wrap niuu-gap-1.5 niuu-border-t niuu-border-border-subtle niuu-bg-bg-primary niuu-px-4 niuu-py-3">
          {server.tools.length === 0 ? (
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">no tools listed</span>
          ) : (
            server.tools.map((tool) => (
              <span
                key={tool}
                className="niuu-rounded niuu-bg-bg-secondary niuu-px-2 niuu-py-0.5 niuu-font-mono niuu-text-xs niuu-text-text-secondary"
                data-testid="mcp-tool-chip"
              >
                {tool}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TplMcp({ template }: { template: Template }) {
  const servers = template.spec.mcpServers ?? [];
  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-4" data-testid="tab-mcp">
      <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">MCP servers</h3>
      {servers.length === 0 ? (
        <p className="niuu-font-mono niuu-text-sm niuu-text-text-faint">no MCP servers enabled</p>
      ) : (
        <div className="niuu-flex niuu-flex-col niuu-gap-2">
          {servers.map((server) => (
            <McpServerCard key={server.name} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Skills
// ---------------------------------------------------------------------------

function TplSkills({ template }: { template: Template }) {
  const { spec } = template;
  const count = spec.tools.length;
  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-4" data-testid="tab-skills">
      <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">Skills ({count})</h3>
      {count === 0 ? (
        <p className="niuu-font-mono niuu-text-sm niuu-text-text-faint">no skills defined</p>
      ) : (
        <div className="niuu-flex niuu-flex-wrap niuu-gap-2">
          {spec.tools.map((tool) => (
            <Chip key={tool} tone="muted">
              {tool}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Rules
// ---------------------------------------------------------------------------

function TplRules({ template }: { template: Template }) {
  const hasAffinity = (template.spec.clusterAffinity ?? []).length > 0;
  const hasTolerations = (template.spec.tolerations ?? []).length > 0;
  const hasRules = hasAffinity || hasTolerations;
  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-4" data-testid="tab-rules">
      <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">
        Rules & constraints
      </h3>
      {!hasRules ? (
        <p className="niuu-font-mono niuu-text-sm niuu-text-text-faint">
          no rules or constraints defined
        </p>
      ) : (
        <div className="niuu-grid niuu-grid-cols-1 niuu-gap-4 sm:niuu-grid-cols-2">
          {hasAffinity && (
            <DetailCard title="Cluster affinity">
              {template.spec.clusterAffinity!.map((c) => (
                <div key={c} className="niuu-flex niuu-items-center niuu-gap-2 niuu-py-0.5">
                  <Chip tone="muted">{c}</Chip>
                </div>
              ))}
            </DetailCard>
          )}
          {hasTolerations && (
            <DetailCard title="Tolerations">
              {template.spec.tolerations!.map((t) => (
                <div key={t} className="niuu-flex niuu-items-center niuu-gap-2 niuu-py-0.5">
                  <Chip tone="muted">{t}</Chip>
                </div>
              ))}
            </DetailCard>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TemplatesPage
// ---------------------------------------------------------------------------

export function TemplatesPage() {
  const templates = useTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');

  const selectedTemplate =
    templates.data?.find((t) => t.id === selectedId) ?? templates.data?.[0] ?? null;

  function handleSelect(t: Template) {
    setSelectedId(t.id);
    setTab('overview');
  }

  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-6 niuu-p-6" data-testid="templates-page">
      {/* Header */}
      <div>
        <h2 className="niuu-text-lg niuu-font-semibold niuu-text-text-primary">Templates</h2>
        <p className="niuu-text-sm niuu-text-text-muted">
          Reusable pod templates &mdash; define image, resources, env, and tool allowlists once;
          start sessions from a template.
        </p>
      </div>

      {/* Loading */}
      {templates.isLoading && <LoadingState label="loading templates\u2026" />}

      {/* Error */}
      {templates.isError && (
        <ErrorState
          title="Failed to load templates"
          message={
            templates.error instanceof Error ? templates.error.message : 'failed to load templates'
          }
        />
      )}

      {/* Empty */}
      {templates.data && templates.data.length === 0 && (
        <p className="niuu-text-sm niuu-text-text-muted" data-testid="empty-state">
          No templates yet &mdash; create one to get started.
        </p>
      )}

      {/* Template list + detail */}
      {templates.data && templates.data.length > 0 && (
        <div className="niuu-flex niuu-flex-col niuu-gap-6 lg:niuu-flex-row">
          {/* Sidebar: template list */}
          <div
            className="niuu-flex niuu-shrink-0 niuu-flex-col niuu-gap-2 lg:niuu-w-64"
            role="list"
            aria-label="Pod templates"
          >
            {templates.data.map((t) => (
              <div key={t.id} role="listitem">
                <TemplateListCard
                  template={t}
                  isSelected={selectedTemplate?.id === t.id}
                  onSelect={handleSelect}
                />
              </div>
            ))}
          </div>

          {/* Detail panel */}
          {selectedTemplate && (
            <div className="niuu-flex niuu-min-w-0 niuu-flex-1 niuu-flex-col niuu-gap-4">
              {/* Template header */}
              <header className="niuu-flex niuu-flex-col niuu-gap-2">
                <div className="niuu-flex niuu-items-center niuu-gap-2">
                  <CliBadge cli="claude" />
                  <h3 className="niuu-font-mono niuu-text-base niuu-font-medium niuu-text-text-primary">
                    {selectedTemplate.name}
                  </h3>
                  {selectedTemplate.name === 'default' && (
                    <span className="niuu-rounded niuu-bg-brand niuu-px-1.5 niuu-py-0.5 niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-text-bg-primary">
                      default
                    </span>
                  )}
                  <div className="niuu-ml-auto niuu-flex niuu-gap-2">
                    <button
                      type="button"
                      className="niuu-rounded niuu-border niuu-border-border niuu-bg-transparent niuu-px-3 niuu-py-1 niuu-text-sm niuu-text-text-secondary niuu-transition-colors hover:niuu-bg-bg-tertiary"
                      aria-label={`Clone template ${selectedTemplate.name}`}
                    >
                      clone
                    </button>
                    <button
                      type="button"
                      className="niuu-rounded niuu-bg-brand niuu-px-3 niuu-py-1 niuu-text-sm niuu-font-medium niuu-text-bg-primary niuu-transition-colors hover:niuu-opacity-90"
                      aria-label={`Edit template ${selectedTemplate.name}`}
                    >
                      edit
                    </button>
                  </div>
                </div>
                <p className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
                  {selectedTemplate.spec.image}:{selectedTemplate.spec.tag}
                </p>
              </header>

              {/* Tabs */}
              <nav
                className="niuu-flex niuu-gap-1 niuu-border-b niuu-border-border-subtle"
                aria-label="Template detail tabs"
              >
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    className={`niuu-px-3 niuu-py-2 niuu-text-sm niuu-font-medium niuu-transition-colors ${
                      tab === t
                        ? 'niuu-border-b-2 niuu-border-brand niuu-text-text-primary'
                        : 'niuu-text-text-muted hover:niuu-text-text-secondary'
                    }`}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </nav>

              {/* Tab content */}
              <div>
                {tab === 'overview' && <TplOverview template={selectedTemplate} />}
                {tab === 'workspace' && <TplWorkspace template={selectedTemplate} />}
                {tab === 'runtime' && <TplRuntime template={selectedTemplate} />}
                {tab === 'mcp' && <TplMcp template={selectedTemplate} />}
                {tab === 'skills' && <TplSkills template={selectedTemplate} />}
                {tab === 'rules' && <TplRules template={selectedTemplate} />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
