-- Context panel: Brain items and prompts, never snippets.
--
-- The Context button listed snippets next to Brain items and they crowded the
-- list. Owner decision, 2026-10-25: the panel offers Brain items and prompts.
--
-- Two changes. Both leave every existing caller exactly as it was.
--
--   1. app.knowledge_index gains a 'prompt' row set: the prompt's name as the
--      title, its content as the body. Still security_invoker, so the prompt
--      policies decide what a caller sees: their own prompts, and prompts in a
--      team folder they can read. Archived prompts are left out, as they are for
--      snippets and Brain items.
--
--   2. knowledge_search returns prompts only when p_kinds names them. A null
--      p_kinds still means snippets and Brain items, so Ask Fibonax and every
--      installed extension behave as they did. Prompts stay out of Ask on
--      purpose: an instruction to run is not knowledge to answer from.
--
-- THE WORD COUNTS STAY WHOLE-LIBRARY. A score weighs how rare a word is across
-- the library, and the gate has a floor of 8.0 that was calibrated on a full
-- one. Choosing kinds before counting would shrink that library to the Brain
-- items alone, and a small Brain would stop matching anything. So every row a
-- caller may see still sets the counts, and p_kinds only chooses which rows come
-- back and compete for the best score. Asking for Brain items and prompts
-- scores them as before, minus the snippet rows.
--
-- Same signature and return type as 20261005120000, so create or replace is
-- enough, and no caller needs an update. Apply before releasing v3.84.3, whose
-- extension asks for Brain items and prompts.

-- The retrieval view

create or replace view app.knowledge_index
with (security_invoker = true) as

  select
    'memory'::text                as kind,
    m.id::text                    as source_id,
    m.name                        as title,
    m.summary                     as summary,
    m.body                        as body,
    coalesce(m.token_estimate, 0) as tokens,
    m.updated_at                  as updated_at,
    m.user_id                     as owner_id,
    array(
      select ml.label_id
      from public.memory_shard_labels ml
      where ml.shard_id = m.id
      order by ml.label_id
    )                             as label_ids,
    m.space_id::text              as container_id,
    coalesce(m.body, '')          as search_text,
    m.review_status               as review_status
  from public.memory_shards m
  where m.deleted_at is null
    and m.review_status <> 'archived'

  union all

  select
    'snippet'::text as kind,
    s.id            as source_id,
    s.title         as title,
    left(
      coalesce(
        nullif(btrim(split_part(s.body, E'\n', 1)), ''),
        btrim(s.body)
      ),
      280
    )               as summary,
    s.body          as body,
    ceil(char_length(s.body) / 4.0)::int as tokens,
    s.updated_at    as updated_at,
    s.user_id       as owner_id,
    array(
      select sl.label_id
      from public.snippet_labels sl
      where sl.snippet_id = s.id
      order by sl.label_id
    )               as label_ids,
    s.folder_id     as container_id,
    concat_ws(
      E'\n',
      s.body,
      case when jsonb_typeof(s.bodies) = 'object' then
        (select string_agg(e.value, E'\n' order by e.key)
           from jsonb_each_text(s.bodies) as e(key, value)
          where e.value is distinct from s.body
            and btrim(e.value) <> '')
      end
    )               as search_text,
    s.review_status as review_status
  from public.snippets s
  where s.is_active
    and s.review_status <> 'archived'

  union all

  select
    'prompt'::text    as kind,
    p.id::text        as source_id,
    p.name            as title,
    left(
      coalesce(
        nullif(btrim(split_part(c.content_text, E'\n', 1)), ''),
        btrim(c.content_text)
      ),
      280
    )                 as summary,
    c.content_text    as body,
    ceil(char_length(c.content_text) / 4.0)::int as tokens,
    p.updated_at      as updated_at,
    p.user_id         as owner_id,
    array(
      select pl.label_id
      from public.prompt_labels pl
      where pl.prompt_id = p.id
      order by pl.label_id
    )                 as label_ids,
    p.folder_id::text as container_id,
    c.content_text    as search_text,
    p.review_status   as review_status
  from public.prompts p
  cross join lateral (select coalesce(p.content, '') as content_text) c
  where p.review_status <> 'archived';

comment on view app.knowledge_index is
  'MEMORY-002 · Retrieval projection over snippets, Brain items and prompts. security_invoker: composes each source''s RLS, never widens it. knowledge_search returns prompts only when asked for by kind. Archived items excluded (AI-KNOWLEDGE P2). Callers MUST be SECURITY INVOKER.';

revoke all on app.knowledge_index from public, anon;
grant select on app.knowledge_index to authenticated, service_role;

-- knowledge_search

