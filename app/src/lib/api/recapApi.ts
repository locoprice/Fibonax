import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import { readEdgeErrorCode } from '@/lib/api/edgeFunctionError';

// The monthly recap email (migration 20261104120000_monthly_recap.sql and the
// `monthly-recap` edge function). The switch is read and written through two
// SECURITY DEFINER functions keyed on auth.uid(); "Email me last month's
// recap" asks the edge function to send it to the signed-in person now.

const SEND_FAILED = 'The recap could not be sent. Try again in a minute.';
const NOT_CONFIGURED = 'Email sending is not set up yet.';
const NOT_ELIGIBLE = 'Confirm your email address first, then try again.';

export interface RecapApi {
  /** Whether the recap is on for the signed-in person (on until turned off). */
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  /** Send last month's recap to the signed-in person now. Resolves to the month sent and the address. */
  sendToMe(): Promise<{ month: string; to: string }>;
}

export const recapApi: RecapApi = {
  async getEnabled() {
    const { data, error } = await supabase.rpc('monthly_recap_setting');
    if (error) throw toApiError(error, 'Could not read the monthly recap setting.');
    return data !== false;
  },

  async setEnabled(enabled) {
    const { data, error } = await supabase.rpc('set_monthly_recap', { p_enabled: enabled });
    if (error) throw toApiError(error, 'The setting could not be saved. Try again.');
    return data !== false;
  },

  async sendToMe() {
    const { data, error } = await supabase.functions.invoke<{ month?: string; to?: string }>('monthly-recap', {
      body: { action: 'send' },
    });
    if (error) {
      const code = await readEdgeErrorCode(error);
      if (code === 'not_configured') throw new Error(NOT_CONFIGURED);
      if (code === 'not_eligible') throw new Error(NOT_ELIGIBLE);
      throw new Error(SEND_FAILED);
    }
    return { month: data?.month ?? '', to: data?.to ?? '' };
  },
};
