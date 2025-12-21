export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';
export type ReasoningMode = 'auto' | 'fast' | 'balanced' | 'deep';

const MODE_TO_REASONING_EFFORT: Record<ReasoningMode, ReasoningEffort | undefined> = {
  auto: undefined,
  fast: 'low',
  balanced: 'medium',
  deep: 'high'
};

const MODE_TO_THINKING_LEVEL: Record<ReasoningMode, string | undefined> = {
  auto: undefined,
  fast: 'low',
  balanced: 'medium',
  deep: 'high'
};

const MODE_TO_BUDGET_RATIO: Record<ReasoningMode, number | undefined> = {
  auto: undefined,
  fast: 0.25,
  balanced: 0.55,
  deep: 0.85
};

const MODE_TO_FALLBACK_BUDGET: Record<ReasoningMode, number | undefined> = {
  auto: undefined,
  fast: 2000,
  balanced: 6000,
  deep: 12000
};

export function deriveReasoningEffortFromMode(mode: ReasoningMode): ReasoningEffort | undefined {
  return MODE_TO_REASONING_EFFORT[mode];
}

export function deriveThinkingLevelFromMode(mode: ReasoningMode): string | undefined {
  return MODE_TO_THINKING_LEVEL[mode];
}

export function deriveBudgetRatioFromMode(mode: ReasoningMode): number | undefined {
  return MODE_TO_BUDGET_RATIO[mode];
}

export function deriveThinkingBudget(mode: ReasoningMode, maxBudget?: number): number | undefined {
  const ratio = MODE_TO_BUDGET_RATIO[mode];
  if (!ratio) {
    return undefined;
  }

  if (typeof maxBudget === 'number' && maxBudget > 0) {
    return Math.max(1, Math.round(maxBudget * ratio));
  }

  return MODE_TO_FALLBACK_BUDGET[mode];
}
