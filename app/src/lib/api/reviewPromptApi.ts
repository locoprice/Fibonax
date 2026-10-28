import { supabase } from '@/lib/supabase';
import {
  readReviewPromptStatus,
  type ReviewPromptState,
  type ReviewPromptStopReason,
} from '@/lib/reviewPrompt';

// The review prompt's three server calls (migration
// 20261027140000_review_prompt.sql). Each is keyed on the caller's own session,
// so none takes a user id. None throws: the prompt is a courtesy, and a failed
// call means it stays hidden, never that the dashboard breaks.

export const reviewPromptApi = {
  /** This person's counts, or null when they cannot be read. */
  async getStatus(): Promise<ReviewPromptState | null> {
    try {
      const { data, error } = await supabase.rpc('review_prompt_status');
      if (error) {
        console.warn('reviewPromptApi: status not read', error);
        return null;
      }
      return readReviewPromptStatus(data);
    } catch (err) {
      console.warn('reviewPromptApi: status not read', err);
      return null;
    }
  },

  /**
   * Count one view. True only when the server added it: the prompt is drawn on
   * true and never otherwise, so a view is counted before it is shown, and a
   * sixth is refused here whatever the caller decided.
   */
  async recordView(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('review_prompt_record_view');
      if (error) {
        console.warn('reviewPromptApi: view not recorded', error);
        return false;
      }
      return data === true;
    } catch (err) {
      console.warn('reviewPromptApi: view not recorded', err);
      return false;
    }
  },

  /** Stop asking for good. */
  async stop(reason: ReviewPromptStopReason): Promise<void> {
    try {
      const { error } = await supabase.rpc('review_prompt_stop', { p_reason: reason });
      if (error) console.warn('reviewPromptApi: stop not saved', error);
    } catch (err) {
      console.warn('reviewPromptApi: stop not saved', err);
    }
  },
};
