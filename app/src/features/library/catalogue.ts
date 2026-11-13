/**
 * The starter library: ready-made snippets, prompts and Brains a person can
 * add in one click from the Snippets, Prompts and Brains pages.
 *
 * It ships with the app, so it needs no table and no migration, and every
 * account sees the same list. Everything here must fit any industry
 * (root CLAUDE.md, Industry-Neutral): `scripts/check-industry-neutral.js`
 * scans this folder.
 *
 * Each snippet carries `example`: the answers its preview fills in. The tests
 * in `src/__tests__/library.test.ts` fill every snippet with them through the
 * real fill form, so a body that leaves a field blank, prints a token, or asks
 * for a field the example forgot fails before it ships.
 */

import type { IntentCategory, OutputType } from '@/types/database';

export type LibrarySection = 'snippets' | 'prompts' | 'brains';

export interface LibraryTopic {
  id: string;
  label: string;
}

export interface LibrarySnippet {
  id: string;
  topic: string;
  name: string;
  /** Bare trigger, no prefix: the extension adds it. */
  trigger: string;
  body: string;
  /** What the preview fills in, keyed by field name. */
  example: Record<string, string>;
}

export interface LibraryPrompt {
  id: string;
  topic: string;
  name: string;
  /** Bare shortcut, no prefix. */
  shortcut: string;
  intent: IntentCategory;
  output: OutputType | null;
  role: string;
  objective: string;
  /** Optional Context block text; the block stays off when it is empty. */
  context: string;
  constraints: string;
}

export interface LibraryBrainItem {
  name: string;
  summary: string;
  body: string;
}

export interface LibraryBrain {
  id: string;
  name: string;
  description: string;
  items: LibraryBrainItem[];
}

/** Where added snippets and prompts go, so they never mix with a person's own. */
export const LIBRARY_FOLDER_NAME = 'From the library';

export const SNIPPET_TOPICS: LibraryTopic[] = [
  { id: 'replies', label: 'Customer replies' },
  { id: 'sales', label: 'Sales and quotes' },
  { id: 'admin', label: 'Admin and scheduling' },
  { id: 'team', label: 'Team notes' },
];

export const PROMPT_TOPICS: LibraryTopic[] = [
  { id: 'support', label: 'Customer support' },
  { id: 'write', label: 'Writing' },
  { id: 'think', label: 'Planning and analysis' },
];

const CLIENT = '{formtext: name=CLIENT; format=name; label=Client name}';

