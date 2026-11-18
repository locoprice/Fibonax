import { useEffect } from 'react';
import { leaveForMobile } from '@/lib/api/referralApi';

// Rendered for any viewport below 1024px. Immediately redirects to /mobile/.
// Returns null to avoid a flash of content before the effect fires.
// A new account that arrived through a friend's link is placed under it on
// the way out (leaveForMobile); everyone else leaves at once.
export function DesktopGate() {
  useEffect(() => {
    void leaveForMobile();
  }, []);

  return null;
}
