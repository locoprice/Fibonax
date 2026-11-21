import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { RowButton } from '@/features/org/InviteMemberPanel';
import {
  MY_DETAIL_WORDS,
  myDetails,
  myDetailsApi,
  myToken,
  subscribeMyDetails,
  type MyDetailWord,
} from '@/lib/myDetails';
import {
  loadSeason,
  SEASON_LANGS,
  seasonApi,
  YEAR_TOKEN,
  type Occasion,
  type SbSeasonApi,
  type SeasonLang,
} from '@/lib/season';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

interface OccasionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'] as const;
/** Days in each month; February counts the 29th, which a year may not have. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const SELECT =
  'h-9 rounded-[10px] border border-line bg-card px-2 text-sm text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const FIELD_LABEL = 'mb-1 block text-xs font-medium text-ink-muted';

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Today as the calendar writes a day: 'MM-DD'. */
function monthDayOf(date: Date): string {
  return `${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * Your occasions: the one calendar behind every seasonal line (`{seasonal}`).
 * Three ready occasions and up to ten of the person's own, each with the days
 * it is in season and the sentence it prints. Every change is saved as it is
 * made, like the Departments window, and reaches the extension and the phone
 * with the account's other settings.
 *
 * What is in season, and every word about a period, come from the shared
 * module (extension/shared/season.js through lib/season.ts); this only draws
 * the list and hands back what was changed.
 */
export function OccasionsDialog({ open, onOpenChange }: OccasionsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Your occasions</DialogTitle>
          <DialogDescription>
            A snippet with a seasonal line prints the sentence of the occasion in season, and
            nothing for the rest of the year. One calendar for all your snippets.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so a closed window forgets a row left half changed. */}
        {open && <OccasionsManager />}
      </DialogContent>
    </Dialog>
  );
}

function OccasionsManager() {
  const stored = useSettingsStore((s) => s.profile?.occasions);
  const editProfile = useSettingsStore((s) => s.editProfile);
  const showToast = useUiStore((s) => s.showToast);

  const [api, setApi] = useState<SbSeasonApi | null>(() => seasonApi());
  const [loadError, setLoadError] = useState(false);
  // The occasion being changed, 'new' for one being added, null for the list.
  const [editing, setEditing] = useState<Occasion | 'new' | null>(null);

  useEffect(() => {
    if (api) return;
    let cancelled = false;
    loadSeason()
      .then((loaded) => {
        if (!cancelled) setApi(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const items = useMemo(() => (api ? api.list(stored ?? []) : []), [api, stored]);

  if (loadError) {
    return (
      <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Your occasions could not be loaded. Reload the page to try again.
      </p>
    );
  }
  if (!api) {
    return <p className="text-sm text-ink-subtle">Loading your occasions…</p>;
  }

  /** Saves the whole calendar with one occasion changed, added or taken out. */
  async function save(next: Occasion[], done: string) {
    if (!api) return;
    const packed = api.pack(next);
    // The account's settings travel with every request, so the calendar has a size limit.
    if (!api.fits(packed)) {
      throw new Error('Your occasions are too long to keep. Shorten a sentence or remove an occasion.');
    }
    await editProfile({ occasions: packed });
    showToast(done);
  }

  const own = items.filter((o) => !o.ready);
  const today = new Date();
  const inSeason = api.active(today, stored ?? []);
  const coming = inSeason ? null : api.next(today, stored ?? []);

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-[12px] border border-primary/25 bg-primary-light px-3 py-2 text-xs text-ink" role="status">
        {inSeason ? (
          <>
            In season today:{' '}
            <span className="font-semibold" translate={inSeason.ready ? undefined : 'no'}>{inSeason.name}</span>.
          </>
        ) : coming ? (
          <>
            Nothing is in season today. Next:{' '}
            <span className="font-semibold" translate={coming.occasion.ready ? undefined : 'no'}>{coming.occasion.name}</span>
            , from {coming.day} {MONTHS[coming.month - 1]}.
          </>
        ) : (
          'Nothing is in season today, and no occasion is switched on.'
        )}
      </p>

      {/* One occasion being written or changed takes the window's room, so
          every box and its Save stay in view; Cancel brings the list back. */}
      {editing ? (
        <div className="rounded-[12px] border border-line px-3 py-3">
          <OccasionForm
            api={api}
            occasion={
              editing === 'new'
                ? {
                    id: 'new', ready: false, name: '', from: monthDayOf(today), to: monthDayOf(today),
                    before: 0, after: 0, texts: { EN: '', IT: '', ES: '', FR: '' }, on: true,
                  }
                : editing
            }
            onCancel={() => setEditing(null)}
            onSave={async (changed) => {
              if (editing === 'new') await save([...items, changed], `${changed.name} added.`);
              else await save(items.map((o) => (o.id === editing.id ? changed : o)), `${changed.name} saved.`);
              setEditing(null);
            }}
          />
        </div>
      ) : (
        <ul className="flex max-h-[46vh] flex-col divide-y divide-line overflow-y-auto rounded-[12px] border border-line">
          {items.map((occasion) => (
            <OccasionRow
              key={occasion.id}
              api={api}
              occasion={occasion}
              onEdit={() => setEditing(occasion)}
              onSave={(changed, done) =>
                save(items.map((o) => (o.id === occasion.id ? changed : o)), done)
              }
              onRemove={() =>
                save(items.filter((o) => o.id !== occasion.id), `${occasion.name} removed.`)
              }
            />
          ))}
        </ul>
      )}

      {!editing &&
        (own.length < api.MAX_OWN ? (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add your own
            </Button>
            <p className="mt-1.5 text-xs text-ink-subtle">
              A closing week, new opening hours, an anniversary: any sentence that belongs to
              some days of the year.
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink-subtle">
            You have {api.MAX_OWN} occasions of your own, the most the calendar holds. Remove one
            to add another.
          </p>
        ))}
    </div>
  );
}

type RowMode = 'view' | 'confirm-remove';

function OccasionRow({
  api,
  occasion,
  onEdit,
  onSave,
  onRemove,
}: {
  api: SbSeasonApi;
  occasion: Occasion;
  onEdit: () => void;
  onSave: (changed: Occasion, done: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [mode, setMode] = useState<RowMode>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>, failed: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : failed);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'confirm-remove') {
    return (
      // A 5% tint over the card, as in the Departments window, so the sentence
      // reads on both themes.
      <li className="flex items-center gap-3 bg-danger/5 px-3 py-2.5">
        <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs text-ink">
          Remove <span translate="no">{occasion.name}</span>? Snippets with a seasonal line stop
          printing its sentence.
        </p>
        <RowButton onClick={() => setMode('view')} disabled={busy} label={`Keep ${occasion.name}`}>
          Keep it
        </RowButton>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(onRemove, 'Could not remove it. Try again.')}
          aria-label={`Remove ${occasion.name}`}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] bg-danger px-2.5 text-xs font-semibold text-white transition-colors hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          Remove
        </button>
      </li>
    );
  }

  // The row reads in the first language the person wrote in, English otherwise.
  const shown = SEASON_LANGS.find((l) => occasion.texts[l] !== '') ?? 'EN';
  const sentence = api.textOf(occasion, shown, api.yearOf(occasion));
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Switch
          checked={occasion.on}
          disabled={busy}
          aria-label={`${occasion.name}, ${occasion.on ? 'on' : 'off'}`}
          onChange={(on) =>
            void run(
              () => onSave({ ...occasion, on }, `${occasion.name} switched ${on ? 'on' : 'off'}.`),
              'Could not save it. Try again.',
            )
          }
        />
        <div className={occasion.on ? 'min-w-0 flex-1' : 'min-w-0 flex-1 opacity-60'}>
          <p className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium text-ink" translate={occasion.ready ? undefined : 'no'}>
              {occasion.name}
            </span>
            <span className="shrink-0 text-xs text-ink-subtle">{occasion.on ? 'On' : 'Off'}</span>
          </p>
          <p className="truncate text-xs text-ink-muted">{api.periodLabel(occasion)}</p>
          <p className="truncate text-xs text-ink-subtle" translate="no" title={sentence}>
            {sentence || 'No sentence yet: it prints nothing.'}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <RowButton onClick={onEdit} disabled={busy} label={`Edit ${occasion.name}`}>
            Edit
          </RowButton>
          {!occasion.ready && (
            <RowButton
              onClick={() => setMode('confirm-remove')}
              disabled={busy}
              label={`Remove ${occasion.name}`}
              danger
            >
              Remove
            </RowButton>
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/** One occasion being changed, or a new one being written. Save hands back the result. */
function OccasionForm({
  api,
  occasion,
  onSave,
  onCancel,
}: {
  api: SbSeasonApi;
  occasion: Occasion;
  onSave: (changed: Occasion) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(occasion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const easter = draft.ready && draft.from === '';
  const fresh = occasion.id === 'new';

  function change(patch: Partial<Occasion>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    if (error) setError(null);
  }

  async function submit() {
    if (busy) return;
    const name = draft.name.trim();
    const texts = trimTexts(draft.texts);
    if (!draft.ready && name === '') {
      setError('Give it a name.');
      return;
    }
    if (!draft.ready && SEASON_LANGS.every((l) => texts[l] === '')) {
      setError('Write the sentence it prints, in at least one language.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...draft, name, texts });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save it. Try again.');
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {draft.ready ? (
        <p className="text-sm font-medium text-ink">Edit {draft.name}</p>
      ) : (
        <label>
          <span className={FIELD_LABEL}>Name</span>
          <Input
            value={draft.name}
            maxLength={api.MAX_NAME}
            placeholder="Summer closing"
            readOnly={busy}
            autoFocus={fresh}
            translate="no"
            onChange={(e) => change({ name: e.target.value })}
            className="h-9"
          />
        </label>
      )}

      {easter ? (
        <div>
          <span className={FIELD_LABEL}>When</span>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
            From
            <DaysBox
              label="Days before Easter"
              value={draft.before}
              max={api.EASTER_BEFORE_MAX}
              onChange={(before) => change({ before })}
            />
            days before Easter to
            <DaysBox
              label="Days after Easter"
              value={draft.after}
              max={api.EASTER_AFTER_MAX}
              onChange={(after) => change({ after })}
            />
            days after. Easter is found every year.
          </p>
        </div>
      ) : (
        <div>
          <span className={FIELD_LABEL}>When, every year</span>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
            <DayPicker label="From" value={draft.from} onChange={(from) => change({ from })} />
            <span>to</span>
            <DayPicker label="To" value={draft.to} onChange={(to) => change({ to })} />
          </div>
        </div>
      )}

      <WishBoxes
        api={api}
        draft={draft}
        busy={busy}
        focusFirst={!fresh && draft.ready}
        onChange={(texts) => change({ texts })}
      />

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const LANG_NAMES: Record<SeasonLang, string> = { EN: 'English', IT: 'Italian', ES: 'Spanish', FR: 'French' };

/** Where each detail a wish can carry is set, for the note shown when it is missing. */
const DETAIL_HOME: Record<MyDetailWord, string> = {
  name: 'Add your name in Settings > Account.',
  company: 'Add it in Settings > Account > Company branding, or ask whoever created your team.',
  'job title': 'Your job title is set on the Team page, by you or a team admin.',
};

function trimTexts(texts: Record<SeasonLang, string>): Record<SeasonLang, string> {
  return { EN: texts.EN.trim(), IT: texts.IT.trim(), ES: texts.ES.trim(), FR: texts.FR.trim() };
}

/**
 * The sentence an occasion prints, one box per language, with the buttons that
 * put the account's details into it and one line that reads the result back,
 * as it goes out today. A detail the account does not hold is named, with
 * where to set it: until then the ready words go out instead.
 */
function WishBoxes({
  api,
  draft,
  busy,
  focusFirst,
  onChange,
}: {
  api: SbSeasonApi;
  draft: Occasion;
  busy: boolean;
  focusFirst: boolean;
  onChange: (texts: Record<SeasonLang, string>) => void;
}) {
  const details = useSyncExternalStore(subscribeMyDetails, myDetails, myDetails);
  const [lang, setLang] = useState<SeasonLang>(
    () => SEASON_LANGS.find((l) => draft.texts[l] !== '') ?? 'EN',
  );
  const boxes = useRef<Partial<Record<SeasonLang, HTMLInputElement | null>>>({});
  // Where the cursor goes once an inserted detail is in the box. Applied after
  // the box shows its new text: placed before, the cursor would land on the
  // old text and what is typed next would go in front of the sentence.
  const pendingCaret = useRef<{ lang: SeasonLang; at: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending) return;
    pendingCaret.current = null;
    const box = boxes.current[pending.lang];
    box?.focus();
    box?.setSelectionRange(pending.at, pending.at);
  }, [draft.texts]);

  /** Puts a token where the cursor is in the box last used, and keeps the cursor after it. */
  function insert(token: string) {
    const box = boxes.current[lang];
    const current = draft.texts[lang];
    const start = box?.selectionStart ?? current.length;
    const end = box?.selectionEnd ?? current.length;
    const before = current.slice(0, start);
    const spaced = before !== '' && !/\s$/.test(before) ? ` ${token}` : token;
    const next = (before + spaced + current.slice(end)).slice(0, api.MAX_TEXT);
    pendingCaret.current = { lang, at: Math.min(before.length + spaced.length, next.length) };
    onChange({ ...draft.texts, [lang]: next });
  }

  const trimmed = { ...draft, texts: trimTexts(draft.texts) };
  // `details` is read so the line follows a change to them; the module holds the same answer.
  const readBack = details ? api.textOf(trimmed, lang, api.yearOf(trimmed)) : '';
  const missing = myDetailsApi()?.missingIn(trimmed.texts[lang]) ?? [];

  return (
    <div>
      <span className={FIELD_LABEL}>What it prints</span>
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
        {SEASON_LANGS.map((l, i) => (
          <Fragment key={l}>
            <label
              htmlFor={`wish-${draft.id}-${l}`}
              className="rounded-[6px] bg-bg-alt py-1 text-center text-[11px] font-semibold text-ink-muted"
              title={LANG_NAMES[l]}
              translate="no"
            >
              {l}
            </label>
            <Input
              id={`wish-${draft.id}-${l}`}
              ref={(el) => {
                boxes.current[l] = el;
              }}
              value={draft.texts[l]}
              maxLength={api.MAX_TEXT}
              placeholder={draft.ready ? api.words(draft.id, l) : l === 'EN' ? 'We are closed until 25 August.' : ''}
              aria-label={`What it prints in ${LANG_NAMES[l]}`}
              readOnly={busy}
              autoFocus={focusFirst && i === 0}
              translate="no"
              onFocus={() => setLang(l)}
              onChange={(e) => onChange({ ...draft.texts, [l]: e.target.value })}
              className="h-9"
            />
          </Fragment>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-subtle">
        {draft.ready
          ? 'A language left empty prints the ready words. A snippet in another language uses English.'
          : 'A snippet uses the sentence in its own language, else the first one written here.'}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-muted">Add to the sentence:</span>
        {MY_DETAIL_WORDS.map((d) => (
          <button
            key={d.word}
            type="button"
            disabled={busy}
            onClick={() => insert(myToken(d.word))}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-card px-2.5 text-xs font-medium text-ink-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            {d.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => insert(YEAR_TOKEN)}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-card px-2.5 text-xs font-medium text-ink-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Year
        </button>
      </div>

      <p className="mt-2.5 rounded-[10px] bg-bg-alt px-3 py-2 text-xs text-ink" role="status">
        Prints in {LANG_NAMES[lang]}:{' '}
        <span className="font-semibold" translate="no">
          {readBack || 'nothing'}
        </span>
      </p>
      {missing.map((word) => (
        <p key={word} className="mt-1.5 flex items-start gap-1.5 text-xs text-ink">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-warning-deep" aria-hidden="true" />
          <span>
            Your {MY_DETAIL_WORDS.find((d) => d.word === word)?.label.toLowerCase().replace('your ', '')} is not
            set yet, so {draft.ready ? 'the ready words go out' : 'nothing goes out'} instead. {DETAIL_HOME[word]}
          </span>
        </p>
      ))}
    </div>
  );
}

/** A day of the year, as a day and a month: 'MM-DD'. */
function DayPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const month = Number(value.slice(0, 2)) || 1;
  const day = Number(value.slice(3, 5)) || 1;
  const days = MONTH_DAYS[month - 1] ?? 31;
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label={`${label}: day`}
        value={day}
        onChange={(e) => onChange(`${two(month)}-${two(Number(e.target.value))}`)}
        className={SELECT}
      >
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label}: month`}
        value={month}
        onChange={(e) => {
          const next = Number(e.target.value);
          // A day the new month does not have becomes its last one.
          onChange(`${two(next)}-${two(Math.min(day, MONTH_DAYS[next - 1] ?? 31))}`);
        }}
        className={SELECT}
      >
        {MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
    </span>
  );
}

/** A small count of days, never below zero or above `max`. */
function DaysBox({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={SELECT}
    >
      {Array.from({ length: max + 1 }, (_, i) => i).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
