import { BrainIcon } from '@/components/shared/BrainIcon';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Check, CheckCheck, FileText, Mail, Pause, Play, Sparkles } from 'lucide-react';
import { SnippetIcon } from '@/components/shared/SnippetIcon';
import { PromptIcon } from '@/components/shared/PromptIcon';
import { cn } from '@/lib/utils';

const SCENES = [
  { name: 'Snippets', icon: SnippetIcon, description: 'The shortcut ::followup expands into a complete follow-up message.' },
  { name: 'Prompts', icon: PromptIcon, description: 'Role, objective and constraints build a reusable prompt.' },
  { name: 'Brains', icon: BrainIcon, description: 'Two notes from a Brain are selected and inserted above an AI message, ready to review.' },
] as const;

const LAST_FRAME = 90;
const RESULT_FRAME = 65;
const REVEAL = 'transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none';

function Reveal({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return <div className={cn(REVEAL, show ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0', className)}>{children}</div>;
}

function SnippetScene({ frame }: { frame: number }) {
  const expanded = frame >= 35;
  const shortcut = '::followup'.slice(0, Math.max(0, Math.floor((frame - 6) / 2)));
  return (
    <div className="relative h-full">
      <div className="flex items-center gap-2 border-b border-line pb-3 text-xs text-ink-muted">
        <span>To</span><span className="rounded-md bg-bg-alt px-2 py-1 text-ink">Alex</span>
        <span className="ml-auto">Project update</span>
      </div>
      <div className="relative mt-4 min-h-32 text-[13px] leading-relaxed">
        <div className={cn('absolute inset-x-0 top-0 font-mono text-primary', REVEAL, expanded ? '-translate-y-2 opacity-0' : 'translate-y-0 opacity-100')}>
          {shortcut}<span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-primary" />
          <Reveal show={frame >= 24 && !expanded} className="mt-3 flex items-center gap-2 rounded-[10px] border border-line bg-card p-3 font-sans text-xs shadow-sm">
            <SnippetIcon className="h-4 w-4" /><span className="font-medium text-ink">Follow-up</span><span className="ml-auto text-ink-muted">↵</span>
          </Reveal>
        </div>
        <Reveal show={expanded} className="space-y-3 text-ink">
          <p>Hi Alex,</p>
          <p>The first draft is ready for your review.</p>
          <p>Let me know what you think.</p>
        </Reveal>
      </div>
    </div>
  );
}

const PROMPT_BLOCKS = [
  { label: 'Role', text: 'You are my project assistant.', start: 8 },
  { label: 'Objective', text: 'Turn my notes into a clear project brief.', start: 21 },
  { label: 'Constraints', text: 'Keep it concise. End with next steps.', start: 36 },
] as const;

function PromptScene({ frame }: { frame: number }) {
  return (
    <div className="space-y-1.5">
      {PROMPT_BLOCKS.map(({ label, text, start }) => (
        <div key={label} className={cn('rounded-[10px] border p-2', frame >= start ? 'border-primary/20 bg-primary-light' : 'border-line bg-bg')}>
          <div className="flex items-center gap-2 text-[11px] leading-4 font-medium text-primary">
            <span className="h-1 w-1 rounded-full bg-primary" />{label}
            <Check className={cn('ml-auto h-3 w-3', REVEAL, frame >= start + 10 ? 'opacity-100' : 'opacity-0')} />
          </div>
          <div className="mt-1 min-h-4 text-xs leading-4 text-ink">
            {text.slice(0, Math.max(0, (frame - start) * 4))}
            {frame >= start && frame < start + 10 && <span className="ml-0.5 inline-block h-3 w-px bg-primary" />}
          </div>
        </div>
      ))}
    </div>
  );
}

function BrainScene({ frame }: { frame: number }) {
  const inserted = frame >= 44;
  return (
    <div className="relative h-full text-xs">
      <div className={cn('absolute inset-x-0 top-0', REVEAL, inserted ? '-translate-y-2 opacity-0' : 'translate-y-0 opacity-100')}>
        <div className="mb-3 flex items-center justify-between"><span className="font-medium text-ink">Add context</span><span className="text-ink-muted">Project Brain</span></div>
        {['Project brief', 'Writing style'].map((note, index) => (
          <div key={note} className="flex items-center gap-3 border-t border-line py-3 text-ink">
            <FileText className="h-4 w-4 text-ink-muted" /><span>{note}</span>
            <span className={cn('ml-auto flex h-4 w-4 items-center justify-center rounded border', frame >= 12 + index * 12 ? 'border-primary bg-primary text-white' : 'border-line')}>
              {frame >= 12 + index * 12 && <Check className="h-3 w-3" />}
            </span>
          </div>
        ))}
        <div className="mt-2 flex justify-end"><span className={cn('flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-white', REVEAL, frame >= 32 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0')}>Insert 2 <ArrowDown className="h-3 w-3" /></span></div>
      </div>
      <Reveal show={inserted}>
        <div className="rounded-[10px] border border-primary/20 bg-primary-light p-3">
          <div className="mb-2 flex items-center gap-2 font-medium text-primary"><BrainIcon className="h-3.5 w-3.5" />Context from Project Brain</div>
          <p className="leading-relaxed text-ink">Project brief: launch the new website.</p>
          <p className="mt-1 leading-relaxed text-ink">Writing style: clear, friendly, concise.</p>
        </div>
        <p className="mt-4 leading-relaxed text-ink">Help me plan the next steps.</p>
        <p className="mt-3 text-[11px] text-ink-muted">Ready for you to review and send.</p>
      </Reveal>
    </div>
  );
}

/** A local, illustrative sequence. Never reads account data or calls an AI. */
export function AuthProductDemo() {
  const root = useRef<HTMLDivElement>(null);
  const [timeline, setTimeline] = useState({ scene: 0, frame: 0 });
  const [paused, setPaused] = useState(false);
  const [loop, setLoop] = useState(true);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = window.matchMedia('(min-width: 1024px)');
    let intersecting = false;
    const updateVisibility = () => setVisible(intersecting && desktop.matches && !document.hidden);
    const updateMotion = () => setReduced(motion.matches);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      updateVisibility();
    });
    if (root.current) observer.observe(root.current);
    motion.addEventListener('change', updateMotion);
    desktop.addEventListener('change', updateVisibility);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', updateMotion);
      desktop.removeEventListener('change', updateVisibility);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  const ended = !loop && timeline.frame >= LAST_FRAME;
  const running = !paused && !reduced && visible && !ended;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setTimeline(current => current.frame >= LAST_FRAME
        ? { scene: (current.scene + 1) % SCENES.length, frame: 0 }
        : { ...current, frame: current.frame + 1 });
    }, 100);
    return () => window.clearInterval(timer);
  }, [running]);

  const scene = SCENES[timeline.scene] ?? SCENES[0];
  const frame = reduced ? RESULT_FRAME : timeline.frame;
  const complete = frame >= (timeline.scene === 0 ? 35 : timeline.scene === 1 ? 50 : 44);
  const SceneIcon = timeline.scene === 0 ? Mail : scene.icon;
  const title = ['New message', 'Project brief', 'Your next AI conversation'][timeline.scene];
  const status = complete
    ? ['Text expanded', 'Prompt ready to save', 'Context inserted'][timeline.scene]
    : ['Typing a shortcut', 'Building your prompt', 'Choosing your context'][timeline.scene];

  function selectScene(index: number) {
    setTimeline({ scene: index, frame: paused || reduced ? RESULT_FRAME : 0 });
    setLoop(false);
  }

  function togglePlayback() {
    if (ended) {
      setTimeline(current => ({ ...current, frame: 0 }));
      setLoop(true);
      setPaused(false);
    } else {
      setPaused(current => !current);
    }
  }

  return (
    <div ref={root} className="relative w-full" role="region" aria-label="Fibonax product demo">
      <div className="mb-6 flex items-center gap-3 pb-2">
        <div className="flex min-w-0 flex-1 gap-2 rounded-[12px] border border-white/20 bg-white/10 p-2" role="group" aria-label="Choose a demo">
          {SCENES.map(({ name, icon: Icon }, index) => (
            <button key={name} type="button" aria-pressed={timeline.scene === index} onClick={() => selectScene(index)} className={cn('flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary motion-reduce:transition-none', timeline.scene === index ? 'bg-white text-primary shadow-sm' : 'text-white/85 hover:bg-white/10 hover:text-white')}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />{name}
            </button>
          ))}
        </div>
        {!reduced && <button type="button" onClick={togglePlayback} aria-label={paused || ended ? 'Play animation' : 'Pause animation'} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/20 text-white/85 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white">
          {paused || ended ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
        </button>}
      </div>

      <div className="relative isolate" data-theme="light">
        <div aria-hidden="true" className="pointer-events-none absolute -inset-x-2 inset-y-3 -z-10 rotate-[-3deg] rounded-[16px] border border-white/20 bg-white/10" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 -inset-y-2 -z-10 rotate-[2deg] rounded-[16px] border border-white/20 bg-white/10" />
        <div className="overflow-hidden rounded-[16px] border border-white/60 bg-card shadow-md">
          <div aria-hidden="true" className="flex items-center gap-2 border-b border-line bg-bg px-4 py-3">
            <SceneIcon className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-ink">{title}</span>
            <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-ink-muted">Demo</span>
          </div>
          <div className="h-52 p-4" aria-hidden="true">
            {timeline.scene === 0 && <SnippetScene frame={frame} />}
            {timeline.scene === 1 && <PromptScene frame={frame} />}
            {timeline.scene === 2 && <BrainScene frame={frame} />}
          </div>
          <div aria-hidden="true" className="relative flex min-h-11 items-center gap-2 overflow-hidden border-t border-line bg-bg px-4 py-3 text-[11px] text-ink-muted">
            {complete ? <CheckCheck className="h-3.5 w-3.5 text-primary" /> : <Sparkles className="h-3.5 w-3.5 text-primary" />}
            <span>{status}</span><span className="ml-auto font-mono text-[10px]">0{timeline.scene + 1} / 03</span>
            <div className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary/40 motion-reduce:hidden" style={{ transform: `scaleX(${frame / LAST_FRAME})` }} />
          </div>
        </div>
      </div>
      <p className="sr-only">{scene.description}</p>
    </div>
  );
}
