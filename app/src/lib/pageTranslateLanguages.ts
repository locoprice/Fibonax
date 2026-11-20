/**
 * The languages the dashboard can be shown in.
 *
 * This is the list Google's page translator offers, read from its own menu on
 * 2026-11-16: the code is what Google expects (so `iw` for Hebrew and `jw` for
 * Javanese stay as Google spells them), the name is Google's English name, and
 * the third entry is the language's own name where it is known. English is the
 * language the dashboard is written in, so it is not in this list.
 *
 * Kept as a list in the app, not read from Google at run time, so nothing is
 * asked of Google until a person picks a language.
 */

export interface PageLanguage {
  /** Google's code for the language. */
  code: string;
  /** English name. */
  name: string;
  /** The language's own name. Same as `name` when it is not known. */
  native: string;
}

type Row = readonly [code: string, name: string, native?: string];

const ROWS: readonly Row[] = [
  ['ab', 'Abkhaz', 'Аԥсуа'],
  ['ace', 'Acehnese'],
  ['ach', 'Acholi'],
  ['aa', 'Afar', 'Afaraf'],
  ['af', 'Afrikaans'],
  ['sq', 'Albanian', 'Shqip'],
  ['alz', 'Alur'],
  ['am', 'Amharic', 'አማርኛ'],
  ['ar', 'Arabic', 'العربية'],
  ['hy', 'Armenian', 'Հայերեն'],
  ['as', 'Assamese', 'অসমীয়া'],
  ['av', 'Avar'],
  ['awa', 'Awadhi', 'अवधी'],
  ['ay', 'Aymara', 'Aymar aru'],
  ['az', 'Azerbaijani', 'Azərbaycan'],
  ['ban', 'Balinese'],
  ['bal', 'Baluchi'],
  ['bm', 'Bambara', 'Bamanankan'],
  ['bci', 'Baoulé'],
  ['ba', 'Bashkir', 'Башҡортса'],
  ['eu', 'Basque', 'Euskara'],
  ['btx', 'Batak Karo'],
  ['bts', 'Batak Simalungun'],
  ['bbc', 'Batak Toba'],
  ['be', 'Belarusian', 'Беларуская'],
  ['bem', 'Bemba'],
  ['bn', 'Bengali', 'বাংলা'],
  ['bew', 'Betawi'],
  ['bho', 'Bhojpuri', 'भोजपुरी'],
  ['bik', 'Bikol'],
  ['bs', 'Bosnian', 'Bosanski'],
  ['br', 'Breton', 'Brezhoneg'],
  ['bg', 'Bulgarian', 'Български'],
  ['bua', 'Buryat', 'Буряад'],
  ['yue', 'Cantonese', '粵語'],
  ['ca', 'Catalan', 'Català'],
  ['ceb', 'Cebuano'],
  ['ch', 'Chamorro'],
  ['ce', 'Chechen', 'Нохчийн'],
  ['ny', 'Chichewa'],
  ['zh-CN', 'Chinese (Simplified)', '简体中文'],
  ['zh-TW', 'Chinese (Traditional)', '繁體中文'],
  ['chk', 'Chuukese'],
  ['cv', 'Chuvash', 'Чӑвашла'],
  ['co', 'Corsican', 'Corsu'],
  ['crh', 'Crimean Tatar (Cyrillic)', 'Къырымтатарджа'],
  ['crh-Latn', 'Crimean Tatar (Latin)', 'Qırımtatarca'],
  ['hr', 'Croatian', 'Hrvatski'],
  ['cs', 'Czech', 'Čeština'],
  ['da', 'Danish', 'Dansk'],
  ['fa-AF', 'Dari', 'دری'],
  ['dv', 'Dhivehi', 'ދިވެހި'],
  ['din', 'Dinka'],
  ['doi', 'Dogri', 'डोगरी'],
  ['dov', 'Dombe'],
  ['nl', 'Dutch', 'Nederlands'],
  ['dyu', 'Dyula'],
  ['dz', 'Dzongkha', 'རྫོང་ཁ'],
  ['eo', 'Esperanto'],
  ['et', 'Estonian', 'Eesti'],
  ['ee', 'Ewe', 'Eʋegbe'],
  ['fo', 'Faroese', 'Føroyskt'],
  ['fj', 'Fijian', 'Vosa Vakaviti'],
  ['tl', 'Filipino'],
  ['fi', 'Finnish', 'Suomi'],
  ['fon', 'Fon'],
  ['fr', 'French', 'Français'],
  ['fr-CA', 'French (Canada)', 'Français (Canada)'],
  ['fy', 'Frisian', 'Frysk'],
  ['fur', 'Friulian', 'Furlan'],
  ['ff', 'Fulani', 'Fulfulde'],
  ['gaa', 'Ga'],
  ['gl', 'Galician', 'Galego'],
  ['ka', 'Georgian', 'ქართული'],
  ['de', 'German', 'Deutsch'],
  ['el', 'Greek', 'Ελληνικά'],
  ['gn', 'Guarani', 'Avañe’ẽ'],
  ['gu', 'Gujarati', 'ગુજરાતી'],
  ['ht', 'Haitian Creole', 'Kreyòl ayisyen'],
  ['cnh', 'Hakha Chin'],
  ['ha', 'Hausa'],
  ['haw', 'Hawaiian', 'ʻŌlelo Hawaiʻi'],
  ['iw', 'Hebrew', 'עברית'],
  ['hil', 'Hiligaynon'],
  ['hi', 'Hindi', 'हिन्दी'],
  ['hmn', 'Hmong'],
  ['hu', 'Hungarian', 'Magyar'],
  ['hrx', 'Hunsrik'],
  ['iba', 'Iban'],
  ['is', 'Icelandic', 'Íslenska'],
  ['ig', 'Igbo'],
  ['ilo', 'Ilocano'],
  ['id', 'Indonesian', 'Bahasa Indonesia'],
  ['iu-Latn', 'Inuktut (Latin)'],
  ['iu', 'Inuktut (Syllabics)', 'ᐃᓄᒃᑎᑐᑦ'],
  ['ga', 'Irish', 'Gaeilge'],
  ['it', 'Italian', 'Italiano'],
  ['jam', 'Jamaican Patois'],
  ['ja', 'Japanese', '日本語'],
  ['jw', 'Javanese', 'Basa Jawa'],
  ['kac', 'Jingpo'],
  ['kl', 'Kalaallisut'],
  ['kn', 'Kannada', 'ಕನ್ನಡ'],
  ['kr', 'Kanuri'],
  ['kk', 'Kazakh', 'Қазақ тілі'],
  ['kha', 'Khasi'],
  ['km', 'Khmer', 'ខ្មែរ'],
  ['cgg', 'Kiga'],
  ['kg', 'Kikongo'],
  ['rw', 'Kinyarwanda'],
  ['ktu', 'Kituba'],
  ['trp', 'Kokborok'],
  ['kv', 'Komi', 'Коми'],
  ['gom', 'Konkani', 'कोंकणी'],
  ['ko', 'Korean', '한국어'],
  ['kri', 'Krio'],
  ['ku', 'Kurdish (Kurmanji)', 'Kurdî'],
  ['ckb', 'Kurdish (Sorani)', 'کوردی'],
  ['ky', 'Kyrgyz', 'Кыргызча'],
  ['lo', 'Lao', 'ລາວ'],
  ['ltg', 'Latgalian'],
  ['la', 'Latin', 'Latina'],
  ['lv', 'Latvian', 'Latviešu'],
  ['lij', 'Ligurian', 'Ligure'],
  ['li', 'Limburgish', 'Limburgs'],
  ['ln', 'Lingala', 'Lingála'],
  ['lt', 'Lithuanian', 'Lietuvių'],
  ['lmo', 'Lombard'],
  ['lg', 'Luganda'],
  ['luo', 'Luo', 'Dholuo'],
  ['lb', 'Luxembourgish', 'Lëtzebuergesch'],
  ['mk', 'Macedonian', 'Македонски'],
  ['mad', 'Madurese'],
  ['mai', 'Maithili', 'मैथिली'],
  ['mak', 'Makassar'],
  ['mg', 'Malagasy'],
  ['ms', 'Malay', 'Bahasa Melayu'],
  ['ms-Arab', 'Malay (Jawi)'],
  ['ml', 'Malayalam', 'മലയാളം'],
  ['mt', 'Maltese', 'Malti'],
  ['mam', 'Mam'],
  ['gv', 'Manx', 'Gaelg'],
  ['mi', 'Maori', 'Māori'],
  ['mr', 'Marathi', 'मराठी'],
  ['mh', 'Marshallese'],
  ['mwr', 'Marwadi'],
  ['mfe', 'Mauritian Creole'],
  ['chm', 'Meadow Mari'],
  ['mni-Mtei', 'Meiteilon (Manipuri)'],
  ['min', 'Minang'],
  ['lus', 'Mizo'],
  ['mn', 'Mongolian', 'Монгол'],
  ['my', 'Myanmar (Burmese)', 'မြန်မာ'],
  ['nhe', 'Nahuatl (Eastern Huasteca)'],
  ['ndc-ZW', 'Ndau'],
  ['nr', 'Ndebele (South)'],
  ['new', 'Nepalbhasa (Newari)'],
  ['ne', 'Nepali', 'नेपाली'],
  ['bm-Nkoo', 'NKo'],
  ['se', 'Northern Sami', 'Davvisámegiella'],
  ['no', 'Norwegian', 'Norsk'],
  ['nus', 'Nuer'],
  ['oc', 'Occitan'],
  ['or', 'Odia (Oriya)', 'ଓଡ଼ିଆ'],
  ['om', 'Oromo', 'Afaan Oromoo'],
  ['os', 'Ossetian', 'Ирон'],
  ['pam', 'Pampanga', 'Kapampangan'],
  ['pag', 'Pangasinan'],
  ['pap', 'Papiamento', 'Papiamentu'],
  ['ps', 'Pashto', 'پښتو'],
  ['fa', 'Persian', 'فارسی'],
  ['pl', 'Polish', 'Polski'],
  ['pt', 'Portuguese (Brazil)', 'Português (Brasil)'],
  ['pt-PT', 'Portuguese (Portugal)', 'Português (Portugal)'],
  ['pa', 'Punjabi (Gurmukhi)', 'ਪੰਜਾਬੀ'],
  ['pa-Arab', 'Punjabi (Shahmukhi)', 'پنجابی'],
  ['qu', 'Quechua', 'Runasimi'],
  ['kek', 'Qʼeqchiʼ'],
  ['rom', 'Romani'],
  ['ro', 'Romanian', 'Română'],
  ['rn', 'Rundi', 'Ikirundi'],
  ['ru', 'Russian', 'Русский'],
  ['sm', 'Samoan', 'Gagana Samoa'],
  ['sg', 'Sango', 'Sängö'],
  ['sa', 'Sanskrit', 'संस्कृतम्'],
  ['sat-Latn', 'Santali (Latin)'],
  ['sat', 'Santali (Ol Chiki)'],
  ['gd', 'Scots Gaelic', 'Gàidhlig'],
  ['nso', 'Sepedi'],
  ['sr', 'Serbian', 'Српски'],
  ['st', 'Sesotho'],
  ['crs', 'Seychellois Creole'],
  ['shn', 'Shan'],
  ['sn', 'Shona', 'chiShona'],
  ['scn', 'Sicilian', 'Sicilianu'],
  ['szl', 'Silesian', 'Ślōnski'],
  ['sd', 'Sindhi', 'سنڌي'],
  ['si', 'Sinhala', 'සිංහල'],
  ['sk', 'Slovak', 'Slovenčina'],
  ['sl', 'Slovenian', 'Slovenščina'],
  ['so', 'Somali', 'Soomaali'],
  ['es', 'Spanish', 'Español'],
  ['su', 'Sundanese', 'Basa Sunda'],
  ['sus', 'Susu'],
  ['sw', 'Swahili', 'Kiswahili'],
  ['ss', 'Swati', 'siSwati'],
  ['sv', 'Swedish', 'Svenska'],
  ['ty', 'Tahitian', 'Reo Tahiti'],
  ['tg', 'Tajik', 'Тоҷикӣ'],
  ['ber-Latn', 'Tamazight'],
  ['ber', 'Tamazight (Tifinagh)', 'ⵜⴰⵎⴰⵣⵉⵖⵜ'],
  ['ta', 'Tamil', 'தமிழ்'],
  ['tt', 'Tatar', 'Татарча'],
  ['te', 'Telugu', 'తెలుగు'],
  ['tet', 'Tetum', 'Tetun'],
  ['th', 'Thai', 'ไทย'],
  ['bo', 'Tibetan', 'བོད་སྐད'],
  ['ti', 'Tigrinya', 'ትግርኛ'],
  ['tiv', 'Tiv'],
  ['tpi', 'Tok Pisin'],
  ['to', 'Tongan', 'Lea fakatonga'],
  ['lua', 'Tshiluba'],
  ['ts', 'Tsonga', 'Xitsonga'],
  ['tn', 'Tswana', 'Setswana'],
  ['tcy', 'Tulu', 'ತುಳು'],
  ['tum', 'Tumbuka', 'chiTumbuka'],
  ['tr', 'Turkish', 'Türkçe'],
  ['tk', 'Turkmen', 'Türkmen'],
  ['tyv', 'Tuvan', 'Тыва'],
  ['ak', 'Twi'],
  ['udm', 'Udmurt', 'Удмурт'],
  ['uk', 'Ukrainian', 'Українська'],
  ['ur', 'Urdu', 'اردو'],
  ['ug', 'Uyghur', 'ئۇيغۇرچە'],
  ['uz', 'Uzbek', 'Oʻzbek'],
  ['ve', 'Venda', 'Tshivenḓa'],
  ['vec', 'Venetian', 'Vèneto'],
  ['vi', 'Vietnamese', 'Tiếng Việt'],
  ['war', 'Waray'],
  ['cy', 'Welsh', 'Cymraeg'],
  ['wo', 'Wolof'],
  ['xh', 'Xhosa', 'isiXhosa'],
  ['sah', 'Yakut', 'Саха тыла'],
  ['yi', 'Yiddish', 'ייִדיש'],
  ['yo', 'Yoruba', 'Yorùbá'],
  ['yua', 'Yucatec Maya'],
  ['zap', 'Zapotec'],
  ['zu', 'Zulu', 'isiZulu'],
];

