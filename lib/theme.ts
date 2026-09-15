/**
 * Theme: system by default, with a manual override that persists.
 *
 * Read through useSyncExternalStore rather than an effect, like every other
 * browser-owned value in this app — it gives the server a defined snapshot so
 * there is no hydration mismatch, and avoids setting state just to learn what
 * the browser already knows.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'chaatak:theme';
export const THEME_EVENT = 'chaatak:theme-changed';

/**
 * Applied to <html> before React hydrates, so the page never paints in the
 * wrong theme and then correct itself. Inlined in the document head: a
 * flash of the wrong palette is trivial in daylight and genuinely unpleasant
 * at 3am, which is when this product is most likely to wake someone.
 */
export const THEME_BOOTSTRAP = `(function(){try{
var c=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(c==='light'||c==='dark'){document.documentElement.setAttribute('data-theme',c);}
}catch(e){}})();`;

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private mode: the choice applies for this session and does not persist.
  }

  // brand.css keys the dark palette off [data-theme='dark']; absent means
  // "follow prefers-color-scheme", which is what `system` is.
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  window.dispatchEvent(new Event(THEME_EVENT));
}

export function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}
