import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import {
  AlertCircle,
  BookOpen,
  Clock,
  Eye,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquareText,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { HistoryPanel, type HistoryEntry } from '@/features/history/HistoryPanel';
import { useUiStore } from '@/stores/uiStore';
import { useLabelStore } from '@/stores/labelStore';
import { usePromptStore } from '@/stores/promptStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { DEFAULT_TRIGGER_CONFIG, sanitizeTriggerInput } from '@/lib/triggerUtils';
import { classifyPrompt } from '@/lib/intentEngine';
import { assembleBlocks, foldReasoningIntoConstraints } from '@/lib/promptUtils';
import { labelBrainTokens } from '@/lib/promptBrain';
import { loadInteractiveSteps, saveInteractiveSteps } from '@/lib/interactiveSteps';
import {
  usePromptEvaluator,
  evaluatePrompt,
  promptToEvaluatorInput,
  percentRank,
  selectBenchmarkCohort,
} from '@/lib/usePromptEvaluator';
import { cn } from '@/lib/utils';
import { PromptEfficiencyWidget } from '@/features/prompts/PromptEfficiencyWidget';
import { PanelDisclosure } from '@/features/prompts/PanelDisclosure';
import { LabelPicker } from '@/features/labels/LabelPicker';
import { AssetAboutButton } from '@/components/shared/AssetAboutButton';
import { BrainIcon } from '@/components/shared/BrainIcon';
import { TeamLastUseLine } from '@/components/shared/TeamLastUseLine';
import { ReviewStatusMenu } from '@/components/shared/ReviewStatusMenu';
import {
  DraftFromTextButton,
  DraftNotice,
  type DraftNoticeState,
} from '@/components/shared/DraftWithAi';
import {
  idByName,
  idsByName,
  promptDraftBlocks,
  uniqueToken,
  type DraftResult,
} from '@/lib/aiDraft';
import { findSimilar, promptCandidates } from '@/lib/draftSimilar';
import { useDraftStore } from '@/stores/draftStore';
import { useReviewApprover } from '@/lib/useReviewApprover';
import type {
  PromptBlock,
  PromptBlockType,
  PromptBrainRef,
  StrategyType,
  ThinkingMode,
  PreferredModel,
  ComplexityLevel,
  IntentCategory,
  OutputType,
} from '@/types/database';
import type { PromptFormValues } from '@/types/schemas';
import type { ClassificationResult } from '@/lib/intentEngine';
import { nameFromEvent, sanitizeName } from '@/lib/nameText';

// ── Constants ─────────────────────────────────────────────────────────────────

const BLOCK_ORDER: PromptBlockType[] = [
  'role', 'objective', 'context', 'examples', 'constraints',
];

/** The four parts a prompt may add. The task (objective) is always on. */
type OptionalPart = Exclude<PromptBlockType, 'objective'>;

interface PartSpec {
  type: OptionalPart;
  title: string;
  /** What the part is for, on its Add row. */
  summary: string;
  placeholder: string;
  icon: LucideIcon;
}

// The order the prompt is written in, without the task, which sits above them.
// The saved text keeps its ## Role / ## Context headings: these are the words
// a person reads, not what the AI receives.
const PARTS: PartSpec[] = [
  {
    type: 'role',
    title: 'Who the AI is',
    summary: 'A role, like an experienced editor',
    placeholder: 'You are an experienced customer support specialist.',
    icon: UserRound,
  },
  {
    type: 'context',
    title: 'Background',
    summary: 'What it should know. You can attach a Brain',
    placeholder: 'The customer has written twice this week. They want a clear answer and a next step.',
    icon: BookOpen,
  },
  {
    type: 'examples',
    title: 'An example',
    summary: 'Show what a good answer looks like',
    placeholder: 'Hi Sam, thanks for telling us. I have fixed it today and will call you on Friday to check.',
    icon: MessageSquareText,
  },
  {
    type: 'constraints',
    title: 'Rules',
    summary: 'Length, tone, what to avoid',
    placeholder: 'Keep it under 100 words. Be warm, not formal. No jargon.',
    icon: ListChecks,
  },
];

const TASK_PLACEHOLDER = 'Write a short, friendly reply to a customer who is unhappy with our service.';

const DEFAULT_BLOCKS: PromptBlock[] = [
  { type: 'role', content: '', enabled: false },
  { type: 'objective', content: '', enabled: true },
  { type: 'context', content: '', enabled: false },
  { type: 'examples', content: '', enabled: false },
  { type: 'constraints', content: '', enabled: false },
];

// The saved values stay the short names the cards, filters and other surfaces
// show; the menu adds what each one means.
const STRATEGY_OPTIONS: { value: StrategyType; label: string }[] = [
  { value: 'CoT', label: 'CoT · think step by step' },
  { value: 'ToT', label: 'ToT · compare several ideas' },
  { value: 'Few-shot', label: 'Few-shot · learn from examples' },
  { value: 'One-shot', label: 'One-shot · learn from one example' },
  { value: 'RAG', label: 'RAG · answer from your material' },
  { value: 'Agentic', label: 'Agentic · plan and act alone' },
];
const INTENT_CATEGORIES: IntentCategory[] = ['Writing', 'Coding', 'Support', 'SEO', 'Analysis', 'Planning', 'Research', 'Teaching'];
const OUTPUT_OPTIONS: { value: OutputType; label: string }[] = [
  { value: 'Plain', label: 'Plain · simple text' },
  { value: 'Markdown', label: 'Markdown · formatted text' },
  { value: 'JSON', label: 'JSON · data' },
  { value: 'SOP', label: 'SOP · step-by-step guide' },
];

// Block types that map to EvalCriterion IDs for the quality score.
const BLOCK_CRITERION_TYPES: PromptBlockType[] = [
  'role', 'objective', 'context', 'constraints', 'examples',
];

// One-click sample that scores highly: lets a new user see what "good" looks
// like before writing their own.
interface ExamplePrompt {
  name: string;
  blocks: PromptBlock[];
  strategyType: StrategyType;
  preferredModel: PreferredModel;
  outputType: OutputType;
  intentCategory: IntentCategory;
}

const EXAMPLE_PROMPT: ExamplePrompt = {
  name: 'Product announcement email',
  blocks: [
    { type: 'role', content: 'You are a senior B2B copywriter with deep SaaS experience.', enabled: true },
    { type: 'objective', content: 'Write a 150-word product announcement email for the new analytics feature.', enabled: true },
    { type: 'context', content: 'The audience is existing Pro-plan customers; the tone is friendly but concise.', enabled: true },
    { type: 'examples', content: 'Input: "new dashboard" → Output: "Meet your new dashboard…"', enabled: true },
    { type: 'constraints', content: 'Keep it under 150 words. Do not use jargon. Avoid emojis. Double-check the result before producing the final copy.', enabled: true },
  ],
  strategyType: 'One-shot',
  preferredModel: 'claude-sonnet-4-6',
  outputType: 'Markdown',
  intentCategory: 'Writing',
};

// A draft from the AI, or the example, writes the five blocks' text. The Brain
// a switched-on Context block carries is a choice, not text, so it stays, and
// the block stays on. A Brain on a switched-off block stays off.
function withBrainKept(next: PromptBlock[], prev: PromptBlock[]): PromptBlock[] {
  const context = prev.find((b) => b.type === 'context');
  if (!context?.enabled || !context.brain) return next;
  const brain = context.brain;
  return next.map((b) => (b.type === 'context' ? { ...b, brain, enabled: true } : b));
}

// What the panel works on. The task box is always on screen, so what it holds
// is always in the prompt: it is switched on. A part missing from what was
// opened is added, off and empty, so typing in it lands somewhere.
function readyBlocks(blocks: PromptBlock[]): PromptBlock[] {
  const ready = blocks.map((b) => (b.type === 'objective' && !b.enabled ? { ...b, enabled: true } : b));
  for (const type of BLOCK_ORDER) {
    if (!ready.some((b) => b.type === type)) {
      ready.push({ type, content: '', enabled: type === 'objective' });
    }
  }
  return ready;
}

// ── Shared field styles ──────────────────────────────────────────────────────

const FIELD_LABEL = 'mb-1.5 block text-[13px] font-semibold text-ink';
const OPTIONAL = 'font-normal text-ink-subtle';
const HINT = 'mt-1.5 block text-xs leading-relaxed text-ink-muted';
const SELECT_CLASS =
  'h-10 w-full rounded-[12px] border border-line bg-card px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50';
const CHIP_BUTTON =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-line bg-card px-2.5 text-xs font-medium text-ink-muted transition-colors hover:border-primary/30 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

// ── Text box that grows with its text ────────────────────────────────────────

type AutoGrowTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

// Grows instead of scrolling inside the panel, so the whole text is always in view.
function AutoGrowTextarea({ value, onChange, className, ...rest }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      className={cn(
        'block w-full resize-none overflow-hidden rounded-[12px] border border-line bg-card px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
        className,
      )}
      {...rest}
    />
  );
}