export const LIBRARY_SNIPPETS: LibrarySnippet[] = [
  // ── Customer replies ──
  {
    id: 'thanks',
    topic: 'replies',
    name: 'Thanks for your message',
    trigger: 'thanks',
    body: `{greeting} ${CLIENT},

Thank you for your message. I've passed it to {formmenu: our team,a colleague,our support desk; name=PASSED_TO} and you'll hear back by {time: dddd D MMMM; shift=+1D}.

Kind regards,`,
    example: { CLIENT: 'anna rossi', PASSED_TO: 'our team' },
  },
  {
    id: 'received',
    topic: 'replies',
    name: 'Request received',
    trigger: 'received',
    body: `Hi ${CLIENT},

We received your request {formtext: name=REF; label=Reference} today, {time: long}. We'll update you as soon as there's news.

Thanks,`,
    example: { CLIENT: 'anna rossi', REF: 'A-1042' },
  },
  {
    id: 'delay',
    topic: 'replies',
    name: 'Sorry for the delay',
    trigger: 'delay',
    body: `Hi ${CLIENT},

I'm sorry for the wait. {formmenu: We had more requests than usual,A supplier was late,We needed to check a detail with a colleague; name=REASON; other=Other}, and it took longer than it should have.{formmenu: No,Yes; name=OFFER; print=no}{if: OFFER = "Yes"} As a thank-you for your patience, we've taken 10% off your next order.{endif}

Thanks for understanding,`,
    example: { CLIENT: 'anna rossi', REASON: 'A supplier was late', OFFER: 'Yes' },
  },
  {
    id: 'nudge',
    topic: 'replies',
    name: 'Gentle follow-up',
    trigger: 'nudge',
    body: `Hi ${CLIENT},

Just checking in on my message from {formdate: name=DATE_SENT; format=long}. Do you need anything else from me to move forward?

Best,`,
    example: { CLIENT: 'anna rossi', DATE_SENT: '2026-11-02' },
  },
  {
    id: 'solved',
    topic: 'replies',
    name: 'Request solved',
    trigger: 'solved',
    body: `Hi ${CLIENT},

Good news: {formtext: name=WHAT; label=What was solved} is sorted. If anything still isn't right, reply to this email and I'll pick it up.

Have a good {time: dddd},`,
    example: { CLIENT: 'anna rossi', WHAT: 'the login problem' },
  },
  {
    id: 'away',
    topic: 'replies',
    name: 'Out of office',
    trigger: 'away',
    body: `Thanks for your email. I'm out of the office until {formdate: name=BACK_ON; format=long} and will reply when I'm back.

For anything urgent, please contact {formtext: name=COVER; label=Who covers for you} at {formtext: name=COVER_EMAIL; label=Their email}.`,
    example: { BACK_ON: '2026-11-16', COVER: 'Marco', COVER_EMAIL: 'marco@example.com' },
  },

  // ── Sales and quotes ──
  {
    id: 'quote',
    topic: 'sales',
    name: 'Quote with total',
    trigger: 'quote',
    body: `Hi ${CLIENT},

Here is your quote for {formtext: name=ITEM; label=Product or service}:

Price per unit: {formtext: name=PRICE; type=number; format=plain; label=Price per unit} EUR
Quantity: {formtext: name=QTY; type=number; default=1; label=Quantity}
Total: {=round(PRICE * QTY, 2)} EUR{button label="10% off"}PRICE = PRICE * 0.9{/button}

This quote is valid until {time: DD/MM/YYYY; shift=+14D}.`,
    example: { CLIENT: 'anna rossi', ITEM: 'website design', PRICE: '450', QTY: '2' },
  },
  {
    id: 'deposit',
    topic: 'sales',
    name: 'Deposit request',
    trigger: 'deposit',
    body: `Hi ${CLIENT},

To confirm, we ask for a 30% deposit.

Total: {formtext: name=TOTAL; type=number; format=plain; label=Total} EUR
Deposit now: {=round(TOTAL * 0.3, 2)} EUR
Balance due by {formdate: name=DUE_DATE; format=long}: {=round(TOTAL * 0.7, 2)} EUR

Thank you,`,
    example: { CLIENT: 'anna rossi', TOTAL: '1200', DUE_DATE: '2026-12-15' },
  },
  {
    id: 'terms',
    topic: 'sales',
    name: 'Terms and conditions link',
    trigger: 'terms',
    body: `You can read our terms and conditions here: https://example.com/terms

If anything is unclear, reply to this email and I'll explain.`,
    example: {},
  },
  {
    id: 'plans',
    topic: 'sales',
    name: 'Plan options',
    trigger: 'plans',
    body: `Hi ${CLIENT},

Based on what you told me, I'd suggest the {formmenu: Basic,Plus,Pro; name=PLAN; default=Plus} plan. {if: PLAN = "Basic"}It covers the essentials and you can upgrade at any time.{elseif: PLAN = "Plus"}It adds priority support, which most teams your size use.{else}It includes everything, with a dedicated contact person.{endif}

Happy to walk you through it on a short call.`,
    example: { CLIENT: 'anna rossi', PLAN: 'Plus' },
  },
  {
    id: 'followquote',
    topic: 'sales',
    name: 'Follow-up on a quote',
    trigger: 'followquote',
    body: `Hi ${CLIENT},

I sent the quote for {formtext: name=ITEM; label=Product or service} on {formdate: name=DATE_SENT; format=long}. Do you have any questions, or anything you'd like me to change?

Best,`,
    example: { CLIENT: 'anna rossi', ITEM: 'website design', DATE_SENT: '2026-11-02' },
  },
  {
    id: 'newprice',
    topic: 'sales',
    name: 'Price change notice',
    trigger: 'newprice',
    body: `Dear ${CLIENT},

From {formdate: name=CHANGE_DATE; format=long}, the price of {formtext: name=ITEM; label=Product or service} changes from {formtext: name=OLD; type=number; format=plain; label=Old price} EUR to {formtext: name=NEW; type=number; format=plain; label=New price} EUR, a change of {=round((NEW - OLD) / OLD * 100, 1)}%.

Orders placed before that date keep the current price.`,
    example: { CLIENT: 'anna rossi', CHANGE_DATE: '2027-01-01', ITEM: 'the monthly plan', OLD: '40', NEW: '44' },
  },
  {
    id: 'meet',
    topic: 'sales',
    name: 'Meeting request',
    trigger: 'meet',
    body: `Hi ${CLIENT},

Could we meet for {formmenu: 15,30,45,60; name=MINUTES; default=30} minutes? I'm free on {formdate: name=DAY; format=long} at {formdate: name=TIME; type=time; format=HH:mm}, {formmenu: by video call,by phone,in person; name=HOW_TO_MEET}.

Does that work for you?`,
    example: { CLIENT: 'anna rossi', MINUTES: '30', DAY: '2026-11-12', TIME: '10:00', HOW_TO_MEET: 'by video call' },
  },

  // ── Admin and scheduling ──
  {
    id: 'confirm',
    topic: 'admin',
    name: 'Appointment confirmed',
    trigger: 'confirm',
    body: `Hi ${CLIENT},

Your appointment is confirmed for {formdate: name=DAY; format=long} at {formdate: name=TIME; type=time; format=HH:mm}.

Where: {formtext: name=PLACE; label=Address or link}

If you need to change it, reply to this email.`,
    example: { CLIENT: 'anna rossi', DAY: '2026-11-12', TIME: '15:30', PLACE: 'Via Roma 12, Milano' },
  },
  {
    id: 'remind',
    topic: 'admin',
    name: 'Reminder for tomorrow',
    trigger: 'remind',
    body: `Hi ${CLIENT},

A quick reminder of our appointment tomorrow, {time: dddd D MMMM; shift=+1D}, at {formdate: name=TIME; type=time; format=HH:mm}.

See you then,`,
    example: { CLIENT: 'anna rossi', TIME: '09:00' },
  },
  {
    id: 'reschedule',
    topic: 'admin',
    name: 'Reschedule',
    trigger: 'reschedule',
    body: `Hi ${CLIENT},

I'm sorry, I need to move our appointment. Would one of these work instead?

- {formdate: name=FIRST_OPTION; format=long}
- {formdate: name=SECOND_OPTION; format=long}

Thank you for your flexibility.`,
    example: { CLIENT: 'anna rossi', FIRST_OPTION: '2026-11-13', SECOND_OPTION: '2026-11-16' },
  },
  {
    id: 'invoice',
    topic: 'admin',
    name: 'Invoice sent',
    trigger: 'invoice',
    body: `Hi ${CLIENT},

Attached is invoice {formtext: name=NUMBER; label=Invoice number} for {formtext: name=AMOUNT; type=number; format=plain; label=Amount} EUR.

Payment is due by {time: DD/MM/YYYY; shift=+30D}. Thank you.`,
    example: { CLIENT: 'anna rossi', NUMBER: '2026-118', AMOUNT: '900' },
  },
  {
    id: 'overdue',
    topic: 'admin',
    name: 'Payment reminder',
    trigger: 'overdue',
    body: `Hi ${CLIENT},

{formmenu: Friendly,Firm; name=TONE; print=no}{if: TONE = "Friendly"}A quick note in case it slipped through: {else}Our records show that {endif}invoice {formtext: name=NUMBER; label=Invoice number} for {formtext: name=AMOUNT; type=number; format=plain; label=Amount} EUR was due on {formdate: name=DUE_DATE; format=long}. {if: TONE = "Firm"}Please arrange payment within 7 days.{else}Could you let me know when it's on its way?{endif}

Thank you,`,
    example: { CLIENT: 'anna rossi', TONE: 'Friendly', NUMBER: '2026-118', AMOUNT: '900', DUE_DATE: '2026-10-30' },
  },
  {
    id: 'docs',
    topic: 'admin',
    name: 'Documents needed',
    trigger: 'docs',
    body: `Hi ${CLIENT},

To go ahead, please send us:
{formmenu: ID document,Signed contract,Proof of address,Payment receipt,Tax number; name=DOCUMENTS; multiple=yes}

You can reply to this email with the files attached.`,
    example: { CLIENT: 'anna rossi', DOCUMENTS: 'ID document, Signed contract' },
  },

  // ── Team notes ──
  {
    id: 'handover',
    topic: 'team',
    name: 'Shift handover',
    trigger: 'handover',
    body: `Handover, {time: dddd D MMMM, HH:mm}

Done: {formtext: name=DONE; label=Done}
Still open: {formtext: name=OPEN; label=Still open}
Priority: {formmenu: Low,Normal,Urgent; name=PRIORITY; default=Normal}{if: PRIORITY = "Urgent"}. Please pick this up first.{endif}`,
    example: { DONE: 'replied to all new emails', OPEN: 'two refunds to check', PRIORITY: 'Urgent' },
  },
  {
    id: 'daily',
    topic: 'team',
    name: 'Daily update',
    trigger: 'daily',
    body: `Update for {time: dddd D MMMM}

Yesterday: {formtext: name=YESTERDAY; label=Yesterday}
Today: {formtext: name=TODAY; label=Today}
Blocked by: {formtext: name=BLOCKED; default=Nothing; label=Blocked by}`,
    example: { YESTERDAY: 'finished the price list', TODAY: 'call three suppliers', BLOCKED: 'Nothing' },
  },
  {
    id: 'notes',
    topic: 'team',
    name: 'Meeting notes',
    trigger: 'notes',
    body: `Meeting notes, {time: long}

Who was there: {formtext: name=PEOPLE; label=Who was there}
Decided: {formtext: name=DECIDED; label=Decided}
Next steps: {formtext: name=NEXT; label=Next steps}
Next meeting: {formdate: name=NEXT_MEETING; format=long}`,
    example: { PEOPLE: 'Anna, Marco, Sara', DECIDED: 'new opening hours from December', NEXT: 'Marco updates the website', NEXT_MEETING: '2026-11-20' },
  },
  {
    id: 'welcome',
    topic: 'team',
    name: 'Welcome a new colleague',
    trigger: 'welcome',
    body: `Hi everyone,

Please welcome {formtext: name=NEWCOMER; format=name; label=New colleague}, who joins us as {formtext: name=ROLE; label=Their role} on {formdate: name=START; format=long}. {NEWCOMER} will work with {formtext: name=BUDDY; format=name; label=Who helps them settle in} for the first weeks.

Say hello when you see them.`,
    example: { NEWCOMER: 'sara bianchi', ROLE: 'office manager', START: '2026-11-16', BUDDY: 'marco verdi' },
  },
  {
    id: 'leave',
    topic: 'team',
    name: 'Time off request',
    trigger: 'leave',
    body: `Hi {formtext: name=MANAGER; format=name; label=Manager},

I'd like to take time off from {formdate: name=FIRST_DAY; format=long} to {formdate: name=LAST_DAY; format=long}, {=datespan(FIRST_DAY, LAST_DAY, "inclusive")} days in total.

{formtext: name=COVER; label=Who covers for you} has agreed to cover for me. Thank you.`,
    example: { MANAGER: 'anna rossi', FIRST_DAY: '2026-12-21', LAST_DAY: '2026-12-24', COVER: 'Marco' },
  },
  {
    id: 'issue',
    topic: 'team',
    name: 'Problem report',
    trigger: 'issue',
    body: `Problem reported {time: DD/MM/YYYY HH:mm}

Where: {formtext: name=WHERE; label=Where}
What happened: {formtext: name=WHAT; label=What happened}
How urgent: {formmenu: Can wait,Today,Right now; name=URGENCY}
Reported by: {formtext: name=BY; format=name; label=Reported by}`,
    example: { WHERE: 'front desk printer', WHAT: 'it stopped printing', URGENCY: 'Today', BY: 'sara bianchi' },
  },
];

