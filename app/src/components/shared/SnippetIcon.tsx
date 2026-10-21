import { forwardRef } from 'react';
import { Icon, type IconNode, type LucideIcon, type LucideProps } from 'lucide-react';

// The approved Snippets mark, shared by every dashboard representation.
// Keep this path aligned with the landing, mobile and extension glyphs.
const SNIPPET_ICON: IconNode = [
  ['path', {
    d: 'M7 3H5a2 2 0 0 0-2 2v2m14-4h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6',
    key: 'snippet',
  }],
];

export const SnippetIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(
  function SnippetIcon({ strokeWidth = 1.8, ...props }, ref) {
    return (
      <Icon
        {...props}
        ref={ref}
        iconNode={SNIPPET_ICON}
        strokeWidth={strokeWidth}
        aria-hidden="true"
        focusable="false"
      />
    );
  },
);
