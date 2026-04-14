# Ravn Mesh Demo Logs (Run 5 - Improved Prompts)

**Date:** 2026-04-14 01:02-01:03 UTC

## Changes Made

1. Updated `build_initiative_prompt` to clearly instruct "output outcome block and STOP"
2. Updated `generate_outcome_instruction` to emphasize stopping after outcome
3. Updated persona prompts to describe simple workflows
4. Reduced iteration budgets (reviewer: 30, deployer: 10)

## Findings

The model (gemma) still doesn't stop:
- Made 28+ HTTP requests
- Used cascade tools to spawn subtasks ("Resolve Git Lock")
- Didn't produce the outcome block and stop

## Root Cause

The issue is NOT the mesh routing (which works correctly). The issue is:

1. **Model behavior** - gemma keeps exploring and calling tools instead of completing
   the task concisely. It doesn't follow "STOP after outcome" instructions well.

2. **Cascade tools leaked** - The reviewer persona has `allowed_tools: [file, git]` 
   but cascade tools are added anyway by the daemon profile.

## Recommendations

1. Use a more instruction-following model (Claude, GPT-4) for testing
2. Add tool filtering to respect persona's `allowed_tools` config
3. Consider adding early termination when outcome block is detected
