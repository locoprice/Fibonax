import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  createAtlasRenderer,
  readAtlasPalette,
  type AtlasHit,
  type AtlasRenderer,
  type AtlasTarget,
} from '@/features/memory/atlas/atlasDraw';
import { MAX_BRAINS, pickBrains, type AtlasBrainInput } from '@/features/memory/atlas/atlasOrbits';
import { cn } from '@/lib/utils';

// The Brain Atlas: the Brains circling the Fibonax hub like planets, inside a
// brain seen from the front, with a panel beside it that says what is in view.
// It takes the place of the Brain cards while the Atlas button is on.
//
// The canvas is a picture of what the panel lists, so everything it shows can
// be reached without a pointer: the panel's rows are buttons.
//
// Names and descriptions are what a person wrote, so each carries
// translate="no" (Dashboard Language, in the root CLAUDE.md).

/** Items listed for a Brain before "and N more". */
const ITEMS_LISTED = 13;

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--atlas-gold))]';
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-wider text-ink-subtle';

const countItems = (count: number): string => `${count} ${count === 1 ? 'item' : 'items'}`;
const countBrains = (count: number): string => `${count} ${count === 1 ? 'Brain' : 'Brains'}`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function sameTarget(a: AtlasTarget | null, b: AtlasTarget | null): boolean {
  if (!a || !b) return a === b;
  if (a.type === 'hub' || b.type === 'hub') return a.type === b.type;
  if (a.type === 'brain' && b.type === 'brain') return a.id === b.id;
  if (a.type === 'item' && b.type === 'item') return a.brainId === b.brainId && a.index === b.index;
  return false;
}

function Dot({ tone }: { tone: 'gold' | 'spark' }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        tone === 'gold' ? 'bg-[rgb(var(--atlas-gold))]' : 'bg-[rgb(var(--atlas-spark))]',
      )}
    />
  );
}

function BrainRow({ brain, onOpen }: { brain: AtlasBrainInput; onOpen: () => void }): ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-xs text-ink hover:bg-bg-alt',
          FOCUS_RING,
        )}
      >
        <Dot tone="gold" />
        <span className="min-w-0 flex-1 truncate" translate="no">
          {brain.name}
        </span>
        <span className="shrink-0 tabular-nums text-ink-subtle">{countItems(brain.itemCount)}</span>
      </button>
    </li>
  );
}