// Read by the AI, so it speaks to the AI. Attaching a Brain in the Context
// block's Brain box gives it those facts; the manual says so, not the prompt.
const FACTS_CONTEXT = 'Base the reply on our own facts and policies when I give them. If something you need is missing, say so instead of guessing.';

export const LIBRARY_PROMPTS: LibraryPrompt[] = [
  {
    id: 'reply',
    topic: 'support',
    name: 'Reply to a customer',
    shortcut: 'reply',
    intent: 'Support',
    output: null,
    role: 'You are an experienced customer service lead.',
    objective: 'Write a reply to the customer message I paste below. Answer every question it asks.',
    context: FACTS_CONTEXT,
    constraints: 'Stay under 150 words. Be friendly and clear. Promise nothing I have not offered. End with one next step for the customer.',
  },
  {
    id: 'complaint',
    topic: 'support',
    name: 'Handle a complaint',
    shortcut: 'complaint',
    intent: 'Support',
    output: null,
    role: 'You are a calm, senior support person.',
    objective: 'Draft a reply to the complaint I paste below. Acknowledge the problem, explain what happens next and offer one concrete fix.',
    context: FACTS_CONTEXT,
    constraints: 'Never blame the customer. Make no legal promises. Keep it under 180 words.',
  },
  {
    id: 'followup',
    topic: 'support',
    name: 'Follow-up email',
    shortcut: 'followup',
    intent: 'Writing',
    output: null,
    role: 'You are an account manager.',
    objective: 'Write a short follow-up to the email I paste below. Remind the reader without pressure.',
    context: '',
    constraints: 'Stay under 80 words. Ask one clear question.',
  },
  {
    id: 'clearer',
    topic: 'write',
    name: 'Make it clearer',
    shortcut: 'clearer',
    intent: 'Writing',
    output: null,
    role: 'You are an editor.',
    objective: 'Rewrite the text I paste below so it is shorter and easier to read.',
    context: '',
    constraints: 'Keep the meaning and every fact. Use short sentences. Add nothing new.',
  },
  {
    id: 'tone',
    topic: 'write',
    name: 'Change the tone',
    shortcut: 'tone',
    intent: 'Writing',
    output: null,
    role: 'You are an editor.',
    objective: 'Rewrite the text I paste below in a friendlier or a more formal tone. Ask me which one first.',
    context: '',
    constraints: 'Keep the same facts. Keep the length within 10% of the original.',
  },
  {
    id: 'translate',
    topic: 'write',
    name: 'Translate, keep the tone',
    shortcut: 'translate',
    intent: 'Writing',
    output: null,
    role: 'You are a professional translator.',
    objective: 'Translate the text I paste below into the language I name.',
    context: '',
    constraints: 'Sound natural in the target language, never word for word. Keep names, numbers and links exactly as written.',
  },
  {
    id: 'describe',
    topic: 'write',
    name: 'Describe a product or service',
    shortcut: 'describe',
    intent: 'Writing',
    output: null,
    role: 'You are a copywriter.',
    objective: 'Write a description of the product or service I describe below: what it is, who it is for and what it includes.',
    context: '',
    constraints: 'Use concrete facts. No superlatives and no hype words. Stay under 120 words.',
  },
  {
    id: 'simple',
    topic: 'write',
    name: 'Explain it simply',
    shortcut: 'simple',
    intent: 'Teaching',
    output: null,
    role: 'You are a patient teacher.',
    objective: 'Explain the text I paste below to someone with no background in the subject.',
    context: '',
    constraints: 'Use one everyday example. No jargon.',
  },
  {
    id: 'summary',
    topic: 'think',
    name: 'Summarise a thread',
    shortcut: 'summary',
    intent: 'Analysis',
    output: null,
    role: 'You are an assistant.',
    objective: 'Summarise the conversation I paste below: what was asked, what was decided, what is still open and who owes what.',
    context: '',
    constraints: 'Use bullet points, 10 at most.',
  },
  {
    id: 'actions',
    topic: 'think',
    name: 'Notes to action list',
    shortcut: 'actions',
    intent: 'Planning',
    output: null,
    role: 'You are a project coordinator.',
    objective: 'Turn the notes I paste below into a list of tasks, each with an owner and a date when the notes give one.',
    context: '',
    constraints: 'Do not invent owners or dates. Mark a task with no owner as "Owner needed".',
  },
  {
    id: 'procedure',
    topic: 'think',
    name: 'Write a procedure',
    shortcut: 'procedure',
    intent: 'Planning',
    output: 'SOP',
    role: 'You are an operations manager.',
    objective: 'Turn the description I paste below into numbered steps a new colleague can follow on their first day.',
    context: '',
    constraints: 'One action per step. Plain words. Say what to do when something goes wrong.',
  },
  {
    id: 'compare',
    topic: 'think',
    name: 'Compare and recommend',
    shortcut: 'compare',
    intent: 'Analysis',
    output: null,
    role: 'You are an advisor.',
    objective: 'Compare the options I list below in a table on cost, effort and risk, then recommend one in two sentences.',
    context: '',
    constraints: 'Say which facts are missing. Do not guess numbers.',
  },
];

