// Pro features: the ones that call the AI service, pictures in snippets, which
// are kept in storage, and email layouts.
//
// Each use of an AI feature costs real money, and the paid plan that will
// cover it does not exist yet. Until it does, every such entry point stays
// where people will find it, switched off, with a lock and the tooltip
// "Available to Pro users soon". A switched-off entry point cannot start a
// request: the control does nothing, and the code behind it is never reached.
// An email layout costs nothing to run, so its switch is on from the start,
// for everyone; the plan check joins it when the plan exists.
//
// One switch per feature, so each turns on when its server function is
// deployed and its plan check exists, independently of the others. The phone
// carries its own copy of the label and of the Ask and Picture switches
// (app/public/mobile/index.html); scripts/check-pro-gate.js fails CI if they
// drift.

/** The words every locked control shows, on every surface. */
export const PRO_SOON_LABEL = 'Available to Pro users soon';

export type ProFeature =
  /** FiboChat: the search panel's answer row. */
  | 'ask'
  /** Draft from text, in the snippet, prompt and Brain item editors. */
  | 'draft'
  /** Translate from EN, in the snippet editor. */
  | 'translate'
  /** Suggest labels, in the snippet editor. */
  | 'labels'
  /** Read a picture, in the phone's Save to Brain. On the phone only, which
      carries this switch as PICTURE_AVAILABLE. */
  | 'picture'
  /** Add a picture, in the snippet editor's side panel. Uploads to storage;
      calls no AI service. The fill surfaces show pictures already in a
      snippet whatever this says. */
  | 'snippetPictures'
  /** Use an email layout, in the snippet body's bar: an email, or an .html
      file, as the snippet. Calls no service. On for everyone until the plan
      exists (Valentina, 2026-10-27). */
  | 'emailLayout';

// Typed `boolean`, not left to infer `false`, so every call site reads as a
// live condition instead of dead code.
const AVAILABLE: Record<ProFeature, boolean> = {
  ask: false,
  draft: false,
  translate: false,
  labels: false,
  picture: false,
  snippetPictures: false,
  emailLayout: true,
};

/** Whether this feature may run. False for every AI feature until the Pro plan exists. */
export function isProFeatureAvailable(feature: ProFeature): boolean {
  return AVAILABLE[feature];
}