function PanelActions({ brainId, onBack }: { brainId?: string; onBack: () => void }): ReactElement {
  return (
    <div className="mt-auto flex flex-wrap gap-2 pt-2">
      {brainId ? (
        <Button asChild size="sm" className={FOCUS_RING}>
          <Link to={`/memory/${brainId}`}>Open Brain</Link>
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" className={FOCUS_RING} onClick={onBack}>
        Back
      </Button>
    </div>
  );
}

interface BrainAtlasProps {
  /** The Brains on the page, with any filter and search already applied. */
  brains: AtlasBrainInput[];
  /** The item names are on their way: the moons are there, their names are not yet. */
  itemsLoading: boolean;
}

export function BrainAtlas({ brains, itemsLoading }: BrainAtlasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AtlasRenderer | null>(null);
  const [selected, setSelected] = useState<AtlasTarget | null>(null);
  const [tip, setTip] = useState<AtlasHit | null>(null);
  // Moving content needs a stop control, and starts still for anyone who asked for less motion.
  const [running, setRunning] = useState(() => !prefersReducedMotion());
  const [unsupported, setUnsupported] = useState(false);

  const { shown, hidden } = useMemo(() => pickBrains(brains), [brains]);
  const totalItems = shown.reduce((sum, brain) => sum + brain.itemCount, 0);

  // The renderer is made once. The effects after it hand over what it draws,
  // and run on mount too, in this order.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const renderer = createAtlasRenderer(canvas, readAtlasPalette(canvas), getComputedStyle(canvas).fontFamily);
    if (!renderer) {
      setUnsupported(true);
      return undefined;
    }
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setBrains(brains);
  }, [brains]);

  useEffect(() => {
    rendererRef.current?.setSelected(selected);
  }, [selected]);

  useEffect(() => {
    rendererRef.current?.setRunning(running);
  }, [running]);

  const brainOf = (target: AtlasTarget | null): AtlasBrainInput | undefined => {
    if (!target || target.type === 'hub') return undefined;
    const id = target.type === 'brain' ? target.id : target.brainId;
    return shown.find((brain) => brain.id === id);
  };

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>): void {
    const hit = rendererRef.current?.hitTest(event.clientX, event.clientY) ?? null;
    rendererRef.current?.setHover(hit?.target ?? null);
    // The orbits hold still under the pointer, so the tooltip only changes with what is pointed at.
    setTip((current) => (sameTarget(current?.target ?? null, hit?.target ?? null) ? current : hit));
  }

  function onPointerLeave(): void {
    rendererRef.current?.setHover(null);
    setTip(null);
  }

  function onCanvasClick(event: { clientX: number; clientY: number }): void {
    setSelected(rendererRef.current?.hitTest(event.clientX, event.clientY)?.target ?? null);
  }

  // Escape puts the panel back on the overview, wherever the focus is: a click
  // on the picture leaves it outside the atlas.
  const hasSelection = selected !== null;
  useEffect(() => {
    if (!hasSelection) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasSelection]);

  const back = (): void => setSelected(null);
  const selectedBrain = brainOf(selected);
  const selectedItem = selected?.type === 'item' ? selectedBrain?.itemNames[selected.index] : undefined;

  const orbitList: ReactNode =
    shown.length > 0 ? (
      <ul className="flex flex-col gap-0.5">
        {shown.map((brain) => (
          <BrainRow key={brain.id} brain={brain} onOpen={() => setSelected({ type: 'brain', id: brain.id })} />
        ))}
      </ul>
    ) : null;

  let panel: ReactNode;
  if (selected?.type === 'brain' && selectedBrain) {
    const more = selectedBrain.itemCount - ITEMS_LISTED;
    panel = (
      <>
        <p className={EYEBROW}>
          Brain · orbit {shown.indexOf(selectedBrain) + 1} of {shown.length}
        </p>
        <h2 className="break-words text-base font-semibold text-ink" translate="no">
          {selectedBrain.name}
        </h2>
        {selectedBrain.description ? (
          <p className="break-words text-xs text-ink-muted" translate="no">
            {selectedBrain.description}
          </p>
        ) : null}
        <p className={EYEBROW}>{countItems(selectedBrain.itemCount)}</p>
        {selectedBrain.itemNames.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {selectedBrain.itemNames.slice(0, ITEMS_LISTED).map((name, index) => (
              <li key={index} className="flex items-baseline gap-2 text-xs text-ink">
                <Dot tone="spark" />
                <span className="min-w-0 break-words" translate="no">
                  {name}
                </span>
              </li>
            ))}
            {more > 0 ? <li className="text-xs text-ink-subtle">and {more} more</li> : null}
          </ul>
        ) : (
          <p className="text-xs text-ink-subtle">
            {itemsLoading && selectedBrain.itemCount > 0 ? 'Loading the items' : 'No items yet'}
          </p>
        )}
        <PanelActions brainId={selectedBrain.id} onBack={back} />
      </>
    );
  } else if (selected?.type === 'item' && selectedBrain && selectedItem !== undefined) {
    panel = (
      <>
        <p className={EYEBROW}>Item</p>
        <h2 className="break-words text-base font-semibold text-ink" translate="no">
          {selectedItem}
        </h2>
        <p className="text-xs text-ink-muted">This item belongs to one Brain and circles it as a moon.</p>
        <p className={EYEBROW}>In</p>
        <ul className="flex flex-col gap-0.5">
          <BrainRow brain={selectedBrain} onOpen={() => setSelected({ type: 'brain', id: selectedBrain.id })} />
        </ul>
        <PanelActions brainId={selectedBrain.id} onBack={back} />
      </>
    );
  } else if (selected?.type === 'hub') {
    panel = (
      <>
        <p className={EYEBROW}>Centre</p>
        <h2 className="text-base font-semibold text-ink" translate="no">
          Fibonax
        </h2>
        <p className="text-xs text-ink-muted">
          The centre every Brain circles, and the point the golden spiral starts from.
        </p>
        <p className={EYEBROW}>In orbit, closest first</p>
        {orbitList}
        <PanelActions onBack={back} />
      </>
    );
  } else {
    panel = (
      <>
        <p className={EYEBROW}>Your Brains</p>
        <h2 className="text-base font-semibold text-ink">Every Brain, in orbit</h2>
        <p className="text-xs text-ink-muted">
          Each Brain circles the Fibonax hub like a planet. The first one you made stays closest, and its items circle
          it as moons. The orbits widen along a golden spiral, the shape behind the Fibonacci numbers 8, 13, 21, 34.
        </p>
        <p className="text-xs tabular-nums text-ink">
          {countBrains(shown.length)} · {countItems(totalItems)}
        </p>
        {hidden > 0 ? (
          <p className="text-xs text-ink-muted">
            The atlas shows the {MAX_BRAINS} Brains you updated last. Search or filter to see the others.
          </p>
        ) : null}
        <p className={EYEBROW}>In orbit, closest first</p>
        {orbitList}
      </>
    );
  }

  const tipBrain = brainOf(tip?.target ?? null);
  const tipName =
    tip?.target.type === 'hub'
      ? 'Fibonax'
      : tip?.target.type === 'item'
        ? tipBrain?.itemNames[tip.target.index]
        : tipBrain?.name;
  const tipDetail =
    tip?.target.type === 'hub' ? 'centre' : tip?.target.type === 'item' ? 'item' : countItems(tipBrain?.itemCount ?? 0);

  const picture =
    shown.length > 0
      ? `The first Brain made is closest: ${shown.map((brain) => brain.name).join(', ')}.`
      : 'No Brains are in orbit.';

  return (
    <section
      data-surface="night"
      aria-label="Brain Atlas"
      className="brain-atlas grid h-[clamp(440px,calc(100vh-290px),987px)] min-w-0 grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)] overflow-hidden rounded-[16px] border border-line text-ink"
    >
      <div className="relative min-w-0 overflow-hidden">
        {/* Out of the flow on purpose: the canvas's pixel size must never feed back into the height of the stage. */}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`A head seen from the front, with the brain drawn as a glowing mesh. The Fibonax hub sits at its centre like a sun, and each Brain circles it like a planet, its items as moons. ${picture} The list beside the picture names every Brain.`}
          className="absolute inset-0 block h-full w-full font-mono"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onClick={onCanvasClick}
        />
        {unsupported ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-ink-muted">
            This browser cannot draw the atlas. Switch Atlas off to see your Brains as cards.
          </p>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className={cn('absolute right-3 top-3 bg-card', FOCUS_RING)}
              aria-label={running ? 'Pause the orbits' : 'Play the orbits'}
              onClick={() => setRunning((on) => !on)}
            >
              {running ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
              {running ? 'Pause' : 'Play'}
            </Button>
            <p className="pointer-events-none absolute bottom-3 left-3 right-3 text-[11px] text-ink-subtle">
              Point at a Brain to hold it still. Click it to see what is inside.
            </p>
          </>
        )}
        {tip && tipName !== undefined ? (
          <div
            className="pointer-events-none absolute z-10 flex max-w-[232px] -translate-x-1/2 -translate-y-[calc(100%+14px)] items-baseline gap-1.5 rounded-[6px] border border-line bg-card px-2 py-1 text-[11px] text-ink"
            style={{ left: `clamp(120px, ${tip.x}px, calc(100% - 120px))`, top: tip.y }}
          >
            <span className="min-w-0 truncate" translate="no">
              {tipName}
            </span>
            <span className="shrink-0 text-ink-subtle">{tipDetail}</span>
          </div>
        ) : null}
      </div>

      <aside aria-live="polite" className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto border-l border-line bg-card p-5">
        {panel}
      </aside>
    </section>
  );
}
