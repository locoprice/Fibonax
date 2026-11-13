import { useMemo, useRef, useState } from 'react';
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
import { RowButton } from '@/features/org/InviteMemberPanel';
import {
  countByDepartment,
  DEPARTMENT_NAME_MAX,
  normalizeDepartmentName,
  peopleCount,
  suggestedDepartments,
  validateDepartmentName,
} from '@/lib/orgChart';
import { useOrgStore } from '@/stores/orgStore';
import { useUiStore } from '@/stores/uiStore';
import type { OrgDepartment } from '@/types/database';

interface DepartmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Puts the keyboard focus back on whatever opened the window. */
  onRestoreFocus: () => void;
}

/**
 * The Departments window on the Team page (admins): add a department by
 * typing its name or picking a common one, rename it, remove it. Who sits
 * where is chosen on each person, not here.
 */
export function DepartmentsDialog({ open, onOpenChange, onRestoreFocus }: DepartmentsDialogProps) {
  const orgName = useOrgStore((s) => s.activeOrg?.name ?? 'your team');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Departments</DialogTitle>
          <DialogDescription>
            Group the people in {orgName} by what they do. Everyone in the team sees the groups.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so a closed window forgets its draft. */}
        {open && <DepartmentsManager />}
      </DialogContent>
    </Dialog>
  );
}

function DepartmentsManager() {
  const departments = useOrgStore((s) => s.departments);
  const members = useOrgStore((s) => s.members);
  const addDepartment = useOrgStore((s) => s.addDepartment);

  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => countByDepartment(members), [members]);
  const suggestions = useMemo(() => suggestedDepartments(departments), [departments]);

  async function add(name: string, fromDraft: boolean) {
    if (adding) return;
    const message = validateDepartmentName(name, departments);
    if (message) {
      setError(message);
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await addDepartment(name);
      if (fromDraft) setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the department. Try again.');
    } finally {
      setAdding(false);
      // Back to the box either way, ready for the next name.
      draftRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            ref={draftRef}
            value={draft}
            maxLength={DEPARTMENT_NAME_MAX}
            aria-label="New department name"
            placeholder="New department"
            // Read-only, not disabled, while a name is being added: a disabled
            // box drops the keyboard focus and the next name could not be typed.
            readOnly={adding}
            autoFocus
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add(draft, true);
              }
            }}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={() => void add(draft, true)}
            disabled={adding || normalizeDepartmentName(draft) === ''}
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Add
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-ink-subtle">Or pick a common one:</p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Common departments">
              {suggestions.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    disabled={adding}
                    onClick={() => void add(name, false)}
                    aria-label={`Add ${name}`}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-card px-3 text-xs font-medium text-ink-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>

      {departments.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-line px-4 py-6 text-center text-sm text-ink-subtle">
          No departments yet. Add one above, then click the pencil beside a person to choose
          theirs.
        </p>
      ) : (
        <ul className="flex max-h-[46vh] flex-col divide-y divide-line overflow-y-auto rounded-[12px] border border-line">
          {departments.map((department) => (
            <DepartmentRow
              key={department.id}
              department={department}
              people={counts.get(department.id) ?? 0}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

type RowMode = 'view' | 'rename' | 'confirm-remove';

function DepartmentRow({ department, people }: { department: OrgDepartment; people: number }) {
  const departments = useOrgStore((s) => s.departments);
  const renameDepartment = useOrgStore((s) => s.renameDepartment);
  const removeDepartment = useOrgStore((s) => s.removeDepartment);
  const showToast = useUiStore((s) => s.showToast);

  const [mode, setMode] = useState<RowMode>('view');
  const [name, setName] = useState(department.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startRename() {
    setName(department.name);
    setError(null);
    setMode('rename');
  }

  function cancelRename() {
    setError(null);
    setMode('view');
  }

  async function saveName() {
    if (busy) return;
    if (normalizeDepartmentName(name) === department.name) {
      setMode('view');
      return;
    }
    const message = validateDepartmentName(name, departments, department.id);
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await renameDepartment(department.id, name);
      setMode('view');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename it. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeDepartment(department.id);
      showToast(`${department.name} removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove it. Try again.');
      setMode('view');
      setBusy(false);
    }
  }

  if (mode === 'confirm-remove') {
    return (
      // A 5% tint over the card, not the fixed danger-bg, so the sentence
      // stays readable on the dark theme too.
      <li className="flex items-center gap-3 bg-danger/5 px-3 py-2.5">
        <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs text-ink">
          Remove {department.name}?{' '}
          {people === 1 ? 'The person in it stays' : `Its ${people} people stay`} in the team,
          under No department yet.
        </p>
        <RowButton
          onClick={() => setMode('view')}
          disabled={busy}
          label={`Keep ${department.name}`}
        >
          Keep it
        </RowButton>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          aria-label={`Remove ${department.name}`}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] bg-danger px-2.5 text-xs font-semibold text-white transition-colors hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          Remove
        </button>
      </li>
    );
  }

  return (
    <li className="px-3 py-2.5">
      {mode === 'rename' ? (
        <div className="flex items-center gap-2">
          <Input
            value={name}
            maxLength={DEPARTMENT_NAME_MAX}
            aria-label={`New name for ${department.name}`}
            readOnly={busy}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveName();
              }
            }}
            className="h-8 flex-1"
          />
          <Button type="button" size="sm" onClick={() => void saveName()} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={cancelRename}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate text-sm font-medium text-ink">{department.name}</span>
            <span className="shrink-0 text-xs text-ink-subtle">
              {people === 0 ? 'Nobody yet' : peopleCount(people)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <RowButton onClick={startRename} disabled={busy} label={`Rename ${department.name}`}>
              Rename
            </RowButton>
            <RowButton
              onClick={() => (people > 0 ? setMode('confirm-remove') : void remove())}
              disabled={busy}
              label={`Remove ${department.name}`}
              danger
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Remove
            </RowButton>
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
