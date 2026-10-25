import { useMemo, useRef, useState, type RefObject } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { ExampleBox, ExampleResult, HINT } from '@/features/snippets/formulaDialogParts';
import { linkFields, withLinkRules, type LinkField } from '@/lib/linkFields';
import { linkValue, parseLinkRule, type LinkMode } from '@/lib/linkRule';

/** What one row holds while the window is open: how the page is read, and the words as typed. */
interface RowDraft {
  mode: LinkMode;
  words: string;
}

const MODE_OPTIONS: readonly { value: LinkMode; label: string }[] = [
  { value: 'after', label: 'Text after a label' },
  { value: 'before', label: 'Number before a word' },
];

const MODE_TEXT: Record<LinkMode, { label: string; placeholder: string }> = {
  after: { label: 'Comes after this on the page', placeholder: 'e.g. Order number' },
  before: { label: 'Word after the number', placeholder: 'e.g. Box|Boxes' },
};

/** `;` `{` `}` and line breaks would end or split the token, so they never get in. */
function cleanWords(raw: string): string {
  return raw.replace(/[;{}\r\n]/g, '');
}

function draftOf(field: LinkField): RowDraft {
  const rule = parseLinkRule(field.link);
  if (rule) return { mode: rule.mode, words: rule.words.join('|') };
  // A quantity on a page is far more often a count ("2 Boxes") than a figure
  // after a label, so a number starts on counting.
  return { mode: field.kind === 'number' ? 'before' : 'after', words: '' };
}

function ruleOf(draft: RowDraft): string {
  return linkValue(`${draft.mode}:${draft.words}`);
}

interface FillFromPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The snippet body the window reads its fields from. */
  body: string;
  /** Called with the body carrying the rules as set, when Save changed it. */
  onSave: (next: string) => void;
}

/**
 * Fill from a web page, set up in one place: every field the snippet has, and
 * for each the words it comes after on the page. The fill form then offers a
 * box for a page's link and fills these fields from what the page says.
 *
 * Only the `link=` setting of each field changes (`@/lib/linkFields`), so a
 * field keeps everything else it was written with. An empty box takes the
 * field's rule out; Cancel leaves the body exactly as it was, and Save is
 * followed by the editor's Undo.
 */
export function FillFromPageDialog({ open, onOpenChange, body, onSave }: FillFromPageDialogProps) {
  const listRef = useRef<HTMLUListElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[480px] gap-0 p-0"
        onOpenAutoFocus={(e) => {
          // The first field's box, where the typing starts. A snippet with no
          // fields has none, and the window's own first control takes focus.
          const first = listRef.current?.querySelector('input');
          if (!first) return;
          e.preventDefault();
          first.focus();
        }}
      >
        <FillFromPageForm
          body={body}
          listRef={listRef}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FillFromPageFormProps {
  body: string;
  listRef: RefObject<HTMLUListElement>;
  onSave: (next: string) => void;
  onClose: () => void;
}

/**
 * The window's content. It mounts each time the window opens, so it reads the
 * body as it is now: never a field since removed or a rule since changed.
 */
function FillFromPageForm({ body, listRef, onSave, onClose }: FillFromPageFormProps) {
  const [fields] = useState<LinkField[]>(() => linkFields(body));
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, draftOf(f)])),
  );

  const filled = useMemo(
    () => fields.filter((f) => {
      const draft = drafts[f.key];
      return draft !== undefined && ruleOf(draft) !== '';
    }).length,
    [fields, drafts],
  );

  function setDraft(key: string, next: RowDraft) {
    setDrafts((prev) => ({ ...prev, [key]: next }));
  }

  function handleSave() {
    // Only the rows changed here are written, so a field left alone keeps its
    // tokens exactly as they were, however the body spelled them.
    const links: Record<string, string> = {};
    for (const f of fields) {
      const draft = drafts[f.key];
      if (draft && ruleOf(draft) !== f.link) links[f.key] = ruleOf(draft);
    }
    const next = withLinkRules(body, links);
    if (next !== body) onSave(next);
    onClose();
  }

  return (
    <>
      <DialogHeader className="px-6 pt-6 pb-4">
        <DialogTitle>Fill from a web page</DialogTitle>
        <DialogDescription>
          Paste a web page&apos;s link in the fill form, and these fields fill in from what
          the page says. You check them before inserting.
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[60vh] overflow-y-auto px-6 pb-2 flex flex-col gap-4">
        {fields.length === 0 ? (
          <p className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5 text-xs text-ink">
            This snippet has no fields yet. Add a Text, Number, Date/Time or Choice field from
            the side panel, then come back here.
          </p>
        ) : (
          <>
            <ExampleBox>
              A page that says <span className="font-mono">Order number: 4471</span> fills a
              field set to <span className="font-mono">Order number</span> with{' '}
              <ExampleResult>4471</ExampleResult>.
            </ExampleBox>

            <ul ref={listRef} className="flex flex-col gap-2" aria-label="Fields in this snippet">
              {fields.map((field) => {
                const draft = drafts[field.key] ?? draftOf(field);
                const id = `fill-page-${field.key.replace(/[^A-Za-z0-9_]/g, '_')}`;
                const text = MODE_TEXT[draft.mode];
                return (
                  <li key={field.key} className="rounded-[10px] border border-line bg-card px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-mono text-xs font-semibold text-ink" title={field.title}>
                        {field.title}
                      </span>
                      <span className="truncate text-[11px] text-ink-subtle" title={field.detail}>
                        {field.detail}
                      </span>
                    </div>

                    {/* Only where there is a choice to make: a lone option
                        reads as a question with one answer. */}
                    {field.modes.length > 1 && (
                      <Segmented
                        options={MODE_OPTIONS.filter((o) => field.modes.includes(o.value))}
                        value={draft.mode}
                        onChange={(mode) => setDraft(field.key, { ...draft, mode })}
                        ariaLabel={`How ${field.title} is read from the page`}
                        className="mt-2 w-full [&>button]:flex-1"
                      />
                    )}

                    <label htmlFor={id} className="mt-2 block text-[11px] font-medium text-ink-muted">
                      {text.label}
                    </label>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Input
                        id={id}
                        value={draft.words}
                        onChange={(e) => setDraft(field.key, { ...draft, words: cleanWords(e.target.value) })}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          handleSave();
                        }}
                        placeholder={text.placeholder}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-9 rounded-[10px]"
                      />
                      {draft.words !== '' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Clear ${field.title}`}
                          title="Clear"
                          onClick={() => setDraft(field.key, { ...draft, words: '' })}
                          className="shrink-0"
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </Button>
                      )}
                    </div>
                    {draft.mode === 'before' && (
                      <p className={HINT}>
                        Every number right before it is added up: 2 Boxes and 1 Box makes 3. A
                        page that never mentions it leaves the field&apos;s default.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className={HINT}>
              Type the words as the page shows them. Capitals and accents don&apos;t matter.
              For another spelling, add it after a |, like Start date|Starts. Leave a box
              empty to fill that field by hand. Works with public pages that open without
              signing in.
            </p>
          </>
        )}
      </div>

      <div className="px-6 py-4 mt-2 border-t border-line flex items-center justify-between gap-2">
        <p className="text-xs text-ink-subtle" aria-live="polite">
          {fields.length > 0 &&
            `${filled} of ${fields.length} ${fields.length === 1 ? 'field fills' : 'fields fill'} from the page`}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {fields.length === 0 ? 'Close' : 'Cancel'}
          </Button>
          {fields.length > 0 && (
            <Button type="button" variant="primary" onClick={handleSave}>
              Save
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
