import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { fillFormApi, loadFillFormEngine } from '@/lib/fillFormEngine';

/**
 * An email layout as it will look, drawn in a frame of its own. The frame may
 * read nothing of the page and run nothing: no scripts are allowed in it, and
 * same origin is granted only so its height can be read. Layouts come from
 * teammates too (docs/FORMATTED_SNIPPETS_DESIGN.md, 2.4). The document it shows
 * is the one every preview frame shows, in the popup, the overlay and on the
 * phone: `layoutDocument` in extension/shared/fill-form.js.
 */
export function LayoutFrame({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(80);
  const [api, setApi] = useState(() => fillFormApi());

  useEffect(() => {
    if (api) return;
    let cancelled = false;
    loadFillFormEngine()
      .then((loaded) => {
        if (!cancelled) setApi(loaded);
      })
      .catch((error: unknown) => {
        console.error('The layout frame could not load the preview engine', error);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const doc = useMemo(() => (api ? api.layoutDocument(html) : ''), [api, html]);

  function measure() {
    const inner = ref.current?.contentDocument;
    if (!inner) return;
    setHeight(Math.min(Math.max(inner.documentElement.scrollHeight, 40), 2400));
  }

  if (!api) {
    return <div className={cn('block w-full rounded-[8px] bg-white', className)} style={{ height }} aria-hidden />;
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
