import { z } from 'zod';
import { toReviewStatus } from '@/lib/reviewStatus';

// FiboChat (AI-KNOWLEDGE P1, docs/AI_KNOWLEDGE_PLAN.md).
//
// The pure half: what the ask-sprintbrain function answers, read defensively,
// and the feedback vocabulary. No network here, so all of it is testable.

/**
 * The verdicts a reader can give an answer, in the order they are offered.
 *
 * Keep in step with the knowledge_feedback verdict check
 * (services/supabase/migrations/20261004120000_knowledge_feedback.sql) and the
 * phone page's ASK_VERDICTS. scripts/check-ask-knowledge.js fails CI if the
 * three lists differ.
 */
export const ASK_VERDICTS = [
  { value: 'useful', label: 'Useful' },
  { value: 'incorrect', label: 'Wrong' },
  { value: 'outdated', label: 'Outdated' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'irrelevant', label: 'Not relevant' },
  { value: 'conflicting', label: 'Conflicts with policy' },
] as const;

export type AskVerdict = (typeof ASK_VERDICTS)[number]['value'];

export function verdictLabel(value: string): string {
  return ASK_VERDICTS.find((v) => v.value === value)?.label ?? value;
}

/**
 * Mirrors the function's limits. The top is a whole message someone received,
 * so it can be answered question by question; feedback keeps its first 1000
 * characters, the table's limit (askApi).
 */
export const ASK_QUESTION_MIN = 3;
export const ASK_QUESTION_MAX = 4000;

/**
 * How far one question in a message is answered, in the words the list under
 * it shows. Keep in step with the phone page's ASK_COVERAGE:
 * scripts/check-ask-knowledge.js.
 */
export const ASK_COVERAGE = [
  { value: 'full', label: 'Answered' },
  { value: 'partial', label: 'Partly answered' },
  { value: 'none', label: 'Not in Fibonax' },
] as const;

export type AskCoverage = (typeof ASK_COVERAGE)[number]['value'];

export function coverageLabel(value: AskCoverage): string {
  return ASK_COVERAGE.find((c) => c.value === value)?.label ?? value;
}

const sourceSchema = z.object({
  ref: z.string(),
  kind: z.enum(['snippet', 'memory']),
  id: z.string(),
  title: z.string(),
  updated_at: z.string().nullable(),
  space_id: z.string().nullable(),
  // Review status (AI-KNOWLEDGE P2). Optional so a reply from a function
  // deployed before statuses existed still reads; it counts as approved.
  review_status: z.string().optional().transform(toReviewStatus),
  used: z.boolean(),
});

/** One question found in what was asked, and the sources that answer it. */
const questionSchema = z.object({
  question: z.string(),
  coverage: z.enum(['full', 'partial', 'none']),
  sources: z.array(z.string()),
});

const responseSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['answered', 'not_covered', 'no_sources']),
  answer: z.string(),
  missing: z.string(),
  conflicts: z.string(),
  // Contextual replies. Optional so a reply from a function deployed before
  // them still reads: one answer, no question list.
  reply: z.boolean().default(false),
  questions: z.array(questionSchema).default([]),
  sources: z.array(sourceSchema),
});

export type AskSource = z.infer<typeof sourceSchema>;
export type AskQuestion = z.infer<typeof questionSchema>;
export type AskResult = z.infer<typeof responseSchema>;

/** The function's reply, or null when it does not have the expected shape. */
export function parseAskResponse(value: unknown): AskResult | null {
  const parsed = responseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The list of questions found is worth showing for an answer that covers more
 * than one: a single question is the answer's own heading already, and when
 * nothing is answered the panel says so in one line.
 */
export function showsQuestionList(result: AskResult): boolean {
  return result.status === 'answered' && result.questions.length >= 2;
}

/**
 * One piece of an answer: plain text, a citation of a source, or a gap, a
 * note in square brackets that the sender fills in before sending (a reply
 * marks a question Fibonax cannot answer that way, never with a guess).
 */
export type AnswerPart =
  | { type: 'text'; text: string }
  | { type: 'cite'; ref: string }
  | { type: 'gap'; text: string };

const MARKER = /\[(S\d+)\]|\[([^[\]\n]{1,200})\]/g;
const GAP = /\[(?!S\d+\])[^[\]\n]{1,200}\]/g;

/**
 * Split an answer into text, citations and gaps, so a citation can be drawn
 * as a link to its source and a gap stands out. A marker naming a source that
 * was not sent stays as plain text: it cannot be followed, and dropping it
 * would hide that the model cited something it was not given.
 */
export function splitCitations(answer: string, sources: readonly AskSource[]): AnswerPart[] {
  const known = new Set(sources.map((s) => s.ref));
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of answer.matchAll(MARKER)) {
    const ref = match[1];
    const at = match.index ?? 0;
    if (ref !== undefined && !known.has(ref)) continue;
    if (at > last) parts.push({ type: 'text', text: answer.slice(last, at) });
    parts.push(ref !== undefined ? { type: 'cite', ref } : { type: 'gap', text: match[0] });
    last = at + match[0].length;
  }
  if (last < answer.length) parts.push({ type: 'text', text: answer.slice(last) });
  return parts;
}

/** How many gaps an answer still holds, so copying it can say they need filling in. */
export function countGaps(answer: string): number {
  return (answer.match(GAP) ?? []).length;
}

/** The answer without citation markers, for copying into a message. */
export function answerPlainText(answer: string): string {
  return answer
    .replace(/\s*\[S\d+\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** What a feedback row records about each source: enough to find it again, even after it is renamed. */
export interface FeedbackSource {
  kind: string;
  id: string;
  title: string;
  /** The Brain a memory item lives in, so the review list can open it. Null for snippets. */
  space_id: string | null;
  used: boolean;
}

export function feedbackSources(sources: readonly AskSource[]): FeedbackSource[] {
  return sources.map((s) => ({ kind: s.kind, id: s.id, title: s.title, space_id: s.space_id, used: s.used }));
}