// ── One optional part ────────────────────────────────────────────────────────

interface PartSectionProps {
  spec: PartSpec;
  block: PromptBlock;
  /** Where the cursor goes when this part has just been added or removed. */
  focus: 'box' | 'row' | null;
  onAdd: () => void;
  onRemove: () => void;
  onChange: (content: string) => void;
  /** Controls a part carries under its text while it is added. */
  children?: ReactNode;
}

// Off, a part is one row that adds it. On, it is its text box with Remove.
// Remove takes the part out of the prompt and keeps its text in the editor, so
// adding it again brings the text back.
function PartSection({ spec, block, focus, onAdd, onRemove, onChange, children }: PartSectionProps) {
  const Icon = spec.icon;
  const boxId = `prompt-part-${spec.type}`;

  if (!block.enabled) {
    return (
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${spec.title}`}
        aria-describedby={`${boxId}-summary`}
        autoFocus={focus === 'row'}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-[10px] px-2 py-2.5 text-left transition-colors hover:bg-bg-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Icon className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">{spec.title}</span>
          <span id={`${boxId}-summary`} className="block text-xs text-ink-muted">{spec.summary}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-primary" aria-hidden>
          <Plus className="h-3.5 w-3.5" />
          Add
        </span>
      </button>
    );
  }

  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
        <label htmlFor={boxId} className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
          {spec.title}
        </label>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${spec.title}`}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-bg-alt hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Remove
        </button>
      </div>
      <AutoGrowTextarea
        id={boxId}
        value={block.content}
        onChange={onChange}
        placeholder={spec.placeholder}
        autoFocus={focus === 'box'}
      />
      {children}
    </div>
  );
}

// ── An on/off setting ────────────────────────────────────────────────────────

interface SettingRowProps {
  id: string;
  title: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function SettingRow({ id, title, hint, checked, onChange }: SettingRowProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm text-ink">
          {title}
        </label>
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-ink-muted">
          {hint}
        </p>
      </div>
      <Switch id={id} checked={checked} onChange={onChange} aria-describedby={`${id}-hint`} className="mt-0.5" />
    </div>
  );
}

// ── Brain picker ───────────────────────────────────────────────────────────────

