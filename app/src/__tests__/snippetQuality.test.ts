import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateSnippet, isShortSnippet, type UnfinishedPiece } from '@/lib/snippetQuality';
import { evaluatePrompt } from '@/lib/usePromptEvaluator';
import { scoreCriteria } from '@/lib/qualityScore';
import { snippetStatusWeak, SNIPPET_WEAK_SCORE } from '@/lib/statusSignals';

// The snippet rating runs the same "looks unfinished" rule the extension and
// the phone run before a snippet goes out, so these tests load the shipping
// file rather than a copy of its rules.

type Unfinished = (text: string) => UnfinishedPiece[];
let unfinished: Unfinished;

beforeAll(() => {
  const ext = resolve(process.cwd(), '..', 'extension');
  new Function(readFileSync(resolve(ext, 'formula-engine.js'), 'utf8'))();
  new Function(readFileSync(resolve(ext, 'shared', 'fill-form.js'), 'utf8'))();
  const api = (globalThis as unknown as { SBFillForm: { unfinished: (t: string, f: unknown[]) => UnfinishedPiece[] } }).SBFillForm;
  unfinished = (text) => api.unfinished(text, []);
});

function rate(name: string, body: string) {
  return evaluateSnippet({ name, body, unfinished });
}

function status(name: string, body: string, id: string) {
  return rate(name, body).criteria.find((c) => c.id === id)?.status;
}

const STRONG_EN = `Hi {name},

Thanks for your order. Your invoice for {amount} is attached, and payment is due by 30 November.
You can pay by card at https://pay.example.com or by bank transfer to the account on the invoice.
Reply to this email if anything looks wrong.

Best regards,
Anna`;

const SLOPPY_EN = `we will send you the stuff and things etc as soon as we can, there is something wrong with the system right now and we dont really know when it will be fixed but it will be fixed eventually, the the team is working on it TBD and XXX for the rest`;

describe('scores', () => {
  it('rates a clear, complete message high', () => {
    const r = rate('Invoice and payment details', STRONG_EN);
    expect(r.pct).toBeGreaterThanOrEqual(80);
    expect(r.criteria.filter((c) => c.status !== 'pass').map((c) => `${c.id}: ${c.rationale}`)).toEqual([]);
  });

  it('rates a vague, unfinished text with a generic title low', () => {
    const r = rate('test', SLOPPY_EN);
    expect(r.score).toBeLessThanOrEqual(SNIPPET_WEAK_SCORE);
    expect(r.pct).toBeLessThan(50);
  });

  it('stays between 0 and 10 with one decimal', () => {
    for (const r of [rate('a', ''), rate('Invoice and payment details', STRONG_EN), rate('test', SLOPPY_EN)]) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(10);
      expect(Math.round(r.score * 10) / 10).toBe(r.score);
    }
  });

  it('gives the same score for the same input', () => {
    expect(rate('Invoice and payment details', STRONG_EN)).toEqual(rate('Invoice and payment details', STRONG_EN));
  });

  it('works the same way in Italian, Spanish and French', () => {
    const it_ = `Gentile {name},

grazie per l'ordine. La fattura di {amount} è allegata e il pagamento scade il 30 novembre.
Può pagare con carta su https://pay.example.com oppure con bonifico.
Ci scriva se qualcosa non torna.

Cordiali saluti,
Anna`;
    const es = `Hola {name}:

Gracias por su pedido. La factura de {amount} va adjunta y el pago vence el 30 de noviembre.
Puede pagar con tarjeta en https://pay.example.com o por transferencia.
Responda a este correo si algo no cuadra.

Saludos,
Anna`;
    const fr = `Bonjour {name},

Merci pour votre commande. La facture de {amount} est jointe et le paiement est dû le 30 novembre.
Vous pouvez payer par carte sur https://pay.example.com ou par virement.
Répondez à ce message si quelque chose ne va pas.

Cordialement,
Anna`;
    expect(rate('Fattura e pagamento', it_).pct).toBeGreaterThanOrEqual(80);
    expect(rate('Factura y pago', es).pct).toBeGreaterThanOrEqual(80);
    expect(rate('Facture et paiement', fr).pct).toBeGreaterThanOrEqual(80);
  });
});

