// WORKING-MEMORY PACK — the extension's copy of the shard selection rule.
//
// ⚠ SECOND IMPLEMENTATION, ON PURPOSE. The authority is
// app/src/lib/memory/engine.ts. The extension has no build step and cannot
// import TypeScript, so the ranking and budget rule is written twice: once
// there for the dashboard and the MCP server, once here for content.js. This is
// the same trade already accepted for the formula engine and the mobile
// resolver.
//
// What stops the two drifting is `node scripts/check-memory-parity.js`, a
// commit gate that runs BOTH implementations over the same fixtures and fails
// if a single pack differs. Change the rule in one file and that gate tells you
// about the other. Never change one without the other.
//
// This file implements a strict SUBSET. The engine is stateful because an agent
// session attaches and detaches over many turns, with LRU eviction and manual
// pins that survive a step change. The extension is one-shot: the user picks a
// step, gets a pack, and the picker closes. So there is no eviction here, and
// none is needed — filling an empty budget top-down never evicts anything.
(function (root) {
  'use strict';

  // Must equal CHARS_PER_TOKEN in app/src/lib/memory/engine.ts AND the
  // token_estimate generated column in the MEMORY-001 migration.
  var CHARS_PER_TOKEN = 4;

  function estimateTokens(text) {
    return Math.ceil(String(text == null ? '' : text).length / CHARS_PER_TOKEN);
  }

  // Relevance of a shard to a step, or null when the step does not want it.
  // Pinned shards are eligible everywhere. Everything else needs at least one
  // of the step's labels, and scores the sum of those labels' weights.
  function scoreShard(shard, step) {
    if (shard.pinned) return Infinity;

    var wanted = {};
    var labels = (step && step.labels) || [];
    for (var i = 0; i < labels.length; i++) {
      wanted[labels[i].labelId] = labels[i].weight;
    }

    var score = 0;
    var matched = false;
    var ids = shard.labelIds || [];
    for (var j = 0; j < ids.length; j++) {
      var w = wanted[ids[j]];
      if (w === undefined) continue;
      matched = true;
      score += w;
    }

    return matched ? score : null;
  }

  // Best first. Deterministic all the way down (score, priority, name, id) so
  // the same library and step always produce the same pack.
  function rankForStep(shards, step) {
    var scored = [];
    for (var i = 0; i < shards.length; i++) {
      var s = scoreShard(shards[i], step);
      if (s !== null) scored.push({ shard: shards[i], score: s });
    }

    scored.sort(function (a, b) {
      if (a.score !== b.score) return b.score - a.score;
      if (a.shard.priority !== b.shard.priority) return b.shard.priority - a.shard.priority;
      var byName = String(a.shard.name).localeCompare(String(b.shard.name));
      if (byName !== 0) return byName;
      return String(a.shard.id).localeCompare(String(b.shard.id));
    });

    var out = [];
    for (var k = 0; k < scored.length; k++) out.push(scored[k].shard);
    return out;
  }

  // Walk the ranking and take what fits. A shard that does not fit is skipped
  // rather than ending the loop, so a small one ranked below a large one still
  // gets in. Pinned shards bypass the check entirely: dropping a fact the user
  // marked always-on would be a worse failure than reporting the overrun, which
  // is what `overBudget` is for.
  function fillBudget(ranked, budget) {
    var taken = [];
    var skipped = [];
    var used = 0;

    for (var i = 0; i < ranked.length; i++) {
      var shard = ranked[i];
      if (shard.pinned) {
        taken.push(shard);
        used += shard.tokens;
        continue;
      }
      if (used + shard.tokens <= budget) {
        taken.push(shard);
        used += shard.tokens;
      } else {
        skipped.push(shard);
      }
    }

    return { shards: taken, skipped: skipped, usedTokens: used, budget: budget, overBudget: used > budget };
  }

  /** Rank then fill. The whole selection, in one call. */
  function packForStep(shards, step) {
    return fillBudget(rankForStep(shards, step), step.tokenBudget);
  }

  // The text that actually goes into the composer. Plain and visible on
  // purpose: the user can read exactly what is being sent, edit it, and delete
  // it. Nothing is hidden and nothing is rewritten at send time.
  function formatContextBlock(pack, stepName) {
    if (!pack || !pack.shards.length) return '';
    var lines = ['Context (' + stepName + '):', ''];
    for (var i = 0; i < pack.shards.length; i++) {
      lines.push('## ' + pack.shards[i].name);
      lines.push(pack.shards[i].body);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    return lines.join('\n');
  }

  // ── THE INJECTED BLOCK (MEMORY-002 I1) ────────────────────────────────────
  //
  // Presentation, not selection, so this has no twin in engine.ts and is not
  // parity-gated. The MCP surface renders the same package as structured data;
  // only a composer needs it as text.
  //
  // The markers are unusual characters on purpose. Remove finds the block by
  // them and strips exactly that range, so it can never eat the user's own
  // words, and a stray "##" in their draft is not mistaken for ours.
  var BLOCK_OPEN = '⟦ Fibonax context';
  var BLOCK_CLOSE = '⟧ end ⟧';

  /** Render a ContextPackage as the text that goes above the draft. */
  function formatInjectedBlock(pack) {
    if (!pack || !pack.items.length) return '';
    var lines = [BLOCK_OPEN + ' · ' + pack.items.length + ' item' +
                 (pack.items.length === 1 ? '' : 's') + ' ⟧', ''];
    for (var i = 0; i < pack.items.length; i++) {
      lines.push('## ' + pack.items[i].name);
      lines.push(pack.items[i].text);
      lines.push('');
    }
    lines.push(BLOCK_CLOSE);
    lines.push('');
    return lines.join('\n');
  }

  // Where the Context panel's own block starts: at the top of the draft, the
  // only place the panel ever puts one ('block + draft'), after any blank
  // lines; -1 when the draft does not open with one. A block further down is
  // somebody else's: a Brain inside a prompt (resolvePromptBrains), or a Copy
  // whole Brain pasted mid-message. The panel must never take that for its own,
  // or its Insert and Remove would cut a prompt's Brain out.
  function injectedBlockStart(s) {
    var at = 0;
    while (at < s.length && /\s/.test(s.charAt(at))) at++;
    return s.indexOf(BLOCK_OPEN, at) === at ? at : -1;
  }

  /** True when this text opens with the panel's injected block. */
  function hasInjectedBlock(text) {
    return injectedBlockStart(String(text == null ? '' : text)) !== -1;
  }

  /**
   * Remove the injected block at the top of the text, leaving everything else
   * byte-identical.
   *
   * Returns the original string untouched when the text does not open with a
   * block, or when the markers are malformed: half-deleting someone's message
   * because a marker got edited is far worse than leaving the block in place
   * for them to select.
   */
  function stripInjectedBlock(text) {
    var s = String(text == null ? '' : text);
    var start = injectedBlockStart(s);
    if (start === -1) return s;
    var end = s.indexOf(BLOCK_CLOSE, start);
    if (end === -1) return s;

    var after = end + BLOCK_CLOSE.length;
    // Eat the blank line the block leaves behind, so removing it twice in a row
    // does not accumulate whitespace above the draft.
    while (after < s.length && (s.charAt(after) === '\n' || s.charAt(after) === '\r')) after++;
    return s.slice(0, start) + s.slice(after);
  }

  // ── A BRAIN INSIDE A PROMPT (v3.103.0) ────────────────────────────────────
  //
  // A prompt's Context block can carry a Brain. The prompt keeps a reference,
  // never the Brain's text: one token on its own line where the Brain goes,
  //
  //   {brain: id=<uuid>; name=<name>}
  //
  // written by the dashboard editor and read here. At use time every surface
  // (the """ picker and the Context panel through the extension's background,
  // the popup's copy, the phone's Use now, the dashboard's Use) swaps the token
  // for the Brain's items, as "Copy whole Brain" hands them out, so the prompt
  // always carries the Brain as it is today. The name in the token is only a
  // label for a surface that cannot read the Brain: a teammate's prompt from a
  // shared folder (Brains are personal), a Brain in the trash, no connection.
  // The live name wins whenever the Brain can be read.
  //
  // Presentation again, so no twin in engine.ts. The dashboard writes and reads
  // the token with the same two lines in app/src/lib/promptBrain.ts, and
  // app/src/__tests__/promptBrain.test.ts holds them to these.
  var BRAIN_TOKEN_RE = /\{brain:\s*id=([0-9a-fA-F-]{36})\s*(?:;\s*name=([^}]*))?\}/g;
  var BRAIN_NAME_MAX = 64;

  /** A Brain's name as the token carries it: one line, no braces, at most 64. */
  function brainTokenName(name) {
    return String(name == null ? '' : name).replace(/[{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, BRAIN_NAME_MAX);
  }

  /** The token the editor writes into the Context block for `brain` ({id, name}). */
  function brainToken(brain) {
    var name = brainTokenName(brain && brain.name);
    return '{brain: id=' + String(brain && brain.id || '') + (name ? '; name=' + name : '') + '}';
  }

  /** Every Brain a prompt carries, as [{id, name}], once each, in order. */
  function promptBrainRefs(text) {
    var out = [];
    var seen = {};
    var m;
    BRAIN_TOKEN_RE.lastIndex = 0;
    while ((m = BRAIN_TOKEN_RE.exec(String(text == null ? '' : text))) !== null) {
      var id = m[1].toLowerCase();
      if (seen[id]) continue;
      seen[id] = true;
      out.push({ id: id, name: brainTokenName(m[2]) });
    }
    return out;
  }

  /**
   * A whole Brain as an AI chat receives it: the injected block over every
   * item, name and body. "Copy whole Brain" on the popup and the phone, and a
   * Brain inside a prompt, all build their text here. `plain` leaves the
   * block's own markers off, for text that will itself be wrapped in a block
   * (a prompt the Context panel inserts): a block inside a block would break
   * the panel's Remove, which strips the first marker to the first close.
   */
  function formatBrainBlock(items, plain) {
    var list = Array.isArray(items) ? items : [];
    var pack = { items: list.map(function (it) {
      return { name: it.name, text: it.body || '' };
    }) };
    if (!plain) return formatInjectedBlock(pack);
    var lines = [];
    for (var i = 0; i < pack.items.length; i++) {
      lines.push('## ' + pack.items[i].name);
      lines.push(pack.items[i].text);
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * What stands in for a Brain that cannot be handed out: one visible line in
   * the prompt, so it is never sent with a hole nobody noticed.
   *   'missing'  not this person's Brain, or in the trash
   *   'empty'    the Brain has no items
   *   'failed'   it could not be loaded (no connection, a server error)
   */
  function brainUnavailableLine(name, reason) {
    var label = name ? 'The Brain "' + name + '"' : 'A Brain';
    if (reason === 'empty') return '[' + label + ' is empty]';
    if (reason === 'failed') return '[' + label + ' could not be loaded]';
    return '[' + label + ' is not available here]';
  }

  /**
   * The line that opens a Brain inside a prompt. A prompt's answer is only as
   * accurate as the AI's grip on its material, so the AI is told what the
   * material is (the Brain's name says what it is about) and that it is the
   * source to work from, not a suggestion. Copy whole Brain has no such line:
   * pasted on its own, the person's own message says what to do with it.
   */
  function brainLeadLine(name) {
    var label = brainTokenName(name);
    return 'Source material' + (label ? ' from "' + label + '"' : '') +
      '. Base your answer on it, and say so if something you need is not covered.';
  }

  /**
   * The prompt with every Brain token replaced. `lookup` maps a Brain id to
   * { name, items: [{name, body}] } when the Brain was read, or to
   * { name, reason } when it was not. An id the lookup does not know gets
   * `fallbackReason`: 'missing' unless the caller says the read itself failed.
   * `plain` is formatBrainBlock's: items without the block's markers. The
   * block keeps no trailing blank line: the editor already leaves one between
   * the token and any text typed under it.
   */
  function resolvePromptBrains(text, lookup, fallbackReason, plain) {
    return String(text == null ? '' : text).replace(BRAIN_TOKEN_RE, function (token, id, name) {
      var entry = lookup && lookup[id.toLowerCase()];
      var label = (entry && entry.name) ? brainTokenName(entry.name) : brainTokenName(name);
      if (!entry) return brainUnavailableLine(label, fallbackReason || 'missing');
      if (entry.reason) return brainUnavailableLine(label, entry.reason);
      var items = Array.isArray(entry.items) ? entry.items : [];
      if (!items.length) return brainUnavailableLine(label, 'empty');
      return brainLeadLine(label) + '\n\n' + formatBrainBlock(items, plain).replace(/\n$/, '');
    });
  }

  /** The prompt as a list or a card previews it: each token as 'Brain: <name>'. */
  function labelBrainTokens(text) {
    return String(text == null ? '' : text).replace(BRAIN_TOKEN_RE, function (token, id, name) {
      var label = brainTokenName(name);
      return label ? 'Brain: ' + label : 'Brain';
    });
  }

  /**
   * A knowledge_search row folded into a ContextCandidate.
   *
   * `body` and `contentHash` are empty here, and that is the whole point of the
   * index/body split: search returns summaries so listing a library never costs
   * the library. `tokens` is the real cost from the database, so the panel can
   * show and budget an item it has not fetched.
   *
   * Bodies arrive at insert, for the handful of ids the user actually accepted,
   * and buildContext runs on THOSE. Deduplication therefore happens with real
   * text rather than on a hash the search does not return: two identical bodies
   * score 1.0 on similarity, comfortably over the near-duplicate threshold, so
   * the near pass catches exact duplicates too. The hash is only ever a cheaper
   * fast path, and its absence costs correctness nothing.
   */
  function candidateFromSearchRow(row) {
    return {
      id: row.source_id,
      kind: row.kind,
      name: row.title,
      summary: row.summary || '',
      body: '',
      tokens: typeof row.tokens === 'number' ? row.tokens : 0,
      pinned: false,
      rank: typeof row.rank === 'number' ? row.rank : 0,
      contentHash: ''
    };
  }

  // Rows as PostgREST returns them, folded into the shape the rule expects.
  function shardFromRow(row) {
    var ids = [];
    var links = row.memory_shard_labels || [];
    for (var i = 0; i < links.length; i++) {
      if (links[i] && links[i].label_id) ids.push(links[i].label_id);
    }
    return {
      id: row.id,
      name: row.name,
      summary: row.summary || '',
      body: row.body || '',
      tokens: typeof row.token_estimate === 'number' ? row.token_estimate : estimateTokens(row.body),
      labelIds: ids,
      pinned: !!row.pinned,
      priority: typeof row.priority === 'number' ? row.priority : 0
    };
  }

  function stepFromRow(row) {
    var labels = [];
    var links = row.memory_step_labels || [];
    for (var i = 0; i < links.length; i++) {
      if (links[i] && links[i].label_id) {
        labels.push({ labelId: links[i].label_id, weight: typeof links[i].weight === 'number' ? links[i].weight : 1 });
      }
    }
    return {
      key: row.key,
      name: row.name,
      tokenBudget: typeof row.token_budget === 'number' ? row.token_budget : 4000,
      labels: labels
    };
  }

  // ── CONTEXT BUILDING (MEMORY-002 P3) ──────────────────────────────────────
  //
  // The twin of buildContext in app/src/lib/memory/engine.ts. Same four passes,
  // same order, same tiebreaks. `node scripts/check-memory-parity.js` runs both
  // over identical candidates and fails if a single package differs.
  //
  // This is the half the injection panel calls: the user is mid-sentence, the
  // draft is the query, and this decides what actually goes in the box.

  // The floor for fusion ranks: a result ranked 15th by a single arm under
  // 1/(60+rank). knowledge_search no longer fuses; it gates its own results and
  // scores them 8 and up, so this never drops one of them. See engine.ts.
  var DEFAULT_MIN_RANK = 1 / 75;
  var NEAR_DUPLICATE_THRESHOLD = 0.85;

  // Not an attempt to reproduce pg_trgm. The only agreement that matters is
  // with engine.ts, and the gate proves that on every commit.
  function trigrams(text) {
    var normalised = String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
    if (!normalised) return [];
    var padded = '  ' + normalised + ' ';
    var out = [];
    for (var i = 0; i + 3 <= padded.length; i++) out.push(padded.slice(i, i + 3));
    return out;
  }

  /**
   * Jaccard overlap of two strings' trigram sets, 0 to 1.
   *
   * A string with no trigrams shares nothing with anything, including another
   * string with no trigrams. Two empty bodies are not the same fact, they are
   * two facts whose bodies failed to arrive, and scoring them 1.0 made the near
   * pass collapse an entire package into whichever item happened to rank first.
   */
  function textSimilarity(a, b) {
    var left = {};
    var right = {};
    var leftSize = 0;
    var rightSize = 0;
    var grams = trigrams(a);
    var i;

    for (i = 0; i < grams.length; i++) {
      if (!left[grams[i]]) { left[grams[i]] = true; leftSize++; }
    }
    grams = trigrams(b);
    for (i = 0; i < grams.length; i++) {
      if (!right[grams[i]]) { right[grams[i]] = true; rightSize++; }
    }

    if (leftSize === 0 || rightSize === 0) return 0;

    var shared = 0;
    for (var gram in left) {
      if (Object.prototype.hasOwnProperty.call(left, gram) && right[gram]) shared++;
    }

    var union = leftSize + rightSize - shared;
    return union === 0 ? 0 : shared / union;
  }

  // Pinned first, then relevance, then stable. The name and id tiebreaks are
  // what make the same draft produce the same context twice.
  function orderCandidates(candidates) {
    var copy = candidates.slice();
    copy.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.rank !== b.rank) return b.rank - a.rank;
      var byName = String(a.name).localeCompare(String(b.name));
      if (byName !== 0) return byName;
      return String(a.id).localeCompare(String(b.id));
    });
    return copy;
  }

  /**
   * Build the context package for a draft. Four passes, and the order is the
   * rule: floor, order, dedupe, fill.
   */
  function buildContext(request) {
    var budget = request.budget;
    var minRank = request.minRank === undefined ? DEFAULT_MIN_RANK : request.minRank;
    var nearThreshold =
      request.nearThreshold === undefined ? NEAR_DUPLICATE_THRESHOLD : request.nearThreshold;
    var dedupe = request.dedupe !== false;
    var candidates = request.candidates || [];

    var dropped = [];
    var deduped = [];
    var i, j;

    // 1. Floor. All-zero ranks mean no query ran, so there is no relevance to
    // be below. Pinned is never filtered by relevance.
    var searched = false;
    for (i = 0; i < candidates.length; i++) {
      if (candidates[i].rank > 0) { searched = true; break; }
    }

    var relevant = [];
    for (i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      // A body that never arrived has nothing to contribute. Dropping it here,
      // before dedupe, is what keeps a failed fetch visible: the alternative is
      // a heading with a blank underneath it, which is what the user pastes
      // into a model without noticing. Reported, never silent.
      if (!c.body || !String(c.body).trim()) {
        dropped.push({ id: c.id, name: c.name, reason: 'no-body' });
        continue;
      }
      if (searched && !c.pinned && c.rank < minRank) {
        dropped.push({ id: c.id, name: c.name, reason: 'below-floor' });
        continue;
      }
      relevant.push(c);
    }

    // 2. Order.
    var ordered = orderCandidates(relevant);

    // 3. Dedupe. First occurrence wins, which after ordering is the best-ranked.
    var kept = [];
    if (dedupe) {
      var seenHashes = {};
      for (i = 0; i < ordered.length; i++) {
        var cand = ordered[i];
        var exact = cand.contentHash ? seenHashes[cand.contentHash] : null;
        if (exact) {
          deduped.push({ id: cand.id, name: cand.name, mergedInto: exact.id, reason: 'exact' });
          continue;
        }

        var near = null;
        for (j = 0; j < kept.length; j++) {
          if (textSimilarity(cand.body, kept[j].body) >= nearThreshold) { near = kept[j]; break; }
        }
        if (near) {
          deduped.push({ id: cand.id, name: cand.name, mergedInto: near.id, reason: 'near' });
          continue;
        }

        if (cand.contentHash) seenHashes[cand.contentHash] = cand;
        kept.push(cand);
      }
    } else {
      for (i = 0; i < ordered.length; i++) kept.push(ordered[i]);
    }

    // 4. Fill. A candidate that does not fit is skipped, not terminal.
    var items = [];
    var used = 0;

    for (i = 0; i < kept.length; i++) {
      var k = kept[i];

      if (k.pinned) {
        items.push({ id: k.id, kind: k.kind, name: k.name, text: k.body, tokens: k.tokens, compressed: false });
        used += k.tokens;
        continue;
      }

      if (used + k.tokens <= budget) {
        items.push({ id: k.id, kind: k.kind, name: k.name, text: k.body, tokens: k.tokens, compressed: false });
        used += k.tokens;
        continue;
      }

      // The body does not fit; a summary that does keeps the fact rather than
      // losing it, marked so the reader knows it is the short version.
      var summaryTokens = estimateTokens(k.summary);
      if (k.summary && used + summaryTokens <= budget) {
        items.push({ id: k.id, kind: k.kind, name: k.name, text: k.summary, tokens: summaryTokens, compressed: true });
        used += summaryTokens;
        continue;
      }

      dropped.push({ id: k.id, name: k.name, reason: 'budget' });
    }

    // Source counts in first-appearance order, so the header reads the way the
    // list does.
    var sources = [];
    for (i = 0; i < items.length; i++) {
      var found = null;
      for (j = 0; j < sources.length; j++) {
        if (sources[j].kind === items[i].kind) { found = sources[j]; break; }
      }
      if (found) found.count++;
      else sources.push({ kind: items[i].kind, count: 1 });
    }

    return {
      items: items,
      usedTokens: used,
      budget: budget,
      dropped: dropped,
      deduped: deduped,
      sources: sources,
      overBudget: used > budget
    };
  }

  /**
   * Collapse candidates that are the same fact, before anything is shown.
   *
   * The twin of clusterCandidates in engine.ts, under the same parity gate. A
   * translated snippet arrives as one row per language and the near-duplicate
   * pass cannot see that they are one fact, so without this the panel offers a
   * four-language fact four times. `groupKey` comes from the caller (for
   * snippets, the rule expansion already uses); the member chosen is the
   * earliest preferred language, and it carries the group's best rank because
   * that rank belongs to the fact. See engine.ts for the reasoning.
   */
  function clusterCandidates(candidates, preferredLangs) {
    var prefs = preferredLangs || [];
    var list = candidates || [];
    var order = [];
    var groups = {};
    var i, j;

    for (i = 0; i < list.length; i++) {
      var c = list[i];
      var key = c.groupKey ? 'group:' + c.groupKey : 'row:' + c.kind + ':' + c.id;
      if (Object.prototype.hasOwnProperty.call(groups, key)) {
        groups[key].push(c);
      } else {
        groups[key] = [c];
        order.push(key);
      }
    }

    function preference(lang) {
      var index = lang === undefined ? -1 : prefs.indexOf(lang);
      return index === -1 ? prefs.length : index;
    }

    var clusters = [];
    for (i = 0; i < order.length; i++) {
      var members = orderCandidates(groups[order[i]]);
      var best = members[0];
      if (!best) continue;

      var chosen = best;
      var bestRank = best.rank;
      for (j = 0; j < members.length; j++) {
        if (members[j].rank > bestRank) bestRank = members[j].rank;
        if (preference(members[j].lang) < preference(chosen.lang)) chosen = members[j];
      }

      var copy = {};
      for (var field in chosen) {
        if (Object.prototype.hasOwnProperty.call(chosen, field)) copy[field] = chosen[field];
      }
      copy.rank = bestRank;
      clusters.push({ candidate: copy, members: members });
    }
    return clusters;
  }

  /**
   * The body a fetched snippet row carries for one language.
   *
   * Not parity-gated: this is how a row is read, not how candidates are chosen,
   * so it has no twin in engine.ts. The precedence is the one expansion uses in
   * content.js (_findLangVariants): a row's own body answers for its own
   * language, and its `bodies` map fills in the languages it holds inside.
   * scripts/check-lang-variants.js holds the two to the same answer.
   *
   * Falls back to the row's own body when the language is gone, which only
   * happens when the local library is older than the database. Something in the
   * wrong language is more use to the reader than an item dropped as unloadable.
   */
  function bodyForLang(row, lang) {
    if (!row) return '';
    var own = row.body == null ? '' : String(row.body);
    var wanted = String(lang == null ? '' : lang).toUpperCase();
    if (!wanted || String(row.lang == null ? '' : row.lang).toUpperCase() === wanted) {
      if (own.trim()) return own;
    }
    var map = row.bodies;
    if (wanted && map && typeof map === 'object') {
      var text = map[wanted];
      if (typeof text === 'string' && text.trim()) return text;
    }
    return own;
  }

  var API = {
    CHARS_PER_TOKEN: CHARS_PER_TOKEN,
    DEFAULT_MIN_RANK: DEFAULT_MIN_RANK,
    NEAR_DUPLICATE_THRESHOLD: NEAR_DUPLICATE_THRESHOLD,
    estimateTokens: estimateTokens,
    scoreShard: scoreShard,
    rankForStep: rankForStep,
    fillBudget: fillBudget,
    packForStep: packForStep,
    formatContextBlock: formatContextBlock,
    textSimilarity: textSimilarity,
    buildContext: buildContext,
    clusterCandidates: clusterCandidates,
    bodyForLang: bodyForLang,
    formatInjectedBlock: formatInjectedBlock,
    hasInjectedBlock: hasInjectedBlock,
    stripInjectedBlock: stripInjectedBlock,
    brainToken: brainToken,
    promptBrainRefs: promptBrainRefs,
    formatBrainBlock: formatBrainBlock,
    brainLeadLine: brainLeadLine,
    brainUnavailableLine: brainUnavailableLine,
    resolvePromptBrains: resolvePromptBrains,
    labelBrainTokens: labelBrainTokens,
    candidateFromSearchRow: candidateFromSearchRow,
    shardFromRow: shardFromRow,
    stepFromRow: stepFromRow
  };

  // UMD: browser globals, CommonJS (the node gate), AMD.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else if (typeof define === 'function' && define.amd) {
    define(function () { return API; });
  } else {
    root.SBMemoryPack = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