interface BrainPickerProps {
  value: PromptBrainRef | null;
  onChange: (brain: PromptBrainRef | null) => void;
}

/** "Empty", "1 item", "12 items": the Brains page's own words for a Brain's size. */
function describeItems(count: number): string {
  return count === 0 ? 'Empty' : `${count} item${count === 1 ? '' : 's'}`;
}

// The Brain a Background part carries (lib/promptBrain.ts). One menu listing
// every live Brain with how much is in it. A Brain the list does not hold (in
// the trash, or another person's behind a shared prompt) stays in the menu by
// name, so the choice is visible and can be changed or cleared rather than
// vanishing.
function BrainPicker({ value, onChange }: BrainPickerProps) {
  const spaces = useMemoryStore((s) => s.spaces);
  const totals = useMemoryStore((s) => s.totals);
  const loaded = useMemoryStore((s) => s.loaded);
  const loading = useMemoryStore((s) => s.loadingSpaces);
  const storeError = useMemoryStore((s) => s.error);
  const loadSpaces = useMemoryStore((s) => s.loadSpaces);
  // The list never arrived. The store keeps one error for every Brain read, so
  // it only counts here while the list is still missing.
  const failed = !loaded && !loading && storeError !== null;

  const known = value ? (spaces.find((space) => space.id === value.id) ?? null) : null;
  const options = spaces.map((space) => ({
    value: space.id,
    label: `${space.name} · ${describeItems(totals.get(space.id)?.items ?? 0)}`,
  }));
  if (value && !known) {
    // Named as missing only once the list is in: until then it is simply the saved choice.
    options.unshift({ value: value.id, label: loaded ? `${value.name || 'Brain'} · not available` : value.name || 'Brain' });
  }
  const unavailable = value !== null && loaded && !known;

  let hint: ReactNode;
  if (failed) {
    hint = 'Your Brains could not be loaded. Check your connection.';
  } else if (!loaded) {
    hint = 'Loading your Brains…';
  } else if (unavailable) {
    hint = "This Brain isn't available. It may be in the trash, or it belongs to the person who wrote the prompt. Pick another, or choose None.";
  } else if (value) {
    hint = (
      <>
        Everything in<span translate="no"> “{known?.name ?? value.name}” </span>goes into the prompt each time you use
        it, as it is that day.
      </>
    );
  } else if (spaces.length === 0) {
    hint = 'No Brains yet. Create one on the Brains page, then pick it here.';
  } else {
    hint = 'Pick a Brain and everything in it goes into the prompt each time you use it, always up to date.';
  }

  return (
    <div className="mt-3">
      <label htmlFor="prompt-brain" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        <BrainIcon className="h-3.5 w-3.5" aria-hidden />
        Brain
      </label>
      <select
        id="prompt-brain"
        value={value?.id ?? ''}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) {
            onChange(null);
            return;
          }
          const space = spaces.find((candidate) => candidate.id === id);
          onChange(space ? { id: space.id, name: space.name } : value);
        }}
        aria-describedby="prompt-brain-hint"
        className={SELECT_CLASS}
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.value} value={option.value} translate="no">
            {option.label}
          </option>
        ))}
      </select>
      <p id="prompt-brain-hint" className={HINT} role={failed ? 'alert' : undefined}>
        {hint}
        {failed && (
          <>
            {' '}
            <button
              type="button"
              onClick={() => void loadSpaces()}
              className="font-medium text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Try again
            </button>
          </>
        )}
      </p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PromptBlockEditor() {
  const newOpen = useUiStore((s) => s.newPromptOpen);
  const editId = useUiStore((s) => s.editPromptId);
  const closeNew = useUiStore((s) => s.closeNewPrompt);
  const closeEdit = useUiStore((s) => s.closeEditPrompt);
  const openEdit = useUiStore((s) => s.openEditPrompt);
  const openPromptPreview = useUiStore((s) => s.openPromptPreview);
  const openPromptDraftPreview = useUiStore((s) => s.openPromptDraftPreview);
  const showToast = useUiStore((s) => s.showToast);

  const prompts = usePromptStore((s) => s.prompts);
  const folders = usePromptStore((s) => s.folders);
  const addPrompt = usePromptStore((s) => s.addPrompt);
  const setReviewStatus = usePromptStore((s) => s.setReviewStatus);
  const isApprover = useReviewApprover();
  const editPromptWithVersion = usePromptStore((s) => s.editPromptWithVersion);
  const versions = usePromptStore((s) => s.versions);
  const versionsLoading = usePromptStore((s) => s.versionsLoading);
  const loadPromptVersions = usePromptStore((s) => s.loadPromptVersions);
  const restorePromptVersion = usePromptStore((s) => s.restorePromptVersion);
  const [historyOpen, setHistoryOpen] = useState(false);
  const setPromptLabels = useLabelStore((s) => s.setPromptLabels);
  const labels = useLabelStore((s) => s.labels);
  const removePrompt = usePromptStore((s) => s.removePrompt);

  // The prompt trigger is a user setting (single source of truth: user_metadata,
  // loaded into the settings store). Never hardcode it: the extension reads the
  // same value, so the hint must reflect whatever the user configured.
  const promptTrigger =
    useSettingsStore((s) => s.profile?.trigger_prompt_seq) || DEFAULT_TRIGGER_CONFIG.promptTrigger;

  const editingPrompt = useMemo(
    () => (editId ? (prompts.find((p) => p.id === editId) ?? null) : null),
    [editId, prompts],
  );
  const mode: 'create' | 'edit' = editingPrompt ? 'edit' : 'create';
  const isOpen = mode === 'edit' ? editingPrompt !== null : newOpen;

  // Form state
  const [name, setName] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [blocks, setBlocks] = useState<PromptBlock[]>(DEFAULT_BLOCKS);
  const [strategyType, setStrategyType] = useState<StrategyType | null>(null);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode | null>(null);
  const [preferredModel, setPreferredModel] = useState<PreferredModel | null>(null);
  const [complexityLevel, setComplexityLevel] = useState<ComplexityLevel | null>(null);
  const [intentCategory, setIntentCategory] = useState<IntentCategory | null>(null);
  const [outputType, setOutputType] = useState<OutputType | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  // Labels are an association, not prompt content: they save alongside the
  // prompt rather than travelling through PromptFormValues.
  const [labelIds, setLabelIds] = useState<string[]>([]);
  // "Ask me questions first" starts on for a new prompt; an existing prompt
  // shows what it was saved with.
  const [askUserQuestions, setAskUserQuestions] = useState(true);
  // "Interactive Steps" is not saved with the prompt: it is one setting for
  // every prompt copied in this browser (lib/interactiveSteps).
  const [interactiveSteps, setInteractiveSteps] = useState(false);

  // Intent suggestion
  const [suggestion, setSuggestion] = useState<ClassificationResult | null>(null);
  const classifyTimer = useRef<number | null>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  // The part just added or removed, so the cursor lands on its box or its row.
  const [focusPart, setFocusPart] = useState<{ type: OptionalPart; on: 'box' | 'row' } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Draft with AI: what the notice says, and whether a new prompt came from a
  // draft, in which case it is saved as AI generated rather than approved.
  const [draftNotice, setDraftNotice] = useState<DraftNoticeState | null>(null);
  const [aiDrafted, setAiDrafted] = useState(false);

  // Sync form when a different prompt opens. Keyed on its id rather than the row
  // object: a change made while the editor is open (the review status menu
  // patches the row in the store) must not wipe text that is still unsaved.
  const editingPromptRef = useRef(editingPrompt);
  editingPromptRef.current = editingPrompt;
  const editingPromptId = editingPrompt?.id ?? null;

  useEffect(() => {
    if (!isOpen) return;
    // The Background part offers the Brains; they are not loaded on this page
    // otherwise. The store's own guard makes a repeat call harmless.
    if (!useMemoryStore.getState().loaded) void useMemoryStore.getState().loadSpaces();
    const editingPrompt = editingPromptRef.current;
    setSubmitError(null);
    setNameError(null);
    setShortcutError(null);
    setConfirmDelete(false);
    setSuggestion(null);
    setDraftNotice(null);
    setAiDrafted(false);
    setFocusPart(null);
    // The panel stays on the page between prompts, scrolled where the last one
    // was left. Each prompt starts at its name.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    if (editingPrompt) {
      setName(editingPrompt.name);
      setShortcut(editingPrompt.shortcut ?? '');
      setBlocks(
        readyBlocks(
          editingPrompt.blocks && editingPrompt.blocks.length > 0
            ? foldReasoningIntoConstraints(editingPrompt.blocks)
            : DEFAULT_BLOCKS.map((b) =>
                b.type === 'objective'
                  ? { ...b, content: editingPrompt.content, enabled: true }
                  : b,
              ),
        ),
      );
      setStrategyType(editingPrompt.strategy_type);
      setThinkingMode(editingPrompt.thinking_mode);
      setPreferredModel(editingPrompt.preferred_model);
      setComplexityLevel(editingPrompt.complexity_level);
      setIntentCategory(editingPrompt.intent_category);
      setOutputType(editingPrompt.output_type);
      setFolderId(editingPrompt.folder_id);
      setAskUserQuestions(editingPrompt.ask_user_questions);
      // Read once on open: the picker owns the draft from here, so a background
      // refresh can't stomp an in-progress edit.
      setLabelIds(useLabelStore.getState().promptLabels.get(editingPrompt.id) ?? []);
      // An AI update drafted from a new prompt's "Update it instead": shown over
      // the saved text, unsaved. The shortcut, folder and labels stay its own.
      const handed = useDraftStore.getState().take('prompt', editingPrompt.id);
      if (handed?.kind === 'prompt') {
        setName(sanitizeName(handed.draft.name));
        setBlocks((prev) => readyBlocks(withBrainKept(promptDraftBlocks(handed.draft), prev)));
        setDraftNotice({ mode: 'update', changes: handed.changes, text: '', similar: [] });
      }
    } else {
      // A prompt joined from the Suggestions on Analytics opens here, unsaved.
      // Closing the editor clears the seed, so the next New prompt starts empty.
      const seed = useUiStore.getState().newPromptSeed;
      setName(seed ? sanitizeName(seed.name) : '');
      setShortcut('');
      setBlocks(readyBlocks(seed ? seed.blocks : DEFAULT_BLOCKS));
      setStrategyType(null);
      setThinkingMode(null);
      setPreferredModel(null);
      setComplexityLevel(null);
      setIntentCategory(null);
      setOutputType(null);
      setFolderId(seed ? seed.folder_id : null);
      setLabelIds([]);
      setAskUserQuestions(seed ? seed.ask_user_questions : true);
      // A new prompt starts at its name. preventScroll: the panel is still
      // sliding in.
      nameRef.current?.focus({ preventScroll: true });
    }
  }, [isOpen, editingPromptId]);

  // Auto-classify when content changes
  const triggerClassify = useCallback((blocksSnapshot: PromptBlock[]) => {
    if (classifyTimer.current !== null) window.clearTimeout(classifyTimer.current);
    classifyTimer.current = window.setTimeout(async () => {
      const text = blocksSnapshot
        .filter((b) => b.enabled && b.content.trim())
        .map((b) => b.content)
        .join(' ');
      if (!text) return;
      const result = await classifyPrompt(text);
      setSuggestion(result);
    }, 800);
  }, []);

  useEffect(() => {
    triggerClassify(blocks);
  }, [blocks, triggerClassify]);

  // ESC closes the editor panel
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Read again each time the panel opens, so a change made in another tab shows.
  useEffect(() => {
    if (isOpen) setInteractiveSteps(loadInteractiveSteps());
  }, [isOpen]);

  // Saved on the spot, not on Save: it belongs to the browser, not this prompt.
  function toggleInteractiveSteps() {
    const next = !interactiveSteps;
    setInteractiveSteps(next);
    if (!saveInteractiveSteps(next)) showToast('Could not save Interactive Steps in this browser', 'error');
  }

  function applyIntentSuggestion() {
    if (!suggestion) return;
    if (!strategyType) setStrategyType(suggestion.strategies[0] ?? null);
    if (!thinkingMode) setThinkingMode(suggestion.thinkingMode);
    if (!preferredModel) setPreferredModel(suggestion.preferredModel);
    if (!intentCategory) setIntentCategory(suggestion.intent);
    setSuggestion(null);
  }

  function close() {
    if (mode === 'edit') closeEdit();
    else closeNew();
  }

  // A new draft replaces what the form holds: the person asked for it, and
  // nothing has been saved yet.
  function applyDraft(result: DraftResult, text: string) {
    if (result.kind !== 'prompt') return;
    const { draft } = result;
    setName(sanitizeName(draft.name));
    setShortcut(
      draft.shortcut ? uniqueToken(draft.shortcut, prompts.map((p) => p.shortcut ?? '')) : '',
    );
    setBlocks((prev) => readyBlocks(withBrainKept(promptDraftBlocks(draft), prev)));
    setFolderId((prev) => idByName(draft.folder, folders) ?? prev);
    setLabelIds(idsByName(draft.labels, labels));
    setNameError(null);
    setShortcutError(null);
    setAiDrafted(true);
    setDraftNotice({
      mode: 'new',
      changes: '',
      text,
      similar: findSimilar(
        {
          title: draft.name,
          text: [draft.role, draft.objective, draft.context, draft.examples, draft.constraints].join(' '),
          token: draft.shortcut,
        },
        promptCandidates(prompts),
      ),
    });
  }

  function openExisting(id: string) {
    closeNew();
    openEdit(id);
  }

  function updateBlock(type: PromptBlockType, content: string) {
    setBlocks((prev) =>
      prev.map((b) => (b.type === type ? { ...b, content } : b)),
    );
  }

  // The Brain the Background part carries: a choice, kept beside the text.
  function setBlockBrain(brain: PromptBrainRef | null) {
    setBlocks((prev) =>
      prev.map((b) => (b.type === 'context' ? { ...b, brain } : b)),
    );
  }

  function setBlockEnabled(type: PromptBlockType, enabled: boolean) {
    setBlocks((prev) =>
      prev.map((b) => (b.type === type ? { ...b, enabled } : b)),
    );
  }

  function addPart(type: OptionalPart) {
    setBlockEnabled(type, true);
    setFocusPart({ type, on: 'box' });
  }

  function removePart(type: OptionalPart) {
    setBlockEnabled(type, false);
    setFocusPart({ type, on: 'row' });
  }

  // Switches a part on (if off) and appends a line on its own row: used by the
  // quality fixes that can't be satisfied by a setting.
  function appendToBlock(type: PromptBlockType, line: string) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.type !== type) return b;
        const trimmed = b.content.trim();
        return { ...b, enabled: true, content: trimmed ? `${trimmed}\n${line}` : line };
      }),
    );
  }

  // ── Prompt quality evaluation ────────────────────────────────────────────────

  const evalResult = usePromptEvaluator(
    { blocks, strategyType, preferredModel, outputType },
    isOpen,
  );

  // Corpus benchmark: prefer a same-intent cohort, else the whole library.
  // The cohort and its scores depend only on the library and intent, so they
  // are memoised separately from the per-keystroke percentile.
  const cohort = useMemo(
    () => selectBenchmarkCohort(prompts, editingPrompt?.id ?? null, intentCategory),
    [prompts, editingPrompt?.id, intentCategory],
  );

  const cohortScores = useMemo(
    () => cohort?.prompts.map((p) => evaluatePrompt(promptToEvaluatorInput(p)).score) ?? null,
    [cohort],
  );

  const benchmark = useMemo(() => {
    if (!cohort || !cohortScores || !evalResult) return null;
    return {
      percentile: percentRank(cohortScores, evalResult.score),
      corpusSize: cohort.prompts.length,
      scopeLabel: cohort.scopeLabel,
    };
  }, [cohort, cohortScores, evalResult]);

  function handleApplySuggestion(criterionId: string) {
    const asBlockType = BLOCK_CRITERION_TYPES.find((t) => t === criterionId);
    if (asBlockType) {
      if (asBlockType === 'objective') setBlockEnabled('objective', true);
      else addPart(asBlockType);
      return;
    }
    if (criterionId === 'audience') {
      appendToBlock('context', 'Audience: [who this is for and their expertise level].');
      return;
    }
    if (criterionId === 'refinement') {
      appendToBlock('constraints', 'Double-check the result and flag anything you are unsure about.');
      return;
    }
    if (criterionId === 'output_format') { setOutputType('Plain'); return; }
    if (criterionId === 'strategy') { setStrategyType('One-shot'); return; }
    if (criterionId === 'model') { setPreferredModel('claude-sonnet-4-6'); return; }
  }

  function loadExample() {
    setName(sanitizeName(EXAMPLE_PROMPT.name));
    setBlocks((prev) => readyBlocks(withBrainKept(EXAMPLE_PROMPT.blocks.map((b) => ({ ...b })), prev)));
    setStrategyType(EXAMPLE_PROMPT.strategyType);
    setPreferredModel(EXAMPLE_PROMPT.preferredModel);
    setOutputType(EXAMPLE_PROMPT.outputType);
    setIntentCategory(EXAMPLE_PROMPT.intentCategory);
    if (nameError) setNameError(null);
  }

  function handlePreviewDraft() {
    const assembled = assembleBlocks(blocks, { askUserQuestions });
    if (assembled) openPromptDraftPreview(assembled);
    else showToast('Write what the AI should do first, then preview it.', 'error');
  }

  async function handleSave() {
    if (!name.trim()) {
      setNameError('Give your prompt a name.');
      nameRef.current?.focus();
      return;
    }
    setNameError(null);

    const trimmedShortcut = shortcut.trim();
    if (trimmedShortcut && !/^[a-zA-Z0-9_-]+$/.test(trimmedShortcut)) {
      setShortcutError(`Use only letters, numbers, - and _. ${promptTrigger} is added for you.`);
      return;
    }
    setShortcutError(null);
    setSubmitError(null);
    setSaving(true);

    const assembled = assembleBlocks(blocks, { askUserQuestions });
    const payload: PromptFormValues = {
      name: name.trim(),
      content: assembled,
      shortcut: trimmedShortcut,
      strategy_type: strategyType,
      thinking_mode: thinkingMode,
      preferred_model: preferredModel,
      complexity_level: complexityLevel,
      intent_category: intentCategory,
      output_type: outputType,
      blocks,
      ask_user_questions: askUserQuestions,
      folder_id: folderId,
    };

    try {
      if (mode === 'edit' && editingPrompt) {
        // The editor's save records what the prompt said (HISTORY-001), which
        // a pin or a folder move deliberately does not.
        await editPromptWithVersion(editingPrompt.id, payload);
        await setPromptLabels(editingPrompt.id, labelIds);
        showToast('Changes saved');
        closeEdit();
      } else {
        const created = await addPrompt(
          payload,
          aiDrafted ? { reviewStatus: 'ai_generated' } : undefined,
        );
        // Only after the row exists: the link table has an FK to prompts.
        await setPromptLabels(created.id, labelIds);
        showToast('Prompt created');
        closeNew();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const historyEntries = useMemo<HistoryEntry[]>(
    () =>
      versions.map((version) => ({
        id: version.id,
        versionNumber: version.version_number,
        editorDisplay: version.editor_display,
        createdAt: version.created_at,
        // The assembled text is what a reader compares: the blocks are how it
        // was built, and a diff of their JSON reads as machinery, not writing.
        body: labelBrainTokens(version.content),
        note: version.edit_note,
      })),
    [versions],
  );

  async function handleRestoreVersion(entry: HistoryEntry) {
    const version = versions.find((candidate) => candidate.id === entry.id);
    if (!editingPrompt || !version) return;
    try {
      await restorePromptVersion(editingPrompt.id, version);
      showToast(`Restored version ${version.version_number}. It is saved as the latest version.`);
      setHistoryOpen(false);
      closeEdit();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to restore version.', 'error');
    }
  }

  async function handleDelete() {
    if (!editingPrompt) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await removePrompt(editingPrompt.id);
      closeEdit();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Delete failed');
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  }

  function handleUsePrompt() {
    if (editingPrompt) {
      openPromptPreview(editingPrompt.id);
    }
  }

  const task = blocks.find((b) => b.type === 'objective') ?? { type: 'objective', content: '', enabled: true };
  const suggestedStrategy = suggestion?.strategies[0] ?? null;

  return (
    <div
      // 520px covers half of a 1024px screen. It narrows to 420px below 2xl,
      // and PromptsPage reserves the same two widths: the pair must move
      // together or the list ends up under the drawer.
      // The shadow belongs to the open panel only. A closed one sits just off
      // screen, and its shadow would still show down the right edge of the page.
      // The panel is a night surface: dark on every theme (index.css gives the
      // tokens their night values inside it). text-ink is set here because the
      // page's own text colour would otherwise be inherited from outside.
      data-surface="night"
      className={cn(
        'night-glow fixed bottom-0 right-0 top-[60px] z-40 flex w-[420px] flex-col overflow-hidden border-l border-line bg-bg text-ink transition-[transform,box-shadow] duration-200 2xl:w-[520px]',
        isOpen ? 'translate-x-0 shadow-sm' : 'translate-x-full',
      )}
    >
      {/* ── Top: title, then the two ways to start a new prompt ── */}
      <div className="shrink-0 border-b border-line">
        <div className="flex items-center gap-1 px-5 py-3.5">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
            {mode === 'edit' ? 'Edit prompt' : 'New prompt'}
          </h2>
          {/* About sits behind an icon rather than a band in the panel, which
              returns that space to the controls used on every edit. */}
          {mode === 'edit' && editingPrompt && (
            <AssetAboutButton
              noun="prompt"
              assetId={editingPrompt.id}
              createdBy={editingPrompt.user_id}
              updatedBy={editingPrompt.updated_by}
              updatedAt={editingPrompt.updated_at}
            />
          )}
          {mode === 'edit' && editingPrompt && (
            <ReviewStatusMenu
              noun="prompt"
              status={editingPrompt.review_status}
              reviewedBy={editingPrompt.reviewed_by}
              reviewedAt={editingPrompt.reviewed_at}
              approver={isApprover(editingPrompt.organization_id, editingPrompt.user_id)}
              onChange={(next) => setReviewStatus(editingPrompt.id, next)}
            />
          )}
          <button
            type="button"
            onClick={close}
            className="ml-1 rounded-[8px] p-1.5 text-ink-muted transition-colors hover:bg-bg-alt hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Close editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {mode === 'create' && (
          <div className="flex flex-wrap gap-2 px-5 pb-4">
            <DraftFromTextButton
              kind="prompt"
              noun="prompt"
              folders={folders.map((f) => f.name)}
              labels={labels.map((l) => l.name)}
              disabled={saving}
              onDrafted={applyDraft}
            />
            <button type="button" onClick={loadExample} className={CHIP_BUTTON}>
              <Lightbulb className="h-3.5 w-3.5" aria-hidden />
              See an example
            </button>
          </div>
        )}
      </div>

      {/* ── Scrollable content ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Name and task: the two things every prompt needs. */}
        <section className="space-y-5 px-5 py-5">
          {draftNotice && (
            <DraftNotice
              kind="prompt"
              notice={draftNotice}
              onOpen={openExisting}
              onDismiss={() => setDraftNotice(null)}
            />
          )}
          <div>
            <label htmlFor="prompt-name" className={FIELD_LABEL}>
              Name
            </label>
            <Input
              ref={nameRef}
              id="prompt-name"
              value={name}
              onChange={(e) => {
                setName(nameFromEvent(e));
                if (nameError) setNameError(null);
              }}
              onCompositionEnd={(e) => setName(nameFromEvent(e))}
              autoCapitalize="characters"
              placeholder="REPLY TO A COMPLAINT"
              aria-invalid={nameError !== null}
              aria-describedby={nameError ? 'prompt-name-error' : undefined}
              className={nameError ? 'border-danger focus:border-danger focus:ring-danger/20' : undefined}
            />
            {nameError && (
              <p id="prompt-name-error" className="mt-1.5 text-xs text-danger">
                {nameError}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="prompt-task" className={FIELD_LABEL}>
              What should the AI do?
            </label>
            <AutoGrowTextarea
              id="prompt-task"
              value={task.content}
              onChange={(content) => updateBlock('objective', content)}
              placeholder={TASK_PLACEHOLDER}
            />
          </div>
        </section>

        {/* The four optional parts, each one row until it is added. */}
        <section className="border-t border-line px-5 py-4" aria-labelledby="prompt-more-detail">
          <h3 id="prompt-more-detail" className="mb-1 text-[13px] font-semibold text-ink">
            Add more detail <span className={OPTIONAL}>· optional</span>
          </h3>
          {PARTS.map((spec) => {
            const block = blocks.find((b) => b.type === spec.type) ?? {
              type: spec.type,
              content: '',
              enabled: false,
            };
            return (
              <PartSection
                key={spec.type}
                spec={spec}
                block={block}
                focus={focusPart?.type === spec.type ? focusPart.on : null}
                onAdd={() => addPart(spec.type)}
                onRemove={() => removePart(spec.type)}
                onChange={(content) => updateBlock(spec.type, content)}
              >
                {/* Mounted only while the panel is open, so a reopened panel
                    reads the Brains afresh. */}
                {spec.type === 'context' && isOpen && (
                  <BrainPicker value={block.brain ?? null} onChange={setBlockBrain} />
                )}
              </PartSection>
            );
          })}
        </section>

        {/* How the AI works with you. Ask me questions first is saved with the
            prompt (ASK_USER_QUESTIONS_SECTION); Interactive Steps belongs to
            this browser and is saved on the spot (lib/interactiveSteps). */}
        <section className="border-t border-line px-5 py-3">
          <SettingRow
            id="prompt-ask-user-questions"
            title="Ask me questions first"
            hint="The AI asks you a few questions, one at a time, before it starts."
            checked={askUserQuestions}
            onChange={setAskUserQuestions}
          />
          <SettingRow
            id="prompt-interactive-steps"
            title="Interactive Steps"
            hint="The AI works one step at a time and waits for you. Applies to all your prompts."
            checked={interactiveSteps}
            onChange={() => toggleInteractiveSteps()}
          />
        </section>

        {/* Where to find it: the shortcut, the folder and the labels. */}
        <section className="border-t border-line px-5 py-5">
          <label htmlFor="prompt-shortcut" className={FIELD_LABEL}>
            Shortcut <span className={OPTIONAL}>· optional</span>
          </label>
          {/* The prompt trigger sits in front of the box, as the snippet
              editor's Trigger shows its prefix. The stored value stays a bare
              word. */}
          <div
            className={cn(
              'flex h-10 items-stretch overflow-hidden rounded-[12px] border border-line bg-card',
              'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
              shortcutError && 'border-danger focus-within:border-danger focus-within:ring-danger/20',
            )}
          >
            <span
              aria-hidden
              translate="no"
              className="flex select-none items-center border-r border-line bg-bg-alt px-3 font-mono text-sm font-semibold text-ink-muted"
            >
              {promptTrigger}
            </span>
            <input
              id="prompt-shortcut"
              type="text"
              value={shortcut}
              onChange={(e) => {
                // Cleaned on the way in, so a space lands as `_` and the save-time
                // error can never fire on something the user typed here.
                setShortcut(sanitizeTriggerInput(e.target.value));
                if (shortcutError) setShortcutError(null);
              }}
              placeholder="followup"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-describedby="prompt-shortcut-hint"
              className="min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
            />
          </div>
          {shortcutError ? (
            <p id="prompt-shortcut-hint" className="mt-1.5 text-xs text-danger">
              {shortcutError}
            </p>
          ) : (
            <p id="prompt-shortcut-hint" className={HINT}>
              Type
              <span translate="no">
                {' '}
                <span className="font-mono text-ink">{`${promptTrigger}${shortcut.trim() || 'followup'}`}</span>{' '}
              </span>
              in any text box to insert this prompt.
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="prompt-folder" className={FIELD_LABEL}>
                Folder
              </label>
              <select
                id="prompt-folder"
                value={folderId ?? ''}
                onChange={(e) => setFolderId(e.target.value === '' ? null : e.target.value)}
                disabled={saving}
                className={SELECT_CLASS}
              >
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id} translate="no">
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="prompt-labels" className={FIELD_LABEL}>
                Labels
              </label>
              {/* Mounted only while the panel is open. This panel never
                  unmounts (it slides out), and the picker's menu is portalled
                  to <body>, so leaving it mounted would strand an open menu on
                  screen after Save or Close. */}
              {isOpen && (
                <LabelPicker
                  id="prompt-labels"
                  value={labelIds}
                  onChange={setLabelIds}
                  disabled={saving}
                />
              )}
            </div>
          </div>
        </section>

        {evalResult && (
          <PromptEfficiencyWidget
            result={evalResult}
            onApply={handleApplySuggestion}
            benchmark={benchmark}
          />
        )}

        <PanelDisclosure
          id="prompt-more-options"
          icon={SlidersHorizontal}
          title="More options"
          summary="Strategy, intent and answer format"
        >
          {/* Read from what has been written so far. Offered only while it
              would fill something still empty. */}
          {suggestion && (!strategyType || !intentCategory) && (
            <div className="mb-4 flex items-center gap-3 rounded-[12px] border border-primary/20 bg-primary-light px-3 py-2.5">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink">
                Suggested: <span className="font-semibold">{suggestion.intent}</span>
                {suggestedStrategy && (
                  <>
                    , with <span className="font-semibold">{suggestedStrategy}</span>
                  </>
                )}
                .
              </p>
              <Button size="sm" variant="ghost" onClick={applyIntentSuggestion} className="shrink-0 bg-card">
                Use it
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="prompt-strategy" className={FIELD_LABEL}>
                Strategy
              </label>
              <select
                id="prompt-strategy"
                value={strategyType ?? ''}
                onChange={(e) => setStrategyType(e.target.value === '' ? null : (e.target.value as StrategyType))}
                className={SELECT_CLASS}
              >
                <option value="">None</option>
                {STRATEGY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="prompt-intent" className={FIELD_LABEL}>
                Intent
              </label>
              <select
                id="prompt-intent"
                value={intentCategory ?? ''}
                onChange={(e) => setIntentCategory(e.target.value === '' ? null : (e.target.value as IntentCategory))}
                className={SELECT_CLASS}
              >
                <option value="">None</option>
                {INTENT_CATEGORIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="prompt-output" className={FIELD_LABEL}>
                Answer format
              </label>
              <select
                id="prompt-output"
                value={outputType ?? ''}
                onChange={(e) => setOutputType(e.target.value === '' ? null : (e.target.value as OutputType))}
                className={SELECT_CLASS}
              >
                <option value="">None</option>
                {OUTPUT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </PanelDisclosure>
      </div>

      {/* ── Footer actions ── */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-bg-alt px-5 py-4">
        {submitError && (
          <div role="alert" className="flex items-start gap-2 rounded-[10px] bg-danger-bg px-3 py-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {submitError}
          </div>
        )}
        {mode === 'edit' && editingPrompt?.organization_id && editingPrompt.folder_id && (
          <TeamLastUseLine kind="prompt" ids={[editingPrompt.id]} />
        )}
        {/* Every button keeps its words on one line. On the 420px panel History
            is an icon, so the four buttons fit; the row may still wrap whole as
            a last resort, but a button is never squeezed until its label breaks. */}
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'edit' && editingPrompt && (
            <Button variant="ghost" onClick={handleUsePrompt} className="shrink-0 bg-card px-3">
              <Zap className="h-3.5 w-3.5" aria-hidden />
              Use
            </Button>
          )}
          {mode === 'create' && (
            <Button variant="ghost" onClick={handlePreviewDraft} className="shrink-0 bg-card px-3">
              <Eye className="h-3.5 w-3.5" aria-hidden />
              Preview
            </Button>
          )}
          <div className="flex-1" />
          {mode === 'edit' && editingPrompt && (
            <Button
              variant="ghost"
              onClick={() => {
                setHistoryOpen(true);
                void loadPromptVersions(editingPrompt.id);
              }}
              aria-label="History"
              title="History"
              className="shrink-0 bg-card px-3"
            >
              <Clock className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden 2xl:inline">History</span>
            </Button>
          )}
          {mode === 'edit' && (
            <Button
              variant="ghost"
              onClick={handleDelete}
              disabled={saving}
              className="shrink-0 border-danger/30 bg-card px-3 text-danger hover:border-danger/50 hover:bg-danger-bg"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {confirmDelete ? 'Yes, delete' : 'Delete'}
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} className="shrink-0">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create prompt'}
          </Button>
        </div>
      </div>

      <HistoryPanel
        open={historyOpen}
        subject={editingPrompt?.name ?? null}
        noun="prompt"
        entries={historyEntries}
        loading={versionsLoading}
        onClose={() => setHistoryOpen(false)}
        onRestore={handleRestoreVersion}
      />
    </div>
  );
}
