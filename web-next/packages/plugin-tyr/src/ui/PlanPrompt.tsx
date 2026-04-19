import { useState } from 'react';

interface PlanPromptProps {
  onSubmit(prompt: string, repo: string): void;
  loading: boolean;
  error: string | null;
}

/**
 * Step 1 of the Plan wizard — capture the human‐language goal and target repo.
 */
export function PlanPrompt({ onSubmit, loading, error }: PlanPromptProps) {
  const [prompt, setPrompt] = useState('');
  const [repo, setRepo] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    onSubmit(prompt.trim(), repo.trim());
  }

  const canSubmit = prompt.trim().length > 0 && !loading;

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Plan prompt form"
      className="niuu-flex niuu-flex-col niuu-gap-4"
    >
      <div className="niuu-flex niuu-flex-col niuu-gap-1">
        <h2 className="niuu-text-lg niuu-font-semibold niuu-text-text-primary">
          Describe your goal
        </h2>
        <p className="niuu-text-sm niuu-text-text-secondary">
          Tell Tyr what you want to build. The planning raven will decompose it into phases and
          raids.
        </p>
      </div>

      <div className="niuu-flex niuu-flex-col niuu-gap-1">
        <label
          htmlFor="plan-prompt"
          className="niuu-text-sm niuu-font-medium niuu-text-text-secondary"
        >
          Goal description
          <span className="niuu-ml-1 niuu-text-critical" aria-hidden="true">
            *
          </span>
        </label>
        <textarea
          id="plan-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Add OIDC authentication with Keycloak, including silent token refresh and PAT support for headless agents."
          rows={5}
          required
          aria-required="true"
          aria-describedby={error ? 'plan-prompt-error' : undefined}
          className="niuu-w-full niuu-rounded-md niuu-border niuu-border-border niuu-bg-bg-secondary niuu-px-3 niuu-py-2 niuu-text-sm niuu-text-text-primary niuu-placeholder-text-muted niuu-resize-y focus:niuu-outline-none focus:niuu-ring-2 focus:niuu-ring-brand-500/40"
        />
      </div>

      <div className="niuu-flex niuu-flex-col niuu-gap-1">
        <label htmlFor="plan-repo" className="niuu-text-sm niuu-font-medium niuu-text-text-secondary">
          Target repository
        </label>
        <input
          id="plan-repo"
          type="text"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="e.g. niuulabs/volundr"
          className="niuu-w-full niuu-rounded-md niuu-border niuu-border-border niuu-bg-bg-secondary niuu-px-3 niuu-py-2 niuu-text-sm niuu-text-text-primary niuu-placeholder-text-muted focus:niuu-outline-none focus:niuu-ring-2 focus:niuu-ring-brand-500/40"
        />
      </div>

      {error && (
        <p
          id="plan-prompt-error"
          role="alert"
          className="niuu-text-sm niuu-text-critical"
        >
          {error}
        </p>
      )}

      <div className="niuu-flex niuu-justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="niuu-rounded-md niuu-bg-brand-500 niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-white disabled:niuu-opacity-40 disabled:niuu-cursor-not-allowed hover:niuu-bg-brand-600 niuu-transition-colors"
        >
          {loading ? 'Starting…' : 'Next →'}
        </button>
      </div>
    </form>
  );
}
