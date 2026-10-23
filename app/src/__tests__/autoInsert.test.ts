import { describe, expect, it } from 'vitest';
import {
  AUTO_INSERT_DEFAULT_SECONDS,
  AUTO_INSERT_MAX_SECONDS,
  AUTO_INSERT_MIN_SECONDS,
  clampAutoInsertSeconds,
  DEFAULT_TRIGGER_CONFIG,
} from '@/lib/triggerUtils';

// The extension keeps its own copy of this rule (`_autoInsertSeconds` in
// extension/content/content.js); scripts/check-expansion.js pins the same cases.
describe('clampAutoInsertSeconds', () => {
  it('keeps whole seconds inside the range as they are', () => {
    for (let n = AUTO_INSERT_MIN_SECONDS; n <= AUTO_INSERT_MAX_SECONDS; n++) {
      expect(clampAutoInsertSeconds(n)).toBe(n);
    }
  });

  it('pulls values outside the range back to the nearest end', () => {
    expect(clampAutoInsertSeconds(0)).toBe(AUTO_INSERT_MIN_SECONDS);
    expect(clampAutoInsertSeconds(-4)).toBe(AUTO_INSERT_MIN_SECONDS);
    expect(clampAutoInsertSeconds(999)).toBe(AUTO_INSERT_MAX_SECONDS);
  });

  it('rounds to whole seconds', () => {
    expect(clampAutoInsertSeconds(2.6)).toBe(3);
  });

  it('falls back to the default for anything that is not a number', () => {
    expect(clampAutoInsertSeconds(undefined)).toBe(AUTO_INSERT_DEFAULT_SECONDS);
    expect(clampAutoInsertSeconds(null)).toBe(AUTO_INSERT_DEFAULT_SECONDS);
    expect(clampAutoInsertSeconds('soon')).toBe(AUTO_INSERT_DEFAULT_SECONDS);
    expect(clampAutoInsertSeconds(Number.NaN)).toBe(AUTO_INSERT_DEFAULT_SECONDS);
  });

  it('accepts a number stored as text', () => {
    expect(clampAutoInsertSeconds('5')).toBe(5);
  });
});

describe('automatic insert defaults', () => {
  it('ships switched off, with a wait inside the range', () => {
    expect(DEFAULT_TRIGGER_CONFIG.autoInsert).toBe(false);
    expect(DEFAULT_TRIGGER_CONFIG.autoInsertSeconds).toBe(AUTO_INSERT_DEFAULT_SECONDS);
    expect(AUTO_INSERT_DEFAULT_SECONDS).toBeGreaterThanOrEqual(AUTO_INSERT_MIN_SECONDS);
    expect(AUTO_INSERT_DEFAULT_SECONDS).toBeLessThanOrEqual(AUTO_INSERT_MAX_SECONDS);
  });
});
