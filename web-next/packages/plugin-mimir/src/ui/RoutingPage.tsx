import { useState } from 'react';
import { StateDot, Chip } from '@niuulabs/ui';
import { useRouting } from '../application/useRouting';
import type { WriteRoutingRule } from '../domain/routing';
import './RoutingPage.css';

function newRule(): WriteRoutingRule {
  return {
    id: `route-${Date.now()}`,
    prefix: '/',
    mountName: '',
    priority: 50,
    active: true,
    desc: '',
  };
}

interface RuleFormProps {
  rule: WriteRoutingRule;
  onSave: (rule: WriteRoutingRule) => void;
  onCancel: () => void;
  isSaving: boolean;
}

function RuleForm({ rule, onSave, onCancel, isSaving }: RuleFormProps) {
  const [draft, setDraft] = useState(rule);

  function set<K extends keyof WriteRoutingRule>(key: K, value: WriteRoutingRule[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(draft);
  }

  return (
    <form className="routing-page__form" onSubmit={handleSubmit} aria-label="Routing rule editor">
      <div className="routing-page__form-row">
        <label className="routing-page__label" htmlFor="rule-prefix">
          Prefix
        </label>
        <input
          id="rule-prefix"
          className="routing-page__input"
          type="text"
          placeholder="/infra"
          value={draft.prefix}
          onChange={(e) => set('prefix', e.target.value)}
          required
          aria-label="Path prefix"
        />
      </div>

      <div className="routing-page__form-row">
        <label className="routing-page__label" htmlFor="rule-mount">
          Mount
        </label>
        <input
          id="rule-mount"
          className="routing-page__input"
          type="text"
          placeholder="local"
          value={draft.mountName}
          onChange={(e) => set('mountName', e.target.value)}
          required
          aria-label="Target mount"
        />
      </div>

      <div className="routing-page__form-row">
        <label className="routing-page__label" htmlFor="rule-priority">
          Priority
        </label>
        <input
          id="rule-priority"
          className="routing-page__input routing-page__input--narrow"
          type="number"
          min={0}
          value={draft.priority}
          onChange={(e) => set('priority', Number(e.target.value))}
          required
          aria-label="Priority"
        />
      </div>

      <div className="routing-page__form-row">
        <label className="routing-page__label" htmlFor="rule-desc">
          Description
        </label>
        <input
          id="rule-desc"
          className="routing-page__input"
          type="text"
          placeholder="optional description"
          value={draft.desc ?? ''}
          onChange={(e) => set('desc', e.target.value)}
          aria-label="Description"
        />
      </div>

      <div className="routing-page__form-row">
        <label className="routing-page__label" htmlFor="rule-active">
          Active
        </label>
        <input
          id="rule-active"
          type="checkbox"
          checked={draft.active}
          onChange={(e) => set('active', e.target.checked)}
          aria-label="Active"
        />
      </div>

      <div className="routing-page__form-actions">
        <button
          type="submit"
          className="routing-page__btn routing-page__btn--primary"
          disabled={isSaving}
          aria-label="Save rule"
        >
          {isSaving ? 'saving…' : 'Save rule'}
        </button>
        <button
          type="button"
          className="routing-page__btn"
          onClick={onCancel}
          aria-label="Cancel"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RoutingPage() {
  const {
    rules,
    isLoading,
    isError,
    error,
    testPath,
    setTestPath,
    testResult,
    upsertRule,
    deleteRule,
    isSaving,
    isDeleting,
  } = useRouting();

  const [editingRule, setEditingRule] = useState<WriteRoutingRule | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  function startAdd() {
    setEditingRule(null);
    setIsAdding(true);
  }

  function startEdit(rule: WriteRoutingRule) {
    setIsAdding(false);
    setEditingRule(rule);
  }

  function handleSave(rule: WriteRoutingRule) {
    upsertRule(rule);
    setEditingRule(null);
    setIsAdding(false);
  }

  function handleCancel() {
    setEditingRule(null);
    setIsAdding(false);
  }

  return (
    <div className="routing-page">
      <h2 className="routing-page__title">Write Routing</h2>
      <p className="routing-page__subtitle">
        Prefix-based routing rules — first match wins (lowest priority number).
      </p>

      {isLoading && (
        <div className="routing-page__status">
          <StateDot state="processing" pulse />
          <span>loading rules…</span>
        </div>
      )}

      {isError && (
        <div className="routing-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'routing load failed'}</span>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="routing-page__toolbar">
            <button
              className="routing-page__btn routing-page__btn--primary"
              onClick={startAdd}
              aria-label="Add rule"
              disabled={isAdding}
            >
              + Add rule
            </button>
          </div>

          {isAdding && (
            <div className="routing-page__editor" data-testid="rule-editor">
              <h3 className="routing-page__editor-title">New rule</h3>
              <RuleForm
                rule={newRule()}
                onSave={handleSave}
                onCancel={handleCancel}
                isSaving={isSaving}
              />
            </div>
          )}

          {rules.length === 0 && !isAdding && (
            <p className="routing-page__empty">
              No routing rules configured. All writes go to the default mount.
            </p>
          )}

          {rules.length > 0 && (
            <table className="routing-page__table" aria-label="Routing rules">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Prefix</th>
                  <th>Mount</th>
                  <th>Active</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <>
                    <tr key={rule.id} className="routing-page__row" data-testid="routing-rule-row">
                      <td className="routing-page__cell routing-page__cell--priority">
                        {rule.priority}
                      </td>
                      <td className="routing-page__cell">
                        <code className="routing-page__prefix">{rule.prefix}</code>
                      </td>
                      <td className="routing-page__cell">
                        <Chip tone="muted">{rule.mountName}</Chip>
                      </td>
                      <td className="routing-page__cell">
                        <span
                          className={[
                            'routing-page__active',
                            rule.active
                              ? 'routing-page__active--yes'
                              : 'routing-page__active--no',
                          ].join(' ')}
                        >
                          {rule.active ? 'yes' : 'no'}
                        </span>
                      </td>
                      <td className="routing-page__cell routing-page__cell--desc">
                        {rule.desc ?? '—'}
                      </td>
                      <td className="routing-page__cell routing-page__cell--actions">
                        <button
                          className="routing-page__action-btn"
                          onClick={() => startEdit(rule)}
                          aria-label={`Edit rule ${rule.prefix}`}
                        >
                          Edit
                        </button>
                        <button
                          className="routing-page__action-btn routing-page__action-btn--danger"
                          onClick={() => deleteRule(rule.id)}
                          disabled={isDeleting}
                          aria-label={`Delete rule ${rule.prefix}`}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    {editingRule?.id === rule.id && (
                      <tr key={`${rule.id}-edit`}>
                        <td colSpan={6} className="routing-page__edit-cell">
                          <div className="routing-page__editor" data-testid="rule-editor">
                            <h3 className="routing-page__editor-title">Edit rule</h3>
                            <RuleForm
                              rule={editingRule}
                              onSave={handleSave}
                              onCancel={handleCancel}
                              isSaving={isSaving}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}

          {/* Test pane */}
          <section className="routing-page__test-pane" aria-label="Route test pane">
            <h3 className="routing-page__test-title">Test a path</h3>
            <p className="routing-page__test-hint">
              Enter a page path to see which rule and mount it would be routed to.
            </p>
            <div className="routing-page__test-controls">
              <input
                className="routing-page__input routing-page__input--test"
                type="text"
                placeholder="/infra/k8s"
                value={testPath}
                onChange={(e) => setTestPath(e.target.value)}
                aria-label="Test path"
                data-testid="test-path-input"
              />
            </div>
            {testResult && (
              <div
                className={[
                  'routing-page__test-result',
                  testResult.mountName
                    ? 'routing-page__test-result--match'
                    : 'routing-page__test-result--no-match',
                ].join(' ')}
                data-testid="test-result"
              >
                {testResult.mountName ? (
                  <>
                    <Chip tone="brand">{testResult.mountName}</Chip>
                    <span className="routing-page__test-reason">{testResult.reason}</span>
                  </>
                ) : (
                  <span className="routing-page__test-reason routing-page__test-reason--muted">
                    {testResult.reason}
                  </span>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
