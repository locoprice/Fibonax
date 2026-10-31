import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Team page shows teammates' photos through org_member_directory(). The
// dashboard reads its rows by column name (orgApi.listMembers), so these pin
// what the migration hands out and that it stays for co-members only.

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../../../services/supabase/migrations/20261028120000_org_member_directory_avatar.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
// The function itself; the comment above it may name the old key.
const body = sql.slice(sql.indexOf('CREATE FUNCTION'));

describe('org_member_directory migration', () => {
  it('returns the photo beside the identity columns', () => {
    expect(sql).toContain(
      'RETURNS TABLE (user_id uuid, email text, display_name text, role org_role, avatar_url text)',
    );
  });

  it('hands out only https photo addresses', () => {
    expect(sql).toContain("u.raw_user_meta_data->>'avatar_url' LIKE 'https://%'");
  });

  it('names people by the keys Settings and Google sign-in write, then the email', () => {
    expect(body).toMatch(/'full_name'[\s\S]*'name'[\s\S]*u\.email\s*\)/);
    expect(body).not.toContain("'display_name'");
  });

  it('stays for co-members only, signed in', () => {
    expect(sql).toContain('app.is_org_member(p_org)');
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.org_member_directory(uuid) FROM PUBLIC, anon;',
    );
  });
});
