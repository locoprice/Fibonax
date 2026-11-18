import { useEffect, useState } from 'react';
import { loadFillFormEngine, unfinishedItems } from '@/lib/fillFormEngine';
import type { UnfinishedPiece } from '@/lib/snippetQuality';

/** What looks unfinished in a text, with no form fields to check. */
export type UnfinishedRule = (text: string) => readonly UnfinishedPiece[];

function rule(text: string): readonly UnfinishedPiece[] {
  return unfinishedItems(text, []);
}

export interface UnfinishedRuleState {
  /** The rule, once the shared engine has loaded; null until then. */
  rule: UnfinishedRule | null;
  /** True when the engine could not be loaded, so no score can be given. */
  failed: boolean;
}

/**
 * The "looks unfinished" rule the extension and the phone run before a snippet
 * goes out (extension/shared/fill-form.js), for the snippet rating. It loads
 * with the shared engine, so a score appears once that has arrived rather
 * than a different score first and the real one a moment later.
 */
export function useUnfinishedRule(): UnfinishedRuleState {
  const [state, setState] = useState<UnfinishedRuleState>(() => ({
    rule: window.SBFillForm ? rule : null,
    failed: false,
  }));

  useEffect(() => {
    if (state.rule) return;
    let live = true;
    loadFillFormEngine()
      .then(() => {
        if (live) setState({ rule, failed: false });
      })
      .catch((error: unknown) => {
        console.error('Snippet quality: the snippet engine did not load', error);
        if (live) setState({ rule: null, failed: true });
      });
    return () => {
      live = false;
    };
  }, [state.rule]);

  return state;
}
