import { useId, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { PlacementFields } from '@/features/org/PlacementFields';
import { memberName, normalizeJobTitle, validateJobTitle } from '@/lib/orgChart';
import { useOrgStore } from '@/stores/orgStore';
import { useUiStore } from '@/stores/uiStore';
import type { MemberPlacement, OrgDepartment, OrgMember } from '@/types/database';

interface MemberPlacementDialogProps {
  /** The person being edited, or null while the window is closed. */
  member: OrgMember | null;
  /** True when that person is the one signed in. */
  isSelf: boolean;
  /** Admins also choose the department's lead. */
  isAdmin: boolean;
  onClose: () => void;
  /** Puts the keyboard focus back on whatever opened the window. */
  onRestoreFocus: () => void;
}

/**
 * The person window on the Team page: one person's department and job title,
 * and for admins whether they lead that department. Admins open it on anyone,
 * everyone else on themselves.
 */
export function MemberPlacementDialog({
  member,
  isSelf,
  isAdmin,
  onClose,
  onRestoreFocus,
}: MemberPlacementDialogProps) {
  const departments = useOrgStore((s) => s.departments);
  const members = useOrgStore((s) => s.members);

  return (
    <Dialog open={member !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        {/* Mounted per person, so the form always opens on what is saved. */}
        {member && (
          <PlacementForm
            key={member.user_id}
            member={member}
            members={members}
            departments={departments}
            isSelf={isSelf}
            isAdmin={isAdmin}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface PlacementFormProps {
  member: OrgMember;
  members: OrgMember[];
  departments: OrgDepartment[];
  isSelf: boolean;
  isAdmin: boolean;
  onClose: () => void;
}

function PlacementForm({
  member,
  members,
  departments,
  isSelf,
  isAdmin,
  onClose,
}: PlacementFormProps) {
  const setMemberPlacement = useOrgStore((s) => s.setMemberPlacement);
  const showToast = useUiStore((s) => s.showToast);
  const leadLabelId = useId();

  const [departmentId, setDepartmentId] = useState<string | null>(member.department_id);
  const [jobTitle, setJobTitle] = useState(member.job_title ?? '');
  const [lead, setLead] = useState(member.is_department_lead);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = memberName(member);
  const department = departments.find((d) => d.id === departmentId) ?? null;
  // Whoever leads the chosen department today, when it is somebody else.
  const otherLead =
    department === null
      ? null
      : (members.find(
          (m) =>
            m.department_id === department.id &&
            m.is_department_lead &&
            m.user_id !== member.user_id,
        ) ?? null);

  const titleError = validateJobTitle(jobTitle);
  const dirty =
    departmentId !== member.department_id ||
    normalizeJobTitle(jobTitle) !== member.job_title ||
    (isAdmin && (department !== null && lead) !== member.is_department_lead);

  function chooseDepartment(next: string | null) {
    setDepartmentId(next);
    // The mark belongs to a department: it carries over only when the person
    // stays where they already lead.
    setLead(next !== null && next === member.department_id && member.is_department_lead);
  }

  function leadHelp(): string {
    if (department === null) return 'Choose a department first.';
    if (otherLead === null) return `Shown first in ${department.name}, with a Lead tag.`;
    const current = memberName(otherLead);
    return lead ? `Replaces ${current} as lead.` : `${current} leads ${department.name} now.`;
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (saving || !dirty || titleError) return;
    const placement: MemberPlacement = { departmentId, jobTitle };
    if (isAdmin) placement.lead = department !== null && lead;

    setSaving(true);
    setError(null);
    try {
      await setMemberPlacement(member.user_id, placement);
      showToast(isSelf ? 'Saved.' : `${name} updated.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Try again.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{isSelf ? 'Your department and job title' : `Edit ${name}`}</DialogTitle>
        <DialogDescription>
          Everyone in the team sees this on the Team page.
        </DialogDescription>
      </DialogHeader>

      <PlacementFields
        idPrefix="member-placement"
        departments={departments}
        departmentId={departmentId}
        jobTitle={jobTitle}
        onDepartmentChange={chooseDepartment}
        onJobTitleChange={setJobTitle}
        disabled={saving}
        emptyHint={
          isAdmin
            ? 'No departments yet. Close this window and click Departments to add them.'
            : 'Your team has no departments yet.'
        }
      />

      {isAdmin && (
        <div className="flex items-center justify-between gap-3 rounded-[12px] border border-line px-3 py-2.5">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span id={leadLabelId} className="text-sm font-medium text-ink">
              Lead of this department
            </span>
            <span className="text-xs text-ink-subtle">{leadHelp()}</span>
          </span>
          <Switch
            checked={department !== null && lead}
            onChange={setLead}
            disabled={saving || department === null}
            aria-labelledby={leadLabelId}
          />
        </div>
      )}

      {(error ?? titleError) && (
        <p role="alert" className="text-xs text-danger">
          {error ?? titleError}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !dirty || titleError !== null}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save
        </Button>
      </div>
    </form>
  );
}
