import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';

// Account deletion. The preview is a SECURITY DEFINER read scoped to
// auth.uid(); the delete runs through the `delete-account` edge function,
// which takes the account from the caller's JWT and nothing else (migration
// 20261018120000_delete_account.sql).

/** A team that would be deleted for everyone, because the caller is its only admin. */
export interface TeamLostOnDelete {
  organizationId: string;
  name: string;
  /** People other than the caller who lose access to it. */
  otherMembers: number;
}

interface PreviewRow {
  organization_id: string;
  org_name: string;
  other_members: number;
}

export interface AccountApi {
  /** Teams deleted along with the account. Empty when nothing is lost for anyone else. */
  previewDelete(): Promise<TeamLostOnDelete[]>;
  /** Delete the signed-in account and everything it owns. Cannot be undone. */
  deleteAccount(): Promise<void>;
}

export const accountApi: AccountApi = {
  async previewDelete() {
    const { data, error } = await supabase.rpc('account_deletion_preview');
    if (error) throw toApiError(error, 'Could not check your teams. Close this window and try again.');
    return ((data ?? []) as PreviewRow[]).map((r) => ({
      organizationId: r.organization_id,
      name: r.org_name,
      otherMembers: r.other_members,
    }));
  },

  async deleteAccount() {
    const { error } = await supabase.functions.invoke('delete-account', { body: {} });
    if (error) {
      throw new Error('Your account could not be deleted. Nothing was changed. Try again.');
    }
  },
};
