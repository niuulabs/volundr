import { useMemo, useState } from 'react';
import { ShapeSvg, Chip } from '@niuulabs/ui';
import type { Registry, EntityType } from '../domain';
import { isDescendant } from '../domain/containment';
import { useRegistryEditor } from '../application/useRegistryEditor';

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'types' | 'containment' | 'json';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return iso.slice(0, 10);
}

// ── TypePreviewDrawer ─────────────────────────────────────────────────────────

interface TypePreviewDrawerProps {
  type: EntityType;
  onClose: () => void;
}

function TypePreviewDrawer({ type, onClose }: TypePreviewDrawerProps) {
  return (
    <div
      data-testid="type-preview-drawer"
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}
        >
          <ShapeSvg shape={type.shape} color={type.color} size={28} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              marginBottom: 2,
            }}
          >
            {type.category}
          </div>
          <div
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 600,
              letterSpacing: '-0.015em',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {type.label}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-brand)',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {type.rune}
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-text-muted)',
              marginTop: 2,
            }}
          >
            {type.id}
          </div>
        </div>
        <button
          aria-label="Close preview"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            padding: 4,
            lineHeight: 1,
            fontSize: 16,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: 'var(--space-4)', overflowY: 'auto', flex: 1 }}>
        <p
          style={{
            margin: '0 0 var(--space-4)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.5,
          }}
        >
          {type.description}
        </p>

        <div className="section-head" style={{ marginTop: 0 }}>
          Visual
        </div>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr',
            gap: 'var(--space-1) var(--space-3)',
            margin: '0 0 var(--space-4)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <dt style={{ color: 'var(--color-text-muted)' }}>shape</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {type.shape}
          </dd>
          <dt style={{ color: 'var(--color-text-muted)' }}>size</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {type.size}
          </dd>
          <dt style={{ color: 'var(--color-text-muted)' }}>border</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {type.border}
          </dd>
        </dl>

        {type.parentTypes.length > 0 && (
          <>
            <div className="section-head">Lives inside</div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--space-1)',
                marginBottom: 'var(--space-4)',
              }}
            >
              {type.parentTypes.map((id) => (
                <Chip key={id} tone="muted">
                  {id}
                </Chip>
              ))}
            </div>
          </>
        )}

        {type.canContain.length > 0 && (
          <>
            <div className="section-head">Can contain</div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--space-1)',
                marginBottom: 'var(--space-4)',
              }}
            >
              {type.canContain.map((id) => (
                <Chip key={id} tone="muted">
                  {id}
                </Chip>
              ))}
            </div>
          </>
        )}

        {type.fields.length > 0 && (
          <>
            <div className="section-head">Fields</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {type.fields.map((f) => (
                <div
                  key={f.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  <span style={{ color: 'var(--color-text-secondary)' }}>{f.label}</span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {f.type}
                    {f.required && ' *'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── TypesTab ──────────────────────────────────────────────────────────────────

interface TypesTabProps {
  registry: Registry;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function TypesTab({ registry, selectedId, onSelect }: TypesTabProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return registry.types;
    const q = search.toLowerCase();
    return registry.types.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.id.includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [registry.types, search]);

  const byCategory = useMemo(() => {
    const m = new Map<string, EntityType[]>();
    for (const t of filtered) {
      if (!m.has(t.category)) m.set(t.category, []);
      m.get(t.category)!.push(t);
    }
    return m;
  }, [filtered]);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <input
          aria-label="Filter types"
          placeholder="filter types…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            height: 36,
            padding: '0 var(--space-3)',
            background: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-sans)',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {filtered.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          No types match your search.
        </p>
      )}

      {[...byCategory.entries()].map(([cat, types]) => (
        <div key={cat} style={{ marginBottom: 'var(--space-5)' }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-2)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {cat}
            <span
              style={{ fontWeight: 400, color: 'var(--color-text-faint, var(--color-text-muted))' }}
            >
              · {types.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {types.map((t) => (
              <button
                key={t.id}
                data-testid={`type-row-${t.id}`}
                onClick={() => onSelect(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-2) var(--space-3)',
                  background: selectedId === t.id ? 'var(--color-bg-tertiary)' : 'transparent',
                  border:
                    selectedId === t.id ? '1px solid var(--color-border)' : '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  color: 'inherit',
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <ShapeSvg shape={t.shape} color={t.color} size={18} />
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 16,
                    color: 'var(--color-brand)',
                    fontWeight: 700,
                    width: 20,
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  {t.rune}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, display: 'block' }}>{t.label}</span>
                  <span
                    style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 'var(--text-xs)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {t.id}
                  </span>
                </span>
                <span
                  style={{
                    color: 'var(--color-text-muted)',
                    fontSize: 'var(--text-xs)',
                    maxWidth: 180,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {t.description.split('.')[0]}.
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ContainmentTab ────────────────────────────────────────────────────────────

type DropState = 'none' | 'ok' | 'target' | 'invalid';

interface ContainmentTabProps {
  registry: Registry;
  selectedId: string | null;
  onSelect: (id: string) => void;
  tryReparent: (childId: string, newParentId: string) => boolean;
}

function ContainmentTab({ registry, selectedId, onSelect, tryReparent }: ContainmentTabProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(registry.types.map((t) => [t.id, t])), [registry.types]);

  const roots = useMemo(
    () => registry.types.filter((t) => t.parentTypes.length === 0),
    [registry.types],
  );

  // Build reachable set from roots via canContain edges.
  const reachable = useMemo(() => {
    const set = new Set<string>();
    const mark = (t: EntityType | undefined) => {
      if (!t || set.has(t.id)) return;
      set.add(t.id);
      for (const childId of t.canContain) mark(byId.get(childId));
    };
    for (const root of roots) mark(root);
    return set;
  }, [roots, byId]);

  const orphans = useMemo(
    () => registry.types.filter((t) => !reachable.has(t.id) && t.parentTypes.length > 0),
    [registry.types, reachable],
  );

  const getDropState = (targetId: string): DropState => {
    if (!dragId) return 'none';
    const invalid = isDescendant(registry, dragId, targetId) || dragId === targetId;
    if (overId === targetId) return invalid ? 'invalid' : 'target';
    if (!invalid) return 'ok';
    return 'none';
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    try {
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
      }
    } catch {
      // dataTransfer may be unavailable in some contexts (e.g. jsdom)
    }
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    if (!dragId) return;
    const invalid = isDescendant(registry, dragId, targetId) || dragId === targetId;
    try {
      if (e.dataTransfer) e.dataTransfer.dropEffect = invalid ? 'none' : 'move';
    } catch {
      // dataTransfer may be read-only in some contexts
    }
    e.preventDefault();
    setOverId(targetId);
  };

  const handleDragLeave = (e: React.DragEvent, targetId: string) => {
    // Only clear if we're leaving the node itself (not a child element).
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setOverId((prev) => (prev === targetId ? null : prev));
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (dragId) tryReparent(dragId, targetId);
    setDragId(null);
    setOverId(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setOverId(null);
  };

  const renderNode = (t: EntityType, depth = 0): React.ReactNode => {
    const children = t.canContain.map((id) => byId.get(id)).filter(Boolean) as EntityType[];
    const dropState = getDropState(t.id);
    const isDragging = dragId === t.id;

    const nodeStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      padding: '4px 8px',
      borderRadius: 'var(--radius-sm)',
      cursor: isDragging ? 'grabbing' : 'grab',
      opacity: isDragging ? 0.4 : 1,
      marginLeft: depth * 20,
      border: '1px solid transparent',
      background: selectedId === t.id ? 'var(--color-bg-tertiary)' : 'transparent',
      ...(dropState === 'ok' && {
        border: '1px dashed color-mix(in srgb, var(--color-brand) 30%, transparent)',
      }),
      ...(dropState === 'target' && {
        border: '1px solid var(--color-brand)',
        background: 'color-mix(in srgb, var(--color-brand) 20%, transparent)',
      }),
      ...(dropState === 'invalid' && {
        border: '1px solid var(--color-critical, #ef4444)',
        background: 'color-mix(in srgb, var(--color-critical, #ef4444) 15%, transparent)',
        cursor: 'not-allowed',
      }),
    };

    return (
      <div key={t.id}>
        <div
          data-testid={`tree-node-${t.id}`}
          data-drag-state={dropState}
          draggable
          style={nodeStyle}
          onDragStart={(e) => handleDragStart(e, t.id)}
          onDragOver={(e) => handleDragOver(e, t.id)}
          onDragLeave={(e) => handleDragLeave(e, t.id)}
          onDrop={(e) => handleDrop(e, t.id)}
          onDragEnd={handleDragEnd}
          onClick={() => onSelect(t.id)}
        >
          <span
            aria-hidden
            style={{
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              userSelect: 'none',
            }}
          >
            ⋮⋮
          </span>
          <span
            style={{
              width: 16,
              display: 'inline-flex',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShapeSvg shape={t.shape} color={t.color} size={14} />
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-brand)',
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {t.rune}
          </span>
          <span style={{ fontWeight: 500, fontSize: 'var(--text-sm)' }}>{t.label}</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-text-muted)',
              marginLeft: 'auto',
            }}
          >
            {t.id}
          </span>
        </div>
        {children.length > 0 && <div>{children.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div>
      <p
        style={{
          margin: '0 0 var(--space-4)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.5,
        }}
      >
        <strong>Drag</strong> a type onto another to reparent it. The{' '}
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>canContain</code> edge moves
        to the new parent;{' '}
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>parentTypes</code> on the
        child updates. Cycles are blocked.
      </p>

      <div data-testid="containment-tree">{roots.map((r) => renderNode(r))}</div>

      {orphans.length > 0 && (
        <div
          data-testid="orphans-section"
          style={{
            marginTop: 'var(--space-6)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              marginBottom: 'var(--space-2)',
            }}
          >
            orphans — parent missing
          </div>
          {orphans.map((o) => renderNode(o))}
        </div>
      )}
    </div>
  );
}

// ── JsonTab ───────────────────────────────────────────────────────────────────

interface JsonTabProps {
  registry: Registry;
}

function JsonTab({ registry }: JsonTabProps) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(registry, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(json).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // clipboard may not be available in test/iframe contexts — ignore
      },
    );
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        aria-label="Copy JSON"
        data-testid="copy-json-btn"
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top: 'var(--space-2)',
          right: 'var(--space-2)',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          color: copied ? 'var(--color-brand)' : 'var(--color-text-secondary)',
          cursor: 'pointer',
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-mono)',
          padding: '4px 10px',
          zIndex: 1,
        }}
      >
        {copied ? 'copied!' : 'copy'}
      </button>
      <pre
        data-testid="json-output"
        style={{
          margin: 0,
          padding: 'var(--space-4)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
          overflowX: 'auto',
          lineHeight: 1.6,
          maxHeight: 600,
          overflowY: 'auto',
        }}
      >
        {json}
      </pre>
    </div>
  );
}

// ── RegistryEditor ────────────────────────────────────────────────────────────

export interface RegistryEditorProps {
  registry: Registry;
}

export function RegistryEditor({ registry: initialRegistry }: RegistryEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>('types');
  const { registry, selectedId, select, tryReparent } = useRegistryEditor(initialRegistry);

  const selectedType = registry.types.find((t) => t.id === selectedId) ?? null;

  const tabButtonStyle = (tab: TabId): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid var(--color-brand)' : '2px solid transparent',
    color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-sm)',
    fontWeight: activeTab === tab ? 600 : 400,
    padding: 'var(--space-2) var(--space-3)',
    marginBottom: -1,
  });

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--color-bg-primary)',
      }}
    >
      {/* Main column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            padding: 'var(--space-4) var(--space-6)',
            borderBottom: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-1)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 700 }}>
              Entity type registry
            </h2>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-text-muted)',
              }}
            >
              rev{' '}
              <strong style={{ color: 'var(--color-text-secondary)' }}>{registry.version}</strong>
              {' · '}
              {registry.types.length} types
              {' · '}
              updated {formatDate(registry.updatedAt)}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border-subtle)',
            padding: '0 var(--space-6)',
            flexShrink: 0,
          }}
        >
          {(['types', 'containment', 'json'] as TabId[]).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              data-testid={`tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              style={tabButtonStyle(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div
          role="tabpanel"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-5) var(--space-6)',
          }}
        >
          {activeTab === 'types' && (
            <TypesTab registry={registry} selectedId={selectedId} onSelect={select} />
          )}
          {activeTab === 'containment' && (
            <ContainmentTab
              registry={registry}
              selectedId={selectedId}
              onSelect={select}
              tryReparent={tryReparent}
            />
          )}
          {activeTab === 'json' && <JsonTab registry={registry} />}
        </div>
      </div>

      {/* Drawer */}
      {selectedType && activeTab !== 'json' && (
        <TypePreviewDrawer type={selectedType} onClose={() => select(null)} />
      )}
    </div>
  );
}
