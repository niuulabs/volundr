import { useState } from 'react';
import type { ClarifyingQuestion } from '../domain/plan';
import type { Workflow } from '../domain/workflow';

interface PlanQuestionsProps {
  questions: ClarifyingQuestion[];
  initialAnswers?: Record<string, string>;
  /** The user's original prompt — shown as a "YOUR BRIEF" quote card. */
  prompt?: string;
  /**
   * Workflow templates for the workflow-kind question picker.
   * Fetched by the parent (PlanWizard) and passed down to keep this component service-free.
   */
  workflows?: Workflow[];
  onSubmit(answers: Record<string, string>): void;
  onBack(): void;
}

/**
 * Step 2 of the Plan wizard — answer clarifying questions from the planning raven.
 *
 * Renders a "YOUR BRIEF" quote card above the questions, and supports a special
 * `kind: 'workflow'` question type that renders a 3-column template picker grid.
 */
export function PlanQuestions({
  questions,
  initialAnswers = {},
  prompt,
  workflows = [],
  onSubmit,
  onBack,
}: PlanQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);

  function handleChange(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(answers);
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Clarifying questions form"
      className="niuu-flex niuu-flex-col niuu-gap-4"
    >
      <div className="niuu-flex niuu-flex-col niuu-gap-1">
        <h2 className="niuu-text-lg niuu-font-semibold niuu-text-text-primary">
          Clarify your plan
        </h2>
        <p className="niuu-text-sm niuu-text-text-secondary">
          Answer as many questions as you can. Answers are optional — skip any that don&apos;t
          apply.
        </p>
      </div>

      {prompt && (
        <div
          className="niuu-rounded-md niuu-border niuu-border-border niuu-bg-bg-elevated niuu-px-4 niuu-py-3"
          aria-label="Your brief"
        >
          <p className="niuu-text-xs niuu-font-semibold niuu-text-text-muted niuu-uppercase niuu-tracking-wider niuu-font-mono niuu-mb-1">
            Your Brief
          </p>
          <p className="niuu-text-xs niuu-text-text-secondary niuu-leading-relaxed">{prompt}</p>
        </div>
      )}

      {questions.length === 0 && (
        <p className="niuu-text-sm niuu-text-text-muted niuu-italic">
          No clarifying questions — you can proceed directly.
        </p>
      )}

      <ol className="niuu-flex niuu-flex-col niuu-gap-4 niuu-list-none niuu-p-0 niuu-m-0">
        {questions.map((q, idx) => (
          <li key={q.id} className="niuu-flex niuu-flex-col niuu-gap-1">
            <label
              htmlFor={`q-${q.id}`}
              className="niuu-text-sm niuu-font-medium niuu-text-text-primary"
            >
              <span className="niuu-text-text-muted niuu-mr-2">{idx + 1}.</span>
              {q.question}
            </label>
            {q.hint && (
              <p className="niuu-text-xs niuu-text-text-muted" id={`q-${q.id}-hint`}>
                {q.hint}
              </p>
            )}
            {q.kind === 'workflow' ? (
              <div
                role="group"
                aria-label="Workflow template picker"
                className="niuu-grid niuu-grid-cols-3 niuu-gap-2 niuu-mt-1"
              >
                {workflows.map((wf) => {
                  const stageCount = wf.nodes.filter((n) => n.kind === 'stage').length;
                  const isSelected = answers[q.id] === wf.id;
                  return (
                    <button
                      key={wf.id}
                      type="button"
                      onClick={() => handleChange(q.id, wf.id)}
                      aria-pressed={isSelected}
                      className={[
                        'niuu-rounded-md niuu-border niuu-p-3 niuu-text-left niuu-transition-colors',
                        isSelected
                          ? 'niuu-border-brand-500 niuu-bg-brand-500/10'
                          : 'niuu-border-border niuu-bg-bg-secondary hover:niuu-bg-bg-elevated',
                      ].join(' ')}
                    >
                      <div className="niuu-text-xs niuu-font-medium niuu-text-text-primary">
                        {wf.name}
                      </div>
                      <div className="niuu-text-xs niuu-text-text-muted niuu-font-mono niuu-mt-1">
                        {stageCount} stage{stageCount !== 1 ? 's' : ''}
                      </div>
                    </button>
                  );
                })}
                {workflows.length === 0 && (
                  <p className="niuu-col-span-3 niuu-text-xs niuu-text-text-muted niuu-italic">
                    No workflow templates available.
                  </p>
                )}
              </div>
            ) : (
              <input
                id={`q-${q.id}`}
                type="text"
                value={answers[q.id] ?? ''}
                onChange={(e) => handleChange(q.id, e.target.value)}
                aria-describedby={q.hint ? `q-${q.id}-hint` : undefined}
                placeholder="Your answer (optional)"
                className="niuu-w-full niuu-rounded-md niuu-border niuu-border-border niuu-bg-bg-secondary niuu-px-3 niuu-py-2 niuu-text-sm niuu-text-text-primary niuu-placeholder-text-muted focus:niuu-outline-none focus:niuu-ring-2 focus:niuu-ring-brand-500/40"
              />
            )}
          </li>
        ))}
      </ol>

      <div className="niuu-flex niuu-justify-between">
        <button
          type="button"
          onClick={onBack}
          className="niuu-rounded-md niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-text-secondary niuu-border niuu-border-border hover:niuu-bg-bg-elevated niuu-transition-colors"
        >
          ← Back
        </button>
        <button
          type="submit"
          className="niuu-py-1 niuu-px-3 niuu-bg-brand niuu-text-bg-primary niuu-border niuu-border-brand niuu-rounded-sm niuu-cursor-pointer niuu-font-mono niuu-text-xs"
        >
          Decompose →
        </button>
      </div>
    </form>
  );
}
