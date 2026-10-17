/**
 * Ready-made option lists for the dropdown menu builder (Predefined options).
 *
 * Picking one fills the menu's values; nothing about the list is saved in the
 * token, so a menu filled from one is an ordinary menu afterwards. Each list is
 * written in the snippet's language, because its options print in the message
 * itself. Every list works in any trade (root CLAUDE.md, Industry-Neutral).
 *
 * Days and months match the engine's DATE_WORDS (extension/formula-engine.js):
 * lower case in Italian, Spanish and French, as they are written mid-sentence.
 * No option may hold `,` `;` `{` or `}`, the token grammar's own delimiters.
 */

/** The languages a list is written in. Multi falls back to English. */
type PresetLanguage = 'EN' | 'IT' | 'ES' | 'FR';

export type MenuPresetId = 'days' | 'months' | 'yesno' | 'numbers' | 'satisfaction' | 'priority';

interface MenuPreset {
  id: MenuPresetId;
  /** What the builder's dropdown shows. Interface text, so English only. */
  label: string;
  options: Record<PresetLanguage, readonly string[]>;
}

const ONE_TO_TEN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;

export const MENU_PRESETS: readonly MenuPreset[] = [
  {
    id: 'days',
    label: 'Days of the week',
    options: {
      EN: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      IT: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'],
      ES: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
      FR: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
    },
  },
  {
    id: 'months',
    label: 'Months',
    options: {
      EN: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December'],
      IT: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
        'settembre', 'ottobre', 'novembre', 'dicembre'],
      ES: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
        'septiembre', 'octubre', 'noviembre', 'diciembre'],
      FR: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
        'septembre', 'octobre', 'novembre', 'décembre'],
    },
  },
  {
    id: 'yesno',
    label: 'Yes / No',
    options: {
      EN: ['Yes', 'No'],
      IT: ['Sì', 'No'],
      ES: ['Sí', 'No'],
      FR: ['Oui', 'Non'],
    },
  },
  {
    id: 'numbers',
    label: 'Numbers 1 to 10',
    options: { EN: ONE_TO_TEN, IT: ONE_TO_TEN, ES: ONE_TO_TEN, FR: ONE_TO_TEN },
  },
  {
    id: 'satisfaction',
    label: 'Satisfaction',
    options: {
      EN: ['Very satisfied', 'Satisfied', 'Neutral', 'Unsatisfied', 'Very unsatisfied'],
      IT: ['Molto soddisfatto', 'Soddisfatto', 'Neutrale', 'Insoddisfatto', 'Molto insoddisfatto'],
      ES: ['Muy satisfecho', 'Satisfecho', 'Neutral', 'Insatisfecho', 'Muy insatisfecho'],
      FR: ['Très satisfait', 'Satisfait', 'Neutre', 'Insatisfait', 'Très insatisfait'],
    },
  },
  {
    id: 'priority',
    label: 'Priority',
    options: {
      EN: ['High', 'Medium', 'Low'],
      IT: ['Alta', 'Media', 'Bassa'],
      ES: ['Alta', 'Media', 'Baja'],
      FR: ['Haute', 'Moyenne', 'Basse'],
    },
  },
];

function presetLanguage(language: string): PresetLanguage {
  return language === 'IT' || language === 'ES' || language === 'FR' ? language : 'EN';
}

/** The options of one list, in the snippet's language; [] for an unknown id. */
export function menuPresetOptions(id: string, language: string): string[] {
  const preset = MENU_PRESETS.find((p) => p.id === id);
  return preset ? [...preset.options[presetLanguage(language)]] : [];
}