/** Every language on offer, A to Z by English name. */
export const PAGE_LANGUAGES: readonly PageLanguage[] = ROWS.map(([code, name, native]) => ({
  code,
  name,
  native: native ?? name,
}));

const BY_CODE = new Map(PAGE_LANGUAGES.map((language) => [language.code, language]));

export function findPageLanguage(code: string): PageLanguage | null {
  return BY_CODE.get(code) ?? null;
}

/** Lower case, accents dropped, so "espanol" finds "Español". */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Languages whose English name, own name or code contains what was typed. */
export function searchPageLanguages(query: string): readonly PageLanguage[] {
  const needle = plain(query);
  if (needle === '') return PAGE_LANGUAGES;
  return PAGE_LANGUAGES.filter(
    (language) =>
      plain(language.name).includes(needle) ||
      plain(language.native).includes(needle) ||
      language.code.toLowerCase() === needle,
  );
}

/**
 * The languages this browser asks for, in its order, that are on offer.
 *
 * A browser says `it-IT` or `pt-BR` where Google says `it` or `pt`, so a tag
 * with no exact match falls back to its first part.
 */
export function suggestedPageLanguages(browserLanguages: readonly string[]): PageLanguage[] {
  const out: PageLanguage[] = [];
  for (const tag of browserLanguages) {
    const match =
      PAGE_LANGUAGES.find((l) => l.code.toLowerCase() === tag.toLowerCase()) ??
      findPageLanguage(tag.split('-')[0]?.toLowerCase() ?? '');
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}
