// delete-account: Supabase Edge Function (Deno)
// Deletes the calling user's account, then their files.
//
// The account is always the caller's own, read from the verified JWT. The
// function accepts no user parameter, so it cannot delete anyone else.
//
// 1. public.delete_account(uid), one transaction: team items handed to another
//    admin, teams with no other admin deleted, then the auth.users row, which
//    cascades to everything personal. See
//    services/supabase/migrations/20261018120000_delete_account.sql.
// 2. Storage: the person's folder in avatars, company-logos and memory-docs,
//    and the cover folder of each team step 1 deleted. This runs after the
//    database commit, because a failed delete must leave every file in place.
//    A file that will not go is logged with its bucket and path for cleanup;
//    the account is already gone, so the caller still gets success.
//
// Environment secrets (all injected automatically by the runtime):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const USER_BUCKETS = ['avatars', 'company-logos', 'memory-docs'];
const TEAM_COVER_BUCKET = 'team-covers';
const LIST_PAGE = 1000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Remove every object directly under `<folder>/`. Returns the paths that failed. */
async function emptyFolder(
  client: SupabaseClient,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const failed: string[] = [];
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(folder, { limit: LIST_PAGE });
    if (error) {
      console.error(`delete-account: could not list ${bucket}/${folder}: ${error.message}`);
      return [`${folder}/*`];
    }
    const paths = (data ?? []).map((o) => `${folder}/${o.name}`);
    if (paths.length === 0) return failed;
    const { error: removeError } = await client.storage.from(bucket).remove(paths);
    if (removeError) {
      console.error(`delete-account: could not remove from ${bucket}: ${removeError.message}`, paths);
      return failed.concat(paths);
    }
    if (paths.length < LIST_PAGE) return failed;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'unauthorized' }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'unauthorized' }, 401);
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: deletedTeams, error: deleteError } = await serviceClient.rpc('delete_account', {
    p_user: user.id,
  });
  if (deleteError) {
    console.error(`delete-account: database delete failed for ${user.id}: ${deleteError.message}`);
    return json({ error: 'delete_failed' }, 500);
  }

  const leftovers: string[] = [];
  for (const bucket of USER_BUCKETS) {
    for (const path of await emptyFolder(serviceClient, bucket, user.id)) {
      leftovers.push(`${bucket}/${path}`);
    }
  }
  for (const teamId of (deletedTeams ?? []) as string[]) {
    for (const path of await emptyFolder(serviceClient, TEAM_COVER_BUCKET, teamId)) {
      leftovers.push(`${TEAM_COVER_BUCKET}/${path}`);
    }
  }
  if (leftovers.length > 0) {
    console.error(`delete-account: account ${user.id} deleted, files left for cleanup`, leftovers);
  }

  return json({ deleted: true }, 200);
});
