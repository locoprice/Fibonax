import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * An email layout as it will look, drawn in a frame of its own. The frame may
 * read nothing of the page and run nothing: no scripts are allowed in it, and
 * same origin is granted only so its height can be read. Layouts come from
 * teammates too (docs/FORMATTED_SNIPPETS_DESIGN.md, 2.4).
 */
export function LayoutFrame({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(80);
  const doc = useMemo(
    () =>
      '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'html,body{margin:0;padding:0}' +
      'body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;background:#fff;padding:8px}' +
      'img{max-width:100%}' +
      '</style></head><body>' +
      html +
      '</body></html>',
    [html],
  );

  function measure() {
    const inner = ref.current?.contentDocument;
    if (!inner) return;
    setHeight(Math.min(Math.max(inner.documentElement.scrollHeight, 40), 2400));
  }

  return (
    <iframe
      ref={ref}
      title="Layout"
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      onLoad={measure}
      style={{ height }}
      className={cn('block w-full rounded-[8px] border-0 bg-white', className)}
    />
  );
}
