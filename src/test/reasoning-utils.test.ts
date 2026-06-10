import { strict as assert } from 'assert';
import {
  deriveReasoningEffortFromMode,
  deriveThinkingLevelFromMode,
  deriveBudgetRatioFromMode,
  deriveThinkingBudget
} from '../reasoning-utils';

describe('reasoning-utils', () => {
  describe('deriveReasoningEffortFromMode', () => {
    it('maps each mode to the expected effort level', () => {
      assert.equal(deriveReasoningEffortFromMode('auto'), undefined);
      assert.equal(deriveReasoningEffortFromMode('fast'), 'low');
      assert.equal(deriveReasoningEffortFromMode('balanced'), 'medium');
      assert.equal(deriveReasoningEffortFromMode('deep'), 'high');
    });
  });

  describe('deriveThinkingLevelFromMode', () => {
    it('maps each mode to the expected thinking level string', () => {
      assert.equal(deriveThinkingLevelFromMode('auto'), undefined);
      assert.equal(deriveThinkingLevelFromMode('fast'), 'low');
      assert.equal(deriveThinkingLevelFromMode('balanced'), 'medium');
      assert.equal(deriveThinkingLevelFromMode('deep'), 'high');
    });
  });

  describe('deriveBudgetRatioFromMode', () => {
    it('maps each mode to the expected budget ratio', () => {
      assert.equal(deriveBudgetRatioFromMode('auto'), undefined);
      assert.equal(deriveBudgetRatioFromMode('fast'), 0.25);
      assert.equal(deriveBudgetRatioFromMode('balanced'), 0.55);
      assert.equal(deriveBudgetRatioFromMode('deep'), 0.85);
    });
  });

  describe('deriveThinkingBudget', () => {
    it('returns undefined for auto mode regardless of maxBudget', () => {
      assert.equal(deriveThinkingBudget('auto'), undefined);
      assert.equal(deriveThinkingBudget('auto', 16384), undefined);
    });

    it('returns the fallback budget when maxBudget is not provided', () => {
      assert.equal(deriveThinkingBudget('fast'), 2048);
      assert.equal(deriveThinkingBudget('balanced'), 8192);
      assert.equal(deriveThinkingBudget('deep'), 32768);
    });

    it('scales the budget by the mode ratio when maxBudget is provided', () => {
      assert.equal(deriveThinkingBudget('fast', 10000), 2500);      // 0.25
      assert.equal(deriveThinkingBudget('balanced', 10000), 5500);  // 0.55
      assert.equal(deriveThinkingBudget('deep', 10000), 8500);      // 0.85
    });

    it('rounds the scaled budget to the nearest integer', () => {
      assert.equal(deriveThinkingBudget('fast', 1001), 250);        // 250.25 → 250
      assert.equal(deriveThinkingBudget('balanced', 1001), 551);    // 550.55 → 551
    });

    it('clamps scaled budget to a minimum of 1', () => {
      assert.equal(deriveThinkingBudget('fast', 1), 1);
      assert.equal(deriveThinkingBudget('balanced', 1), 1);
      assert.equal(deriveThinkingBudget('deep', 1), 1);
    });

    it('ignores non-positive maxBudget values', () => {
      assert.equal(deriveThinkingBudget('fast', 0), 2048);
      assert.equal(deriveThinkingBudget('balanced', -100), 8192);
    });
  });

  describe('invalid REASONING_MODE values (negative validation)', () => {
    it('returns undefined for unknown mode strings in deriveReasoningEffortFromMode', () => {
      assert.equal(deriveReasoningEffortFromMode('turbo' as never), undefined);
      assert.equal(deriveReasoningEffortFromMode('' as never), undefined);
      assert.equal(deriveReasoningEffortFromMode('BALANCED' as never), undefined);
      assert.equal(deriveReasoningEffortFromMode('fast ' as never), undefined);
    });

    it('returns undefined for unknown mode strings in deriveThinkingLevelFromMode', () => {
      assert.equal(deriveThinkingLevelFromMode('turbo' as never), undefined);
      assert.equal(deriveThinkingLevelFromMode('max' as never), undefined);
      assert.equal(deriveThinkingLevelFromMode(null as never), undefined);
      assert.equal(deriveThinkingLevelFromMode(undefined as never), undefined);
    });

    it('returns undefined for unknown mode strings in deriveBudgetRatioFromMode', () => {
      assert.equal(deriveBudgetRatioFromMode('turbo' as never), undefined);
      assert.equal(deriveBudgetRatioFromMode('123' as never), undefined);
    });

    it('returns undefined for unknown mode strings in deriveThinkingBudget (no maxBudget)', () => {
      assert.equal(deriveThinkingBudget('turbo' as never), undefined);
      assert.equal(deriveThinkingBudget('' as never), undefined);
    });

    it('returns undefined for unknown mode strings in deriveThinkingBudget (with maxBudget)', () => {
      assert.equal(deriveThinkingBudget('turbo' as never, 16384), undefined);
      assert.equal(deriveThinkingBudget('rapid' as never, 8192), undefined);
    });
  });

  describe('out-of-range and malformed numeric inputs (negative validation)', () => {
    it('derives a budget clamped to >= 1 for tiny positive maxBudget on any mode', () => {
      // Even with 1 as the budget, the result must be at least 1.
      assert.equal(deriveThinkingBudget('fast', 1), 1);
      assert.equal(deriveThinkingBudget('balanced', 1), 1);
      assert.equal(deriveThinkingBudget('deep', 1), 1);
    });

    it('falls back to defaults when maxBudget is NaN (non-finite)', () => {
      // NaN fails the `> 0` check and falls through to the fallback budget.
      assert.equal(deriveThinkingBudget('fast', Number.NaN), 2048);
      assert.equal(deriveThinkingBudget('balanced', Number.NaN), 8192);
      assert.equal(deriveThinkingBudget('deep', Number.NaN), 32768);
    });

    it('does not throw for Infinity or NaN budgets (documents current behavior)', () => {
      // The current implementation uses `maxBudget > 0` as the guard, so:
      //   - NaN: > 0 is false → falls through to fallback budget.
      //   - -Infinity: > 0 is false → falls through to fallback budget.
      //   - +Infinity: > 0 is true → scales to Infinity (Math.max(1, ∞) = ∞).
      // We assert the non-crashing contract here without endorsing the math.
      assert.equal(deriveThinkingBudget('fast', Number.NaN), 2048);
      assert.equal(deriveThinkingBudget('balanced', Number.NEGATIVE_INFINITY), 8192);
      assert.equal(deriveThinkingBudget('fast', Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
    });

    it('handles fractional maxBudget values without throwing', () => {
      // 1000 * 0.25 = 250 exactly
      assert.equal(deriveThinkingBudget('fast', 1000.5), Math.round(1000.5 * 0.25));
      assert.equal(deriveThinkingBudget('balanced', 999.99), Math.round(999.99 * 0.55));
    });

    it('returns a whole number for any maxBudget >= 1', () => {
      const result = deriveThinkingBudget('balanced', 1001);
      assert.equal(typeof result, 'number');
      assert.equal(result, Math.round(result as number));
    });
  });

  describe('malformed model-like inputs (negative validation)', () => {
    // The reasoning utils don't take a model name directly, but we still
    // verify the lookup behavior is defensive against common malformed
    // values that callers might pass through.
    it('treats empty and whitespace-only mode strings as unknown', () => {
      assert.equal(deriveReasoningEffortFromMode(' ' as never), undefined);
      assert.equal(deriveThinkingLevelFromMode('\t' as never), undefined);
      assert.equal(deriveBudgetRatioFromMode('\n' as never), undefined);
      assert.equal(deriveThinkingBudget('   ' as never, 1024), undefined);
    });

    it('is case-sensitive: only the canonical lowercase modes are recognized', () => {
      assert.equal(deriveReasoningEffortFromMode('AUTO' as never), undefined);
      assert.equal(deriveReasoningEffortFromMode('Fast' as never), undefined);
      assert.equal(deriveThinkingLevelFromMode('DEEP' as never), undefined);
    });
  });
});
