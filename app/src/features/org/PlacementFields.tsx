import { Input } from '@/components/ui/input';
import { JOB_TITLE_MAX } from '@/lib/orgChart';
import { cn } from '@/lib/utils';
import type { OrgDepartment } from '@/types/database';

interface PlacementFieldsProps {
  /** Prefix for the two control ids, so two copies never share one. */
  idPrefix: string;
  departments: OrgDepartment[];
  departmentId: string | null;
  jobTitle: string;
  onDepartmentChange: (departmentId: string | null) => void;
  onJobTitleChange: (jobTitle: string) => void;
  disabled?: boolean;
  /** Said under the menu while the team has no departments to choose from. */
  emptyHint: string;
  /** Side by side (Settings) or one under the other (the window). */
  layout?: 'row' | 'stack';
}

/**
 * Where a person sits in a team: their department and their job title. One
 * pair of controls for the person window on the Team page and for Settings,
 * so both read and write the same two facts the same way.
 */
export function PlacementFields({
  idPrefix,
  departments,
  departmentId,
  jobTitle,
  onDepartmentChange,
  onJobTitleChange,
  disabled = false,
  emptyHint,
  layout = 'stack',
}: PlacementFieldsProps) {
  const departmentFieldId = `${idPrefix}-department`;
  const titleFieldId = `${idPrefix}-job-title`;
  const noDepartments = departments.length === 0;
  // A department removed while this was open reads as none.
  const value = departments.some((d) => d.id === departmentId) ? (departmentId ?? '') : '';

  return (
    <div className={cn('grid gap-4', layout === 'row' && 'grid-cols-2')}>
      <div className="grid content-start gap-1.5">
        <label htmlFor={departmentFieldId} className="text-xs font-medium text-ink-muted">
          Department
        </label>
        <select
          id={departmentFieldId}
          value={value}
          onChange={(e) => onDepartmentChange(e.target.value === '' ? null : e.target.value)}
          disabled={disabled || noDepartments}
          className="h-10 w-full rounded-[12px] border border-line bg-card px-3 text-sm text-ink outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">No department</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
        {noDepartments && <span className="text-xs text-ink-subtle">{emptyHint}</span>}
      </div>

      <div className="grid content-start gap-1.5">
        <label htmlFor={titleFieldId} className="text-xs font-medium text-ink-muted">
          Job title
        </label>
        <Input
          id={titleFieldId}
          value={jobTitle}
          onChange={(e) => onJobTitleChange(e.target.value)}
          maxLength={JOB_TITLE_MAX}
          disabled={disabled}
          placeholder="For example, Office manager"
          autoComplete="organization-title"
        />
      </div>
    </div>
  );
}
