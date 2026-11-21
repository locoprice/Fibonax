import { create } from 'zustand';
import type { ActivationKey, Profile, StoredOccasion } from '@/types/database';
import { settingsApi } from '@/lib/api/settingsApi';
import { setSeasonCalendar } from '@/lib/season';
import { EMPTY_MY_DETAILS, fetchMyDetails, setMyDetails, type MyDetails } from '@/lib/myDetails';
import { supabase } from '@/lib/supabase';

type Prefix = '/' | '::' | ';';

/** Allowed fields for a profile update — must stay in sync with ProfilePatch in settingsApi. */
interface ProfilePatch {
  display_name?: string;
  company_name?: string;
  shortcut_prefix?: Prefix;
  trigger_snippet_seq?: string;
  trigger_prompt_seq?: string;
  trigger_snippet_key?: ActivationKey;
  trigger_prompt_key?: ActivationKey;
  trigger_auto_insert?: boolean;
  trigger_auto_insert_seconds?: number;
  /** Unused-asset threshold in calendar months, 6-9 (INACTIVE-001). */
  inactivity_months?: number;
  /** The seasonal line's occasions, packed by `packOccasions` (lib/season.ts). */
  occasions?: StoredOccasion[];
}

interface SettingsStore {
  profile: Profile | null;
  /**
   * What {my: …} prints for the person signed in: their name, their company
   * (else their team creator's) and their job title. Worked out by the server.
   */
  myDetails: MyDetails;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  /** Asks the server for Your details again, after a change that may move them. */
  loadMyDetails: () => Promise<void>;
  editProfile: (patch: ProfilePatch) => Promise<Profile>;
  setCompanyLogo: (file: File) => Promise<Profile>;
  clearCompanyLogo: () => Promise<Profile>;
  setAvatar: (file: File) => Promise<Profile>;
  clearAvatar: () => Promise<Profile>;
  changeEmail: (newEmail: string) => Promise<void>;
}

let authSubscribed = false;

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  profile: null,
  myDetails: EMPTY_MY_DETAILS,
  loading: false,
  error: null,
  loadMyDetails: async () => {
    try {
      set({ myDetails: await fetchMyDetails() });
    } catch (err) {
      // The details only fill {my: …}: a failed read keeps the last answer
      // and says so, rather than stopping the page.
      console.error('Your details could not be read:', err instanceof Error ? err.message : err);
    }
  },
  load: async () => {
    set({ loading: true, error: null });
    try {
      const profile = await settingsApi.getProfile();
      set({ profile, loading: false });
      void get().loadMyDetails();
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load settings',
      });
    }

    // Subscribe once: when Supabase emits USER_UPDATED (e.g. after the
    // email-change confirmation link is clicked), re-derive the profile so
    // the Account panel reflects the new email without a page reload.
    if (!authSubscribed) {
      authSubscribed = true;
      supabase.auth.onAuthStateChange((event) => {
        if (event !== 'USER_UPDATED') return;
        if (!get().profile) return;
        void settingsApi
          .getProfile()
          .then((profile) => {
            set({ profile });
            void get().loadMyDetails();
          })
          .catch((err) => {
            set({
              error:
                err instanceof Error ? err.message : 'Failed to refresh profile',
            });
          });
      });
    }
  },
  editProfile: async (patch) => {
    try {
      const profile = await settingsApi.updateProfile(patch);
      set({ profile, error: null });
      // A new name or company is a new answer for {my: …}.
      if (patch.display_name !== undefined || patch.company_name !== undefined) void get().loadMyDetails();
      return profile;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save profile' });
      throw err;
    }
  },
  setCompanyLogo: async (file) => {
    try {
      const profile = await settingsApi.uploadCompanyLogo(file);
      set({ profile, error: null });
      return profile;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to upload logo' });
      throw err;
    }
  },
  clearCompanyLogo: async () => {
    try {
      const profile = await settingsApi.removeCompanyLogo();
      set({ profile, error: null });
      return profile;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to remove logo' });
      throw err;
    }
  },
  setAvatar: async (file) => {
    try {
      const profile = await settingsApi.uploadAvatar(file);
      set({ profile, error: null });
      return profile;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to upload photo' });
      throw err;
    }
  },
  clearAvatar: async () => {
    try {
      const profile = await settingsApi.removeAvatar();
      set({ profile, error: null });
      return profile;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to remove photo' });
      throw err;
    }
  },
  changeEmail: async (newEmail: string) => {
    try {
      await settingsApi.updateEmail(newEmail);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to send verification email' });
      throw err;
    }
  },
}));

// The seasonal line answers from the person's occasions wherever a snippet is
// previewed. Handed over the moment the profile holds them, and again on every
// change, so a preview never prints from a calendar that was just replaced.
useSettingsStore.subscribe((state, prev) => {
  if (state.profile?.occasions !== prev.profile?.occasions) {
    setSeasonCalendar(state.profile?.occasions ?? []);
  }
  if (state.myDetails !== prev.myDetails) setMyDetails(state.myDetails);
});
