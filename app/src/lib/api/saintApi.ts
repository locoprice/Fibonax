import { supabase } from '@/lib/supabase';
import { readSaintResponse, SAINT_FUNCTION, type SaintReading } from '@/lib/saintOfDay';

// Santo del Giorno.
//
// Asks the saint-of-the-day edge function, which reads Vatican News about once
// a day and answers the dashboard and the popup alike. The footer treats any
// failure as "show nothing", so the message below is for whoever reads the
// error, never for the person looking at the footer.

const SAINT_FAILED = 'Could not load the saint of the day.';

export interface SaintApi {
  getSaintOfDay(): Promise<SaintReading>;
}

export const saintApi: SaintApi = {
  async getSaintOfDay() {
    const { data, error } = await supabase.functions.invoke<unknown>(SAINT_FUNCTION, { body: {} });
    if (error) throw new Error(SAINT_FAILED);
    const reading = readSaintResponse(data);
    if (!reading) throw new Error(SAINT_FAILED);
    return reading;
  },
};
