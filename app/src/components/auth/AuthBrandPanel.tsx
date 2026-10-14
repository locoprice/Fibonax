import { ShieldCheck, Users } from 'lucide-react';
import { AuthProductDemo } from '@/components/auth/AuthProductDemo';

// Left brand panel shared by the login and signup split-screens.
// Hidden below `lg` — the form panel goes full-width on narrow viewports.
export function AuthBrandPanel() {
  return (
    <aside
      aria-label="Discover Fibonax"
      className="hidden lg:flex lg:w-[44%] flex-col justify-between gap-6 bg-gradient-to-b from-primary to-primary-dark p-8 xl:px-12"
    >
      <div className="my-auto">
        <AuthProductDemo />
      </div>

      {/* Trust signals */}
      <div className="space-y-4">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5 text-[13px] text-white/75">
            <ShieldCheck className="h-4 w-4 shrink-0 text-white/90" aria-hidden="true" />
            Encrypted and EU-hosted. Your data stays yours.
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-white/75">
            <Users className="h-4 w-4 shrink-0 text-white/90" aria-hidden="true" />
            Built and used daily by the LeibTour ops team.
          </div>
        </div>
      </div>
    </aside>
  );
}