create or replace function public.knowledge_search(
  p_query         text   default null,
  p_kinds         text[] default null,
  p_label_ids     uuid[] default null,
  p_container_ids text[] default null,
  p_limit         int    default 20
)
returns table (
  kind         text,
  source_id    text,
  title        text,
  summary      text,
  tokens       int,
  rank         real,
  matched_arms text[],
  review_status text
)
language sql
stable
-- No SECURITY DEFINER. See the header, and 20260831000000_knowledge_search.sql.
set search_path = public, extensions
as $$
  with base as materialized (
    select k.*,
           app.knowledge_tsv(k.title, k.search_text) as tsv,
           to_tsvector('simple', app.immutable_unaccent(coalesce(k.title, ''))) as title_tsv,
           lower(app.immutable_unaccent(coalesce(k.title, ''))) as title_norm,
           -- One language's length, not all of them: see the header, point 3.
           greatest(char_length(coalesce(k.body, '')), 1)::float8 as doc_len,
           -- What this call returns. Every row in base still sets the word counts;
           -- only these compete for the gate and come back. No p_kinds means
           -- snippets and Brain items, as it always did: prompts are asked for by name.
           (case when p_kinds is null then k.kind <> 'prompt'
                 else k.kind = any(p_kinds) end) as wanted
    from app.knowledge_index k
    where (k.kind <> 'prompt' or 'prompt' = any(coalesce(p_kinds, '{}'::text[])))
      and (p_container_ids is null or k.container_id = any(p_container_ids))
      and (p_label_ids     is null or k.label_ids && p_label_ids)
  ),
  stats as (
    select greatest(count(*), 1)::float8        as n,
           greatest(avg(doc_len), 1)::float8    as avg_len
    from base
  ),
  words as (
    select distinct w
    from regexp_split_to_table(lower(app.immutable_unaccent(coalesce(p_query, ''))), '[^[:alnum:]]+') as w
    where char_length(w) >= 3
      and coalesce(ts_lexize('pg_catalog.italian_stem'::regdictionary, w) <> '{}'::text[], true)
      and coalesce(ts_lexize('pg_catalog.spanish_stem'::regdictionary, w) <> '{}'::text[], true)
      and coalesce(ts_lexize('pg_catalog.english_stem'::regdictionary, w) <> '{}'::text[], true)
      and coalesce(ts_lexize('pg_catalog.french_stem'::regdictionary,  w) <> '{}'::text[], true)
  ),
  terms as (
    -- The shortest stem that is still a prefix of the word, across languages.
    select w,
           (select s
              from unnest(array[
                (ts_lexize('pg_catalog.italian_stem'::regdictionary, w))[1],
                (ts_lexize('pg_catalog.spanish_stem'::regdictionary, w))[1],
                (ts_lexize('pg_catalog.english_stem'::regdictionary, w))[1],
                (ts_lexize('pg_catalog.french_stem'::regdictionary,  w))[1],
                w
              ]) as s
             where s is not null and s <> '' and left(w, char_length(s)) = s
             order by char_length(s), s
             limit 1) as stem
    from words
  ),
  queries as (
    select w,
           case when char_length(stem) >= 4
                then to_tsquery('simple', quote_literal(stem) || ':*')
                else to_tsquery('simple', quote_literal(w) || ' | ' || quote_literal(w || 's'))
           end as tq
    from terms
  ),
  freq as (
    select q.w, q.tq, (select count(*) from base b where b.tsv @@ q.tq) as df
    from queries q
  ),
  typo as (
    select f.w,
           (select count(*) from base b where extensions.word_similarity(f.w, b.title_norm) >= 0.5) as fdf
    from freq f
    where f.df = 0
  ),
  hits as (
    select b.kind, b.source_id, f.w,
           (b.title_tsv @@ f.tq) as in_title,
           power(ln(1 + st.n / f.df), 2)
             * case when b.title_tsv @@ f.tq then 2.0
                    else 2.2 / (1 + 1.2 * (0.25 + 0.75 * b.doc_len / st.avg_len))
               end as weight,
           'fulltext'::text as arm
    from freq f
    cross join stats st
    join base b on f.df > 0 and b.tsv @@ f.tq
    union all
    select b.kind, b.source_id, y.w, true,
           power(ln(1 + st.n / y.fdf), 2),
           'typo'::text
    from typo y
    cross join stats st
    join base b on y.fdf > 0 and extensions.word_similarity(y.w, b.title_norm) >= 0.5
  ),
  scored as (
    select kind, source_id,
           sum(weight)          as score,
           count(distinct w)    as matched,
           bool_or(in_title)    as in_title,
           array_agg(distinct arm) as arms
    from hits
    group by kind, source_id
  ),
  gated as (
    select s.*, max(s.score) over () as best
    from scored s
    join base w on w.kind = s.kind and w.source_id = s.source_id and w.wanted
  )
  select
    b.kind,
    b.source_id,
    b.title,
    b.summary,
    b.tokens,
    coalesce(g.score, 0)::real                       as rank,
    coalesce(g.arms, array['recency']::text[])       as matched_arms,
    b.review_status                                  as review_status
  from base b
  left join gated g on g.kind = b.kind and g.source_id = b.source_id
  -- No content words: a browse, everything the filters allow, newest first.
  where b.wanted
    and (not exists (select 1 from words)
         or (g.score is not null
             and g.score >= greatest(8.0, 0.5 * g.best)
             and (g.in_title or g.matched >= least(2, (select count(*) from words)))))
  order by coalesce(g.score, 0) desc, b.updated_at desc, b.source_id
  limit greatest(coalesce(p_limit, 20), 1);
$$;

comment on function public.knowledge_search(text, text[], uuid[], text[], int) is
  'MEMORY-002 · Candidate generation for a written draft: content words in four languages, stem-prefix and typo matching, idf-squared scoring with a title boost, gated to the strongest candidates. Returns ids, scores, summaries and review status, never bodies. Archived items excluded by the view. Prompts only when p_kinds names them. Word counts come from the whole library, p_kinds only chooses what comes back. SECURITY INVOKER by design so RLS composes.';

revoke all on function public.knowledge_search(text, text[], uuid[], text[], int) from public, anon;
grant execute on function public.knowledge_search(text, text[], uuid[], text[], int) to authenticated;
