import { beforeEach, describe, expect, it, vi } from 'vitest';

// The org chart's data layer: departments are written straight to
// `org_departments` under row security (admins only), and a person's place
// goes through the `set_member_placement` RPC. These cover what each wrapper
// sends, how it reads the reply, and that a refusal reaches the screen as
// words instead of passing as done.

interface TableCall {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
  columns?: string;
}

interface Reply {
  data: unknown;
  error: { message: string; code?: string } | null;
}

const tableCalls: TableCall[] = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let tableReply: Reply = { data: [], error: null };
let rpcReply: Reply = { data: null, error: null };

function builder(table: string) {
  const call: TableCall = { table, op: 'select', filters: [] };
  tableCalls.push(call);
  const chain = {
    select(columns: string) {
      call.columns = columns;
      return chain;
    },
    insert(payload: unknown) {
      call.op = 'insert';
      call.payload = payload;
      return chain;
    },
    update(payload: unknown) {
      call.op = 'update';
      call.payload = payload;
      return chain;
    },
    delete() {
      call.op = 'delete';
      return chain;
    },
    eq(column: string, value: unknown) {
      call.filters.push([column, value]);
      return chain;
    },
    order() {
      return chain;
    },
    single() {
      return chain;
    },
    then(resolve: (reply: Reply) => unknown) {
      return Promise.resolve(tableReply).then(resolve);
    },
  };
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcReply);
    },
  },
}));

const { orgApi } = await import('@/lib/api/orgApi');

beforeEach(() => {
  tableCalls.length = 0;
  rpcCalls.length = 0;
  tableReply = { data: [], error: null };
  rpcReply = { data: null, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('orgApi.listMembers', () => {
  it('reads each person with their department, job title and lead mark', async () => {
    rpcReply = {
      data: [
        {
          user_id: 'u1',
          email: 'ada@example.com',
          display_name: 'Ada',
          role: 'admin',
          avatar_url: 'https://example.com/a.png',
          department_id: 'd1',
          job_title: 'Office manager',
          is_department_lead: true,
        },
      ],
      error: null,
    };
    const [ada] = await orgApi.listMembers('org-1');
    expect(rpcCalls[0]).toEqual({ fn: 'org_member_directory', args: { p_org: 'org-1' } });
    expect(ada).toMatchObject({
      department_id: 'd1',
      job_title: 'Office manager',
      is_department_lead: true,
    });
  });

  it('reads a reply without the new columns as nobody placed', async () => {
    rpcReply = {
      data: [{ user_id: 'u1', email: 'ada@example.com', display_name: 'Ada', role: 'member', avatar_url: null }],
      error: null,
    };
    const [ada] = await orgApi.listMembers('org-1');
    expect(ada).toMatchObject({ department_id: null, job_title: null, is_department_lead: false });
  });
});

describe('orgApi departments', () => {
  it('lists the departments of one team', async () => {
    tableReply = { data: [{ id: 'd1', name: 'Sales' }], error: null };
    const list = await orgApi.listDepartments('org-1');
    expect(list).toEqual([{ id: 'd1', name: 'Sales' }]);
    expect(tableCalls[0]).toMatchObject({
      table: 'org_departments',
      op: 'select',
      columns: 'id, name',
      filters: [['organization_id', 'org-1']],
    });
  });

  it('adds a department with the team and the tidied name, and nothing else', async () => {
    tableReply = { data: { id: 'd1', name: 'Customer support' }, error: null };
    const made = await orgApi.addDepartment('org-1', '  Customer   support ');
    expect(made).toEqual({ id: 'd1', name: 'Customer support' });
    // The database grants insert on these two columns only.
    expect(tableCalls[0]?.payload).toEqual({ organization_id: 'org-1', name: 'Customer support' });
  });

  it('says a name is taken in plain words', async () => {
    tableReply = { data: null, error: { code: '23505', message: 'duplicate key value' } };
    await expect(orgApi.addDepartment('org-1', 'Sales')).rejects.toThrow(
      'You already have a department with that name.',
    );
    await expect(orgApi.renameDepartment('d1', 'Sales')).rejects.toThrow(
      'You already have a department with that name.',
    );
  });

  it('renames by id and sends the name only', async () => {
    tableReply = { data: [{ id: 'd1' }], error: null };
    await orgApi.renameDepartment('d1', ' Legal ');
    expect(tableCalls[0]).toMatchObject({ op: 'update', payload: { name: 'Legal' }, filters: [['id', 'd1']] });
  });

  it('removes by id', async () => {
    tableReply = { data: [{ id: 'd1' }], error: null };
    await orgApi.removeDepartment('d1');
    expect(tableCalls[0]).toMatchObject({ op: 'delete', filters: [['id', 'd1']] });
  });

  it('reports a write that matched no row instead of passing as done', async () => {
    // Row security matches nothing for someone who is not an admin.
    tableReply = { data: [], error: null };
    await expect(orgApi.renameDepartment('d1', 'Legal')).rejects.toThrow(
      'Only a team admin can change departments.',
    );
    await expect(orgApi.removeDepartment('d1')).rejects.toThrow(
      'Only a team admin can change departments.',
    );
  });
});

describe('orgApi.setMemberPlacement', () => {
  it('sends the department, the tidied title and the lead choice', async () => {
    await orgApi.setMemberPlacement('org-1', 'u2', {
      departmentId: 'd1',
      jobTitle: '  Account   manager ',
      lead: true,
    });
    expect(rpcCalls[0]).toEqual({
      fn: 'set_member_placement',
      args: { p_org: 'org-1', p_user: 'u2', p_department: 'd1', p_job_title: 'Account manager', p_lead: true },
    });
  });

  it('leaves the lead out when the caller is not choosing one', async () => {
    // What a person editing their own place sends: the saved mark must stay.
    await orgApi.setMemberPlacement('org-1', 'u1', { departmentId: null, jobTitle: '' });
    expect(rpcCalls[0]?.args).toEqual({
      p_org: 'org-1',
      p_user: 'u1',
      p_department: null,
      p_job_title: null,
    });
  });

  it('sends false when an admin takes the lead mark away', async () => {
    await orgApi.setMemberPlacement('org-1', 'u2', { departmentId: 'd1', jobTitle: null, lead: false });
    expect(rpcCalls[0]?.args.p_lead).toBe(false);
  });

  it("keeps the function's own wording for a refusal", async () => {
    rpcReply = { data: null, error: { code: '22023', message: 'That department no longer exists' } };
    await expect(
      orgApi.setMemberPlacement('org-1', 'u2', { departmentId: 'gone', jobTitle: null }),
    ).rejects.toThrow('That department no longer exists');
  });
});
