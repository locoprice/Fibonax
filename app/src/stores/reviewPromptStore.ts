import { create } from 'zustand';
import { reviewPromptApi } from '@/lib/api/reviewPromptApi';
import { securityApi } from '@/lib/api/securityApi';
import { shouldShowReviewPrompt, type ReviewPromptStopReason } from '@/lib/reviewPrompt';

/**
 * Review prompt store: decides once per page load whether to ask this person
 * for a Chrome Web Store review, and carries out what they answer.
 *
 * The prompt is drawn only after the server has counted the view
 * (`recordView` returns true), so a view is never shown uncounted and the cap
 * of five holds whatever this code decides.
 */

interface ReviewPromptStore {
  visible: boolean;
  /** Decide and, when due, count the view and show the prompt. Once per person per page load. */
  check: (userId: string) => Promise<void>;
  /** They opened the review page. */
  review: () => void;
  /** "Don't ask again". */
  dismiss: () => void;
}

// One check per person per page load: React runs effects twice in development,
// and the layout can remount. The server also counts one view per sign-in
// session, so this only saves the calls.
let checkedFor: string | null = null;

export const useReviewPromptStore = create<ReviewPromptStore>((set) => {
  const stop = (reason: ReviewPromptStopReason): void => {
    set({ visible: false });
    void reviewPromptApi.stop(reason);
  };

  return {
    visible: false,

    check: async (userId) => {
      if (checkedFor === userId) return;
      checkedFor = userId;

      await securityApi.whenLoginRecorded();
      const status = await reviewPromptApi.getStatus();
      if (!shouldShowReviewPrompt(status)) return;
      if (await reviewPromptApi.recordView()) set({ visible: true });
    },

    review: () => stop('reviewed'),
    dismiss: () => stop('dismissed'),
  };
});
