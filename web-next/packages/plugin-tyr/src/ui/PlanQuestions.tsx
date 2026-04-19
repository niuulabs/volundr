import { useState } from 'react';
import type { ClarifyingQuestion } from '../domain/plan';

interface PlanQuestionsProps {
  questions: ClarifyingQuestion[];
  initialAnswers?: Record<string, string>;
  onSubmit(answers: Record<string, string>): void;
  onBack(): void;
}

/**
 * Step 2 of the Plan wizard — answer clarifying questions from the planning raven.
 */
export function PlanQuestions({
  questions,
  initialAnswers = {},
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
          Answer as many questions as you can. Answers are optional — skip any that don't apply.
        </p>
      </div>

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
            <input
              id={`q-${q.id}`}
              type="text"
              value={answers[q.id] ?? ''}
              onChange={(e) => handleChange(q.id, e.target.value)}
              aria-describedby={q.hint ? `q-${q.id}-hint` : undefined}
              placeholder="Your answer (optional)"
              className="niuu-w-full niuu-rounded-md niuu-border niuu-border-border niuu-bg-bg-secondary niuu-px-3 niuu-py-2 niuu-text-sm niuu-text-text-primary niuu-placeholder-text-muted focus:niuu-outline-none focus:niuu-ring-2 focus:niuu-ring-brand-500/40"
            />
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
          className="niuu-rounded-md niuu-bg-brand-500 niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-white hover:niuu-bg-brand-600 niuu-transition-colors"
        >
          Decompose →
        </button>
      </div>
    </form>
  );
}
