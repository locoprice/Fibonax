import { forwardRef } from 'react';
import { Icon, type IconNode, type LucideIcon, type LucideProps } from 'lucide-react';

// Approved Brains identity: the same three layers as the landing and mobile.
const BRAIN_ICON: IconNode = [
  ['path', {
    d: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
    key: 'layers',
  }],
];

export const BrainIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(
  function BrainIcon({ strokeWidth = 1.8, ...props }, ref) {
    return (
      <Icon
        {...props}
        ref={ref}
        iconNode={BRAIN_ICON}
        strokeWidth={strokeWidth}
        aria-hidden="true"
        focusable="false"
      />
    );
  },
);
