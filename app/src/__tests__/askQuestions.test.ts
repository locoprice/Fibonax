import { describe, expect, it } from 'vitest';
import {
  MAX_SEARCHES,
  findQuestions,
  mergeRanked,
  searchQueries,
} from '../../../services/supabase/functions/ask-sprintbrain/questions';

// Contextual replies — the server half.
//
// FiboChat answers a whole message question by question. These rules decide
// what is searched for: each question on its own, so a message asking about
// three subjects finds the items for all three, not only for the strongest.

const MESSAGE = `Hi there,

Thanks for getting back to me so quickly. Is the invoice sent by email or by post?
Also, could you tell me how long a refund takes. I would like to know whether weekend support is available, too.

Best regards,
Sam`;

describe('findQuestions', () => {
  it('finds every question and request in a message, in order, and nothing else', () => {
    expect(findQuestions(MESSAGE)).toEqual([
      'Is the invoice sent by email or by post?',
      'Also, could you tell me how long a refund takes.',
      'I would like to know whether weekend support is available, too.',
    ]);
  });

  it('reads Italian, Spanish and French requests written without a question mark', () => {
    expect(findQuestions('Buongiorno. Vorrei sapere gli orari di apertura. Grazie')).toEqual([
      'Vorrei sapere gli orari di apertura.',
    ]);
    expect(findQuestions('Hola. ¿Aceptan pagos con tarjeta? Me gustaría saber el plazo de entrega.')).toEqual([
      '¿Aceptan pagos con tarjeta?',
      'Me gustaría saber el plazo de entrega.',
    ]);
    expect(findQuestions('Bonjour. Pourriez-vous envoyer le devis. Merci.')).toEqual(['Pourriez-vous envoyer le devis.']);
  });

  it('keeps statements out, including Spanish ones that open like a request', () => {
    expect(findQuestions('Puede que llegue tarde. I paid last week. When I called, nobody answered.')).toEqual([]);
  });

  it('finds questions in a message pasted into a one-line box, where line breaks became spaces', () => {
    expect(findQuestions(MESSAGE.replace(/\s*\n\s*/g, ' '))).toHaveLength(3);
  });

  it('counts a question once, and skips one with nothing to search for', () => {
    expect(findQuestions('Is support open on Sunday? Why? is support open on sunday?')).toEqual([
      'Is support open on Sunday?',
    ]);
  });
});

describe('searchQueries', () => {
  it('searches a single question once, as it always was', () => {
    expect(searchQueries('What is the refund policy?')).toEqual(['What is the refund policy?']);
    expect(searchQueries('refund policy')).toEqual(['refund policy']);
  });

  it('searches each question of a message, then the whole message', () => {
    const queries = searchQueries(MESSAGE);
    expect(queries.slice(0, 3)).toEqual(findQuestions(MESSAGE));
    expect(queries[3]).toBe(MESSAGE.replace(/\s+/g, ' ').trim());
  });

  it('never runs more searches than the cap', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Is option number ${i + 1} available today?`).join(' ');
    const queries = searchQueries(many);
    expect(queries).toHaveLength(MAX_SEARCHES);
    expect(queries[MAX_SEARCHES - 1]).toBe(many);
  });
});

describe('mergeRanked', () => {
  const hit = (id: string) => ({ kind: 'snippet', source_id: id });

  it('gives every question its best item before any question gets a second', () => {
    const merged = mergeRanked([[hit('a1'), hit('a2'), hit('a3')], [hit('b1'), hit('b2')], [hit('c1')]], 5);
    expect(merged.map((h) => h.source_id)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2']);
  });

  it('keeps an item found twice in its first place only', () => {
    const merged = mergeRanked([[hit('a'), hit('b')], [hit('b'), hit('c')]], 10);
    expect(merged.map((h) => h.source_id)).toEqual(['a', 'b', 'c']);
  });

  it('returns one list as it was, cut to the cap', () => {
    const merged = mergeRanked([[hit('1'), hit('2'), hit('3')]], 2);
    expect(merged.map((h) => h.source_id)).toEqual(['1', '2']);
    expect(mergeRanked([], 6)).toEqual([]);
  });
});
