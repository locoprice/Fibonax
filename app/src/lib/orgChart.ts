import type { OrgDepartment, OrgMember } from '@/types/database';

// The org chart on the Team page: people grouped by department. Everything
// that decides what the chart shows lives here, so the page, the two windows
// and Settings only draw it.

/** Same limits the database holds (`org_departments`, `organization_members`). */
export const DEPARTMENT_NAME_MAX = 40;
export const JOB_TITLE_MAX = 60;

/** A sanity cap, far past what a real team needs. */
export const DEPARTMENT_LIMIT = 34;

/**
 * Names offered when a team adds its departments. Suggestions only: nothing
 * is created until an admin picks one, and a team can type its own.
 */
export const STARTER_DEPARTMENTS: readonly string[] = [
  'Accounting',
  'Administration',
  'Customer support',
  'Engineering',
  'Human resources',
  'Legal',
  'Marketing',
  'Operations',
  'Sales',
];

/** Trim and collapse runs of spaces, the way the name is stored. */
export function normalizeDepartmentName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Why a department name cannot be saved, or null when it can. `exceptId` is
 * the department being renamed, so keeping its own name is not a clash.
 */
export function validateDepartmentName(
  raw: string,
  departments: readonly OrgDepartment[],
  exceptId: string | null = null,
): string | null {
  const name = normalizeDepartmentName(raw);
  if (name === '') return 'Give the department a name.';
  if (name.length > DEPARTMENT_NAME_MAX) {
    return `Department names are ${DEPARTMENT_NAME_MAX} characters or fewer.`;
  }
  const taken = departments.some(
    (d) => d.id !== exceptId && d.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) return `You already have a department called ${name}.`;
  if (exceptId === null && departments.length >= DEPARTMENT_LIMIT) {
    return `A team can have ${DEPARTMENT_LIMIT} departments at most.`;
  }
  return null;
}

/** The starter names this team has not used yet. */
export function suggestedDepartments(departments: readonly OrgDepartment[]): string[] {
  const used = new Set(departments.map((d) => d.name.toLowerCase()));
  return STARTER_DEPARTMENTS.filter((name) => !used.has(name.toLowerCase()));
}

/** A job title as it is stored: trimmed, single spaces, null when empty. */
export function normalizeJobTitle(raw: string | null): string | null {
  const title = (raw ?? '').replace(/\s+/g, ' ').trim();
  return title === '' ? null : title;
}

/** Why a job title cannot be saved, or null when it can. Empty is allowed. */
export function validateJobTitle(raw: string | null): string | null {
  const title = normalizeJobTitle(raw);
  if (title !== null && title.length > JOB_TITLE_MAX) {
    return `Job titles are ${JOB_TITLE_MAX} characters or fewer.`;
  }
  return null;
}

/**
 * The name a person is shown by. The directory falls back to the email when
 * no name is set, so only a real name counts as one.
 */
export function memberName(member: Pick<OrgMember, 'display_name' | 'email'>): string {
  const name = member.display_name.trim();
  return name !== '' ? name : member.email;
}

/** True when the person has a name of their own, not just their email. */
export function hasOwnName(member: Pick<OrgMember, 'display_name' | 'email'>): boolean {
  const name = member.display_name.trim();
  return name !== '' && name.toLowerCase() !== member.email.toLowerCase();
}

function byName(a: OrgMember, b: OrgMember): number {
  return memberName(a).localeCompare(memberName(b), undefined, { sensitivity: 'base' });
}

/** Sort departments by name, ignoring case. */
export function sortDepartments(departments: readonly OrgDepartment[]): OrgDepartment[] {
  return [...departments].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

/** One block of the chart: a department with its people, or the people without one. */
export interface DepartmentGroup {
  /** Null for the people who have no department yet. */
  department: OrgDepartment | null;
  /** The lead first, then everyone else by name. */
  members: OrgMember[];
  lead: OrgMember | null;
}

/**
 * The chart: one group per department in name order, then the people with no
 * department, when there are any. A department nobody sits in still gets its
 * group, so the page can decide whether to show it. Someone pointing at a
 * department that is no longer in the list counts as having none.
 */
export function groupByDepartment(
  members: readonly OrgMember[],
  departments: readonly OrgDepartment[],
): DepartmentGroup[] {
  const known = new Set(departments.map((d) => d.id));
  const groups: DepartmentGroup[] = sortDepartments(departments).map((department) => {
    const people = members.filter((m) => m.department_id === department.id);
    const lead = people.find((m) => m.is_department_lead) ?? null;
    const rest = people.filter((m) => m !== lead).sort(byName);
    return { department, members: lead ? [lead, ...rest] : rest, lead };
  });

  const unplaced = members
    .filter((m) => m.department_id === null || !known.has(m.department_id))
    .sort(byName);
  if (unplaced.length > 0) groups.push({ department: null, members: unplaced, lead: null });
  return groups;
}

/** How many people sit in each department, by department id. */
export function countByDepartment(members: readonly OrgMember[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of members) {
    if (m.department_id === null) continue;
    counts.set(m.department_id, (counts.get(m.department_id) ?? 0) + 1);
  }
  return counts;
}

/** "1 person", "3 people". */
export function peopleCount(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}
