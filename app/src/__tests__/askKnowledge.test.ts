import { describe, expect, it } from 'vitest';
import {
  ASK_COVERAGE,
  ASK_VERDICTS,
  answerPlainText,
  countGaps,
  coverageLabel,
  feedbackSources,
  parseAskResponse,
  showsQuestionList,
  splitCitations,
  verdictLabel,
  type AskSource,
} from '@/lib/askKnowledge';

const SOURCES: AskSource[] = [
  { ref: 'S1', kind: 'snippet', id: 'snip-1', title: 'Refund policy', updated_at: '2026-09-01T10:00:00Z', space_id: null, review_status: 'approved', used: true },
  { ref: 'S2', kind: 'memory', id: 'mem-1', title: 'Escalation steps', updated_at: null, space_id: 'space-1', review_status: 'deprecated', used: false },
];

describe('parseAskResponse', () => {
  it('accepts a well-formed answer', () => {
    const result = parseAskResponse({
      ok: true,
      status: 'answered',
      coverage: 'full',
      answer: 'Refunds take 14 days [S1].',
      missing: '',
      conflicts: '',
      sources: SOURCES,
    });
    expect(result?.status).toBe('answered');
    expect(result?.sources).toHaveLength(2);
  });

  it('accepts the no-sources reply, which never carries an answer', () => {
    const result = parseAskResponse({ ok: true, status: 'no_sources', answer: '', missing: '', conflicts: '', sources: [] });
    expect(result?.status).toBe('no_sources');
  });

  it('reads a source without a status as approved, and keeps a status it is given', () => {
    const result = parseAskResponse({
      ok: true,
      status: 'answered',
      answer: 'x [S1]',
      missing: '',
      conflicts: '',
      sources: [
        { ref: 'S1', kind: 'snippet', id: 'a', title: 'A', updated_at: null, space_id: null, used: true },
        { ref: 'S2', kind: 'memory', id: 'b', title: 'B', updated_at: null, space_id: 's', review_status: 'deprecated', used: false },
      ],
    });
    expect(result?.sources.map((s) => s.review_status)).toEqual(['approved', 'deprecated']);
  });

  it('reads an answer from a function without contextual replies as one answer, no question list', () => {
    const result = parseAskResponse({ ok: true, status: 'answered', answer: 'x [S1]', missing: '', conflicts: '', sources: SOURCES });
    expect(result?.reply).toBe(false);
    expect(result?.questions).toEqual([]);
  });

  it('reads a reply and the questions found in the message', () => {
    const result = parseAskResponse({
      ok: true,
      status: 'answered',
      answer: 'Hi Sam, refunds take 14 days [S1]. [Add: weekend support hours]',
      missing: 'Weekend support hours.',
      conflicts: '',
      reply: true,
      questions: [
        { question: 'How long does a refund take?', coverage: 'full', sources: ['S1'] },
        { question: 'Is weekend support available?', coverage: 'none', sources: [] },
      ],
      sources: SOURCES,
    });
    expect(result?.reply).toBe(true);
    expect(result?.questions.map((q) => q.coverage)).toEqual(['full', 'none']);
    expect(result && showsQuestionList(result)).toBe(true);
  });

  it('rejects a question with a coverage it does not know', () => {
    expect(
      parseAskResponse({
        ok: true, status: 'answered', answer: 'x', missing: '', conflicts: '', sources: SOURCES,
        questions: [{ question: 'Q?', coverage: 'mostly', sources: [] }],
      }),
    ).toBeNull();
  });

  it('rejects anything else rather than rendering half an answer', () => {
    expect(parseAskResponse(null)).toBeNull();
    expect(parseAskResponse({ ok: false })).toBeNull();
    expect(parseAskResponse({ ok: true, status: 'guessed', answer: '', missing: '', conflicts: '', sources: [] })).toBeNull();
    expect(
      parseAskResponse({ ok: true, status: 'answered', answer: 'x', missing: '', conflicts: '', sources: [{ ref: 'S1', kind: 'prompt' }] }),
    ).toBeNull();
  });
});

