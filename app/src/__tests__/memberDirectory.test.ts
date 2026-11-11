import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Team page reads its people through org_member_directory() and its
// departments from org_departments. The dashboard reads the rows by column
// name (orgApi.listMembers), so these pin what the latest migration that
// defines them hands out, who may read it and who may write it.

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../../../services/supabase/migrations/20261111120000_org_chart.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
// The directory function itself; the comments above it may name old keys.
const directory = sql.slice(sql.indexOf('create function public.org_member_directory'));
const placement = sql.slice(
  sql.indexOf('create function public.set_member_placement'),
  sql.indexOf('drop function if exists public.org_member_directory'),
);

describe('org_member_directory', () => {
  it('returns identity, photo, department, job title and lead mark', () => {
    const columns = directory.slice(directory.indexOf('returns table'), directory.indexOf('language sql'));
    expect(columns.replace(/\s+/g, ' ')).toContain(
      '( user_id uuid, email text, display_name text, role org_role, avatar_url text, department_id uuid, job_title text, is_department_lead boolean )',
    );
  });

  it('hands out only https photo addresses', () => {
    expect(directory).toContain("u.raw_user_meta_data->>'avatar_url' like 'https://%'");
  });

  it('names people by the keys Settings and Google sign-in write, then the email', () => {
    expect(directory).toMatch(/'full_name'[\s\S]*'name'[\s\S]*u\.email\s*\)/);
    expect(directory).not.toContain("'display_name'");
  });

  it('marks a lead only in the department the person sits in', () => {
    expect(directory).toContain('left join org_departments d on d.id = m.department_id');
    expect(directory).toContain('coalesce(d.lead_user_id = m.user_id, false)');
  });

  it('stays for co-members only, signed in', () => {
    expect(directory).toContain('app.is_org_member(p_org)');
    expect(sql).toContain(
      'revoke execute on function public.org_member_directory(uuid) from public, anon;',
    );
  });
});

describe('org_departments', () => {
  it('is read by the team and written by its admins', () => {
    expect(sql).toContain('alter table public.org_departments enable row level security;');
    expect(sql).toMatch(/create policy orgdept_select[\s\S]*?using \(app\.is_org_member\(organization_id\)\);/);
    for (const policy of ['orgdept_insert', 'orgdept_update', 'orgdept_delete']) {
      expect(sql).toMatch(
        new RegExp(`create policy ${policy}[\\s\\S]*?app\\.org_role\\(organization_id\\) = 'admin'`),
      );
    }
  });

  it('lets the API write the name only, never the lead', () => {
    expect(sql).toContain('revoke all on public.org_departments from anon, authenticated;');
    expect(sql).toContain('grant insert (organization_id, name) on public.org_departments to authenticated;');
    expect(sql).toContain('grant update (name) on public.org_departments to authenticated;');
    expect(sql).not.toMatch(/grant[^;]*lead_user_id[^;]*to authenticated/);
  });

  it('keeps both links inside one team, and clears them instead of deleting', () => {
    expect(sql).toMatch(
      /foreign key \(organization_id, department_id\)\s+references public\.org_departments \(organization_id, id\)\s+on delete set null \(department_id\)/,
    );
    expect(sql).toMatch(
      /foreign key \(organization_id, lead_user_id\)\s+references public\.organization_members \(organization_id, user_id\)\s+on delete set null \(lead_user_id\)/,
    );
  });

  it('treats a name in another case as the same department', () => {
    expect(sql).toContain('on public.org_departments (organization_id, lower(name));');
  });
});

describe('set_member_placement', () => {
  it('is for signed-in people only', () => {
    expect(sql).toContain(
      'revoke execute on function public.set_member_placement(uuid, uuid, uuid, text, boolean) from public, anon;',
    );
  });

  it('lets an admin place anyone and everyone else only themself', () => {
    expect(placement).toContain("v_role <> 'admin' and p_user is distinct from v_caller");
  });

  it('keeps choosing a lead for admins', () => {
    expect(placement).toContain("p_lead is not null and v_role <> 'admin'");
  });

  it('writes the department and the job title, never the role', () => {
    const update = placement.slice(
      placement.indexOf('update organization_members'),
      placement.indexOf('if not found'),
    );
    expect(update).toContain('department_id = p_department');
    expect(update).toContain('job_title = v_title');
    expect(update).not.toContain('role');
  });

  it('refuses a department of another team', () => {
    expect(placement).toContain('d.id = p_department and d.organization_id = p_org');
  });
});
