import { forwardRef } from 'react';
import { Icon, type IconNode, type LucideIcon, type LucideProps } from 'lucide-react';

// Approved option A: keep aligned with the landing, mobile and extension SVG.
const PROMPT_ICON: IconNode = [
  ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '3', key: 'window' }],
  ['path', { d: 'm7 9 3 3-3 3m6 0h4', key: 'command' }],
];

export const PromptIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(
  function PromptIcon({ strokeWidth = 1.8, ...props }, ref) {
    return (
      <Icon
        {...props}
        ref={ref}
        iconNode={PROMPT_ICON}
        strokeWidth={strokeWidth}
        aria-hidden="true"
        focusable="false"
      />
    );
  },
);
