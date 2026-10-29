/**
 * Loads one of the shared `/extension/*` scripts as a plain <script>, once.
 *
 * The dashboard reads some decisions from the same files the extension and the
 * phone run (the fill-form core, the usage analytics), rather than a copy, so
 * the three can never disagree. `extensionScriptsPlugin` in vite.config.ts
 * serves `/extension/*` in dev and copies it into dist at build. A second call
 * for the same file waits on the first instead of adding another tag.
 */
export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-sb-engine="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.sbLoaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error(`Could not load ${src}`)),
        { once: true },
      );
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
      () => reject(new Error(`Could not load ${src}`)),
      { once: true },
    );
    document.head.appendChild(el);
  });
}
