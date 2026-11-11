import { describe, expect, it } from 'vitest';
import {
  countByDepartment,
  DEPARTMENT_LIMIT,
  DEPARTMENT_NAME_MAX,
  groupByDepartment,
  hasOwnName,
  JOB_TITLE_MAX,
  memberName,
  normalizeDepartmentName,
  normalizeJobTitle,
  peopleCount,
  STARTER_DEPARTMENTS,
  suggestedDepartments,
  validateDepartmentName,
  validateJobTitle,
} from '@/lib/orgChart';
import type { OrgDepartment, OrgMember } from '@/types/database';

// The org chart on the Team page: what groups it shows, in which order, and
// which names and titles it accepts. The page and its two windows only draw
// what these decide.

function member(id: string, name: string, patch: Partial<OrgMember> = {}): OrgMember {
  return {
    user_id: id,
    email: `${id}@example.com`,
    display_name: name,
    role: 'member',
    avatar_url: null,
    department_id: null,
    job_title: null,
    is_department_lead: false,
    ...patch,
  };
}

const sales: OrgDepartment = { id: 'd-sales', name: 'Sales' };
const legal: OrgDepartment = { id: 'd-legal', name: 'legal' };
const admin: OrgDepartment = { id: 'd-admin', name: 'Administration' };

describe('groupByDepartment', () => {
  it('lists departments by name, ignoring case, then the people without one', () => {
    const groups = groupByDepartment(
      [member('a', 'Ada', { department_id: sales.id }), member('b', 'Bo')],
      [sales, legal, admin],
    );
    expect(groups.map((g) => g.department?.name ?? null)).toEqual([
      'Administration',
      'legal',
      'Sales',
      null,
    ]);
  });

  it('puts the lead first, then everyone else by name', () => {
    const groups = groupByDepartment(
      [
        member('z', 'Zed', { department_id: sales.id }),
        member('m', 'Mia', { department_id: sales.id, is_department_lead: true }),
        member('a', 'ada', { department_id: sales.id }),
      ],
      [sales],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((m) => m.display_name)).toEqual(['Mia', 'ada', 'Zed']);
    expect(groups[0]?.lead?.user_id).toBe('m');
  });

  it('keeps a department nobody sits in, so the page can choose to show it', () => {
    const groups = groupByDepartment([member('a', 'Ada', { department_id: sales.id })], [sales, legal]);
    expect(groups.find((g) => g.department?.id === legal.id)?.members).toEqual([]);
  });

  it('leaves out the no-department group when everyone is placed', () => {
    const groups = groupByDepartment([member('a', 'Ada', { department_id: sales.id })], [sales]);
    expect(groups.some((g) => g.department === null)).toBe(false);
  });

  it('counts someone pointing at a department that is gone as having none', () => {
    const groups = groupByDepartment([member('a', 'Ada', { department_id: 'd-removed' })], [sales]);
    expect(groups.at(-1)?.department).toBeNull();
    expect(groups.at(-1)?.members.map((m) => m.user_id)).toEqual(['a']);
  });

  it('places every person exactly once', () => {
    const people = [
      member('a', 'Ada', { department_id: sales.id }),
      member('b', 'Bo', { department_id: legal.id, is_department_lead: true }),
      member('c', 'Cy'),
      member('d', 'Di', { department_id: 'd-removed' }),
    ];
    const placed = groupByDepartment(people, [sales, legal]).flatMap((g) => g.members);
    expect(placed.map((m) => m.user_id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts a person with no name by their email', () => {
    const groups = groupByDepartment(
      [member('zoe', ''), member('amy', '   '), member('m', 'Mia')],
      [sales],
    );
    expect(groups.at(-1)?.members.map((m) => m.user_id)).toEqual(['amy', 'm', 'zoe']);
  });
});

describe('department names', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeDepartmentName('  Customer   support ')).toBe('Customer support');
  });

  it('refuses an empty name, a long name and a name already used in any case', () => {
    expect(validateDepartmentName('   ', [])).toBe('Give the department a name.');
    expect(validateDepartmentName('x'.repeat(DEPARTMENT_NAME_MAX + 1), [])).toContain(
      `${DEPARTMENT_NAME_MAX} characters`,
    );
    expect(validateDepartmentName(' SALES ', [sales])).toBe(
      'You already have a department called SALES.',
    );
  });

  it('accepts a name at the limit and a new name', () => {
    expect(validateDepartmentName('x'.repeat(DEPARTMENT_NAME_MAX), [sales])).toBeNull();
    expect(validateDepartmentName('Finance', [sales])).toBeNull();
  });

  it('lets a department keep its own name when renamed, but not take another', () => {
    expect(validateDepartmentName('sales', [sales, legal], sales.id)).toBeNull();
    expect(validateDepartmentName('Legal', [sales, legal], sales.id)).toBe(
      'You already have a department called Legal.',
    );
  });

  it('stops new departments at the cap, while renames still work', () => {
    const full = Array.from({ length: DEPARTMENT_LIMIT }, (_, i) => ({ id: `d${i}`, name: `Team ${i}` }));
    expect(validateDepartmentName('One more', full)).toContain(`${DEPARTMENT_LIMIT} departments`);
    expect(validateDepartmentName('Renamed', full, 'd0')).toBeNull();
  });
});

