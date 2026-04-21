import { Rune } from '@niuulabs/ui';
import { PLAN_STEPS } from '../domain/plan';
import { StepDots } from './StepDots';
import { usePlanWizard } from './usePlanWizard';
import { PlanPrompt } from './PlanPrompt';
import { PlanQuestions } from './PlanQuestions';
import { PlanRaiding } from './PlanRaiding';
import { PlanDraft } from './PlanDraft';
import { PlanApproved } from './PlanApproved';
import { PlanGuidanceRail } from './PlanGuidanceRail';

/**
 * Plan wizard — five‐step flow for decomposing a human goal into a saga.
 *
 * States: prompt → questions → raiding → draft → approved
 *
 * Layout: 2-column on prompt/questions/draft (left: wizard content, right: guidance rail).
 *         Full-width on raiding and approved (content fills the width).
 */
export function PlanWizard() {
  const { state, submitPrompt, submitAnswers, approveDraft, editPhase, back, clearError } =
    usePlanWizard();

  function handleNewPlan() {
    // Navigate back to /tyr/plan to start fresh (the wizard unmounts and remounts)
    window.location.href = '/tyr/plan';
  }

  const showGuidance =
    state.step === 'prompt' || state.step === 'questions' || state.step === 'draft';

  return (
    <div className="niuu-flex niuu-h-full niuu-overflow-hidden">
      {/* ── Main wizard content ───────────────────────── */}
      <div className="niuu-flex-1 niuu-overflow-y-auto">
        <div className="niuu-p-6 niuu-max-w-2xl niuu-mx-auto">
          <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-mb-6">
            <Rune glyph="ᚦ" size={24} />
            <h1 className="niuu-text-base niuu-font-semibold niuu-text-text-secondary niuu-m-0">
              New saga plan
            </h1>
          </div>

          <StepDots steps={PLAN_STEPS} current={state.step} />

          {state.step === 'prompt' && (
            <PlanPrompt onSubmit={submitPrompt} loading={state.loading} error={state.error} />
          )}

          {state.step === 'questions' && (
            <PlanQuestions
              questions={state.questions}
              initialAnswers={state.answers}
              onSubmit={submitAnswers}
              onBack={() => {
                clearError();
                back();
              }}
            />
          )}

          {state.step === 'raiding' && (
            <PlanRaiding
              error={state.error}
              onBack={() => {
                clearError();
                back();
              }}
            />
          )}

          {state.step === 'draft' && state.structure && (
            <PlanDraft
              structure={state.structure}
              loading={state.loading}
              error={state.error}
              onApprove={approveDraft}
              onBack={() => {
                clearError();
                back();
              }}
              onEditPhase={editPhase}
            />
          )}

          {state.step === 'approved' && state.saga && (
            <PlanApproved saga={state.saga} onNewPlan={handleNewPlan} />
          )}
        </div>
      </div>

      {/* ── Right guidance rail (hidden on raiding/approved) ── */}
      {showGuidance && (
        <div className="niuu-border-l niuu-border-border-subtle niuu-overflow-y-auto niuu-bg-bg-primary">
          <PlanGuidanceRail />
        </div>
      )}
    </div>
  );
}
