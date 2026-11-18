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
 *
 * With `fitWidth` the layout is drawn that many pixels wide and shrunk to the
 * room it has, so a narrow panel shows the whole email instead of its left edge.
 */
export function LayoutFrame({ html, className, fitWidth }: { html: string; className?: string; fitWidth?: number }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(80);
  const [room, setRoom] = useState(0);
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

  useEffect(() => {
    const box = boxRef.current;
    if (!fitWidth || !box) return;
    const observer = new ResizeObserver(() => setRoom(box.clientWidth));
    observer.observe(box);
    setRoom(box.clientWidth);
    return () => observer.disconnect();
  }, [fitWidth, api]);

  const doc = useMemo(() => (api ? api.layoutDocument(html) : ''), [api, html]);

  function measure() {
    const inner = ref.current?.contentDocument;
    if (!inner) return;
    setHeight(Math.min(Math.max(inner.documentElement.scrollHeight, 40), 2400));
  }

  if (!api) {
    return <div className={cn('block w-full rounded-[8px] bg-white', className)} style={{ height }} aria-hidden />;
  }

  const frame = (
    <iframe
      ref={ref}
      title="Layout"
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      onLoad={measure}
      style={fitWidth ? { height, width: fitWidth, transform: `scale(${scaleOf(room, fitWidth)})`, transformOrigin: 'top left' } : { height }}
      className={cn('block rounded-[8px] border-0 bg-white', !fitWidth && 'w-full', className)}
    />
  );
  if (!fitWidth) return frame;
  return (
    <div ref={boxRef} className="w-full overflow-hidden" style={{ height: height * scaleOf(room, fitWidth) }}>
      {frame}
    </div>
  );
}

/** How much a layout drawn `width` wide shrinks to fit `room`. Never enlarged. */
function scaleOf(room: number, width: number): number {
  return room > 0 ? Math.min(1, room / width) : 1;
}