describe('short snippets', () => {
  it('never marks a short snippet low for being short', () => {
    const cases: [string, string][] = [
      ['Sign-off', 'Thanks, talk soon!'],
      ['Office address', 'Via Roma 12, 20121 Milano'],
      ['Email signature', 'Anna Rossi, Customer team'],
    ];
    for (const [name, body] of cases) {
      expect(isShortSnippet(body)).toBe(true);
      expect(rate(name, body).pct).toBeGreaterThanOrEqual(80);
    }
  });

  it('judges a short snippet on clarity, title and leftovers only', () => {
    const ids = rate('Sign-off', 'Thanks, talk soon!').criteria.map((c) => c.id);
    expect(ids).toEqual(['sentences', 'specific-words', 'clean-wording', 'title', 'finished']);
  });

  it('still catches leftovers and a generic title in a short snippet', () => {
    expect(status('Sign-off', 'Thanks, [your name]', 'finished')).toBe('fail');
    expect(status('test', 'Thanks, talk soon!', 'title')).toBe('fail');
  });
});

describe('each rule', () => {
  it('counts the automatic greeting field as a greeting', () => {
    const body = '{greeting} {formtext: name=Client}, the parcel is ready at the front desk. You can collect it any day this week before six. Thanks, and talk soon.';
    expect(status('Parcel ready', body, 'start-finish')).toBe('pass');
  });

  it('reads fields as fillable, not as unfinished', () => {
    expect(status('Reminder', 'Hi {name}, your total is {=price * 1.1}.', 'finished')).toBe('pass');
  });

  it('flags notes and gaps with the shared unfinished rule', () => {
    expect(status('Reminder', 'The price is ??? and the date is TBD.', 'finished')).toBe('fail');
  });

  it('flags a broken template', () => {
    const c = rate('Reminder', 'Hello {if:x > 1}there').criteria.find((x) => x.id === 'finished');
    expect(c?.status).toBe('fail');
    expect(c?.rationale).toMatch(/endif/);
  });

  it('flags very long sentences', () => {
    const long = Array.from({ length: 50 }, (_, i) => `word${'abcdefghij'[i % 10]}`).join(' ');
    expect(status('Long note', long, 'sentences')).toBe('fail');
  });

  it('flags vague words', () => {
    expect(status('Note', 'Please bring the stuff and things etc to the office on Monday morning at nine.', 'specific-words')).toBe('fail');
  });

  it('flags repeated words, shouting and doubled punctuation', () => {
    const c = rate('Note', 'Please read the the notes carefully before the IMPORTANT MEETING tomorrow morning!!').criteria
      .find((x) => x.id === 'clean-wording');
    expect(c?.status).toBe('fail');
  });

  it('asks a message for a greeting and a sign-off, but not a plain notice', () => {
    expect(status('Note', 'You can collect the parcel from the front desk between 9 and 17 on weekdays, and on Saturday until noon.', 'start-finish')).toBe('fail');
    expect(status('Opening hours', 'The front desk is open between 9 and 17 on weekdays, and on Saturday until noon for collections.', 'start-finish')).toBe('pass');
  });

  it('looks for a next step', () => {
    expect(status('Note', 'Hello, the parcel arrived on Monday and it is now at the front desk for collection by Anna.', 'next-step')).toBe('partial');
    expect(status('Note', 'Hello, the parcel arrived on Monday. Can you collect it from the front desk today?', 'next-step')).toBe('pass');
  });

  it('flags pushy wording', () => {
    expect(status('Offer', 'Hurry, this is your last chance to get the amazing offer before Friday at noon!!!', 'tone')).toBe('fail');
  });

  it('accepts a title in capitals but flags one that exaggerates', () => {
    expect(status('PAYMENT REMINDER', STRONG_EN, 'title')).toBe('pass');
    expect(status('Amazing offer!', STRONG_EN, 'title')).toBe('partial');
    expect(status('Invoice (copy)', STRONG_EN, 'title')).toBe('fail');
  });

  it('accepts a one-word title on a short snippet only', () => {
    expect(status('Address', 'Via Roma 12, Milano', 'title')).toBe('pass');
    expect(status('Invoice', STRONG_EN, 'title')).toBe('partial');
  });

  it('suggests a fix for everything that is not passed', () => {
    for (const c of rate('test', SLOPPY_EN).criteria) {
      if (c.status !== 'pass') expect(c.example).toBeTruthy();
    }
  });
});

describe('shared score', () => {
  it('scores prompts exactly as before', () => {
    const r = evaluatePrompt({ blocks: [], strategyType: null, preferredModel: null, outputType: null });
    expect(scoreCriteria(r.criteria)).toEqual(r);
  });

  it('marks a snippet weak at 4 or below', () => {
    expect(snippetStatusWeak(4)).toBe(true);
    expect(snippetStatusWeak(4.1)).toBe(false);
  });
});
