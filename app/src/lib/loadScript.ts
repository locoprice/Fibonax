/**
 * Loads one of the extension's plain scripts into the dashboard, once.
 *
 * The formula engine, the fill form, the memory chunker and the memory pack
 * are vanilla files under `/extension/*`, which `extensionScriptsPlugin`
 * serves in dev and copies into dist at build. The dashboard loads them as
 * script tags rather than carrying second implementations: the same rule must
 * give the same answer whether it ran in the extension, on the phone or here.
 *
 * A script is appended once and marked when it has loaded; a second caller
 * waits on the same tag. A tag that failed is removed, so the next call loads
 * the file afresh rather than waiting on events that have already fired.
 */
export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-sb-engine="${src}"]`);
    if (existing) {
      if (existing.dataset.sbLoaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), {
        once: true,
      });
      return;
    }

    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.dataset.sbEngine = src;
    el.addEventListener(
      'load',
      () => {
        el.dataset.sbLoaded = 'true';
        resolve();
      },
      { once: true },
    );
    el.addEventListener(
      'error',
      () => {
        el.remove();
        reject(new Error(`Could not load ${src}`));
      },
      { once: true },
    );
    document.head.appendChild(el);
  });
}