export const LIBRARY_BRAINS: LibraryBrain[] = [
  {
    id: 'company',
    name: 'Company facts',
    description: 'The basics your assistant needs to answer questions about your business.',
    items: [
      { name: 'Who we are', summary: 'What you do, for whom, and since when.', body: 'Write here: what you do, for whom, and since when.' },
      { name: 'Opening hours', summary: 'Days and times, and holiday changes.', body: 'Write here: days and times, and how holidays change them.' },
      { name: 'Contact details', summary: 'Phone, email, address and who answers what.', body: 'Write here: phone, email, address, and who answers what.' },
      { name: 'Prices and payment', summary: 'Main prices, payment methods, deposits and due dates.', body: 'Write here: main prices, accepted payment methods, deposit and due dates.' },
      { name: 'Policies', summary: 'Cancellations, refunds and changes.', body: 'Write here: cancellations, refunds and changes, in plain words.' },
    ],
  },
  {
    id: 'tone',
    name: 'Tone of voice',
    description: 'How your team writes, so drafts sound like you.',
    items: [
      { name: 'How we sound', summary: 'Three words that describe how you write.', body: 'Write here: three words that describe how you write to customers, such as warm, short, precise.' },
      { name: 'Words we use and avoid', summary: 'Preferred words and words you never use.', body: 'Write here: preferred words, and words you never use.' },
      { name: 'Example reply', summary: 'One reply you are proud of.', body: 'Paste here: one reply you are proud of.' },
    ],
  },
  {
    id: 'faq',
    name: 'Common questions',
    description: 'The questions you answer every week, with your usual answers.',
    items: [1, 2, 3].map((n) => ({
      name: `Question ${n}`,
      summary: 'A question you often get, with your usual answer.',
      body: 'Write the question on the first line and your usual answer below it.',
    })),
  },
];