describe('suggestedDepartments', () => {
  it('offers the whole starter list to a team with none', () => {
    expect(suggestedDepartments([])).toEqual([...STARTER_DEPARTMENTS]);
  });

  it('drops the names a team already uses, in any case', () => {
    const left = suggestedDepartments([sales, legal]);
    expect(left).not.toContain('Sales');
    expect(left).not.toContain('Legal');
    expect(left).toHaveLength(STARTER_DEPARTMENTS.length - 2);
  });

  it('ships only names that fit any kind of business and the name limit', () => {
    for (const name of STARTER_DEPARTMENTS) {
      expect(validateDepartmentName(name, [])).toBeNull();
      expect(name).not.toMatch(/guest|booking|reservation|property|check-?in|stay|night/i);
    }
  });
});

describe('job titles', () => {
  it('stores an empty title as none and tidies the rest', () => {
    expect(normalizeJobTitle(null)).toBeNull();
    expect(normalizeJobTitle('   ')).toBeNull();
    expect(normalizeJobTitle('  Office   manager ')).toBe('Office manager');
  });

  it('allows no title and a title at the limit, and refuses a longer one', () => {
    expect(validateJobTitle('')).toBeNull();
    expect(validateJobTitle('x'.repeat(JOB_TITLE_MAX))).toBeNull();
    expect(validateJobTitle('x'.repeat(JOB_TITLE_MAX + 1))).toContain(`${JOB_TITLE_MAX} characters`);
  });
});

describe('names and counts', () => {
  it('shows a person by their name, or their email when they have none', () => {
    expect(memberName(member('a', 'Ada'))).toBe('Ada');
    expect(memberName(member('a', '  '))).toBe('a@example.com');
  });

  it('does not count the email standing in as a name', () => {
    expect(hasOwnName(member('a', 'Ada'))).toBe(true);
    expect(hasOwnName(member('a', 'A@Example.com'))).toBe(false);
    expect(hasOwnName(member('a', ''))).toBe(false);
  });

  it('counts the people in each department', () => {
    const counts = countByDepartment([
      member('a', 'Ada', { department_id: sales.id }),
      member('b', 'Bo', { department_id: sales.id }),
      member('c', 'Cy'),
    ]);
    expect(counts.get(sales.id)).toBe(2);
    expect(counts.has(legal.id)).toBe(false);
  });

  it('says one person and several people', () => {
    expect(peopleCount(1)).toBe('1 person');
    expect(peopleCount(3)).toBe('3 people');
  });
});