describe('splitCitations', () => {
  it('turns markers of known sources into citations', () => {
    expect(splitCitations('Refunds take 14 days [S1]. Escalate first [S2].', SOURCES)).toEqual([
      { type: 'text', text: 'Refunds take 14 days ' },
      { type: 'cite', ref: 'S1' },
      { type: 'text', text: '. Escalate first ' },
      { type: 'cite', ref: 'S2' },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps a marker for a source that was not sent as visible text', () => {
    expect(splitCitations('Something [S9].', SOURCES)).toEqual([{ type: 'text', text: 'Something [S9].' }]);
  });

  it('handles adjacent citations and an answer that starts with one', () => {
    expect(splitCitations('[S1][S2] apply.', SOURCES)).toEqual([
      { type: 'cite', ref: 'S1' },
      { type: 'cite', ref: 'S2' },
      { type: 'text', text: ' apply.' },
    ]);
  });
});

describe('gaps in a reply', () => {
  it('marks a note in brackets as a gap, and keeps citations and unknown markers as before', () => {
    expect(splitCitations('Refunds take 14 days [S1]. [Add: weekend hours] See [S9].', SOURCES)).toEqual([
      { type: 'text', text: 'Refunds take 14 days ' },
      { type: 'cite', ref: 'S1' },
      { type: 'text', text: '. ' },
      { type: 'gap', text: '[Add: weekend hours]' },
      { type: 'text', text: ' See [S9].' },
    ]);
  });

  it('counts the gaps left to fill, never a citation', () => {
    expect(countGaps('Yes [S1]. [Aggiungi: orari] and [Add: price]')).toBe(2);
    expect(countGaps('Yes [S1][S2].')).toBe(0);
  });

  it('copies a reply with its gaps, so the sender sees what is left', () => {
    expect(answerPlainText('Yes [S1]. [Add: price]')).toBe('Yes. [Add: price]');
  });
});

describe('the question list', () => {
  const base = { ok: true as const, missing: '', conflicts: '', reply: true, sources: SOURCES };
  const two = [
    { question: 'A?', coverage: 'full' as const, sources: ['S1'] },
    { question: 'B?', coverage: 'partial' as const, sources: ['S2'] },
  ];

  it('shows for an answer covering two questions or more', () => {
    expect(showsQuestionList({ ...base, status: 'answered', answer: 'x [S1]', questions: two })).toBe(true);
    expect(showsQuestionList({ ...base, status: 'answered', answer: 'x [S1]', questions: two.slice(0, 1) })).toBe(false);
  });

  it('does not show when nothing was answered', () => {
    expect(showsQuestionList({ ...base, status: 'not_covered', answer: '', questions: two })).toBe(false);
  });

  it('names each coverage in plain words', () => {
    expect(ASK_COVERAGE.map((c) => coverageLabel(c.value))).toEqual(['Answered', 'Partly answered', 'Not in Fibonax']);
  });
});

describe('answerPlainText', () => {
  it('drops citation markers so the answer can be pasted into a message', () => {
    expect(answerPlainText('Refunds take 14 days [S1].\nEscalate first [S1][S2].')).toBe(
      'Refunds take 14 days.\nEscalate first.',
    );
  });
});

describe('feedback vocabulary', () => {
  it('offers the six verdicts the database accepts, useful first', () => {
    expect(ASK_VERDICTS.map((v) => v.value)).toEqual([
      'useful',
      'incorrect',
      'outdated',
      'incomplete',
      'irrelevant',
      'conflicting',
    ]);
  });

  it('labels a verdict, and falls back to the raw value for an unknown one', () => {
    expect(verdictLabel('incorrect')).toBe('Wrong');
    expect(verdictLabel('something-new')).toBe('something-new');
  });

  it('snapshots each source by kind, id and title', () => {
    expect(feedbackSources(SOURCES)).toEqual([
      { kind: 'snippet', id: 'snip-1', title: 'Refund policy', space_id: null, used: true },
      { kind: 'memory', id: 'mem-1', title: 'Escalation steps', space_id: 'space-1', used: false },
    ]);
  });
});
