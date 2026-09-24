import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * languagesSnapshot is a useSyncExternalStore getSnapshot: it must return the
 * SAME object until the stored value changes, or React sees a new store on
 * every render and loops until "Maximum update depth exceeded". It did exactly
 * that for a returning visitor whose browser held only the pre-migration
 * voice key — the one case fresh test browsers never have.
 */

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

test('the snapshot is one object per stored value — including the migrated old key', async () => {
  const { languagesSnapshot } = await import('./local');
  const { DEFAULT_PREFERENCES } = await import('./preferences');

  // Nothing stored.
  assert.equal(languagesSnapshot(), DEFAULT_PREFERENCES);

  // Only the old single voice setting: carried over, and stable.
  store.set('chaatak:voice-lang', 'hi');
  const migrated = languagesSnapshot();
  assert.equal(migrated.voice, 'hi');
  assert.equal(migrated.ui, 'auto');
  assert.equal(languagesSnapshot(), migrated, 'same reference on every call');
  assert.equal(languagesSnapshot(), migrated);

  // The new key wins over the old one, and is just as stable.
  store.set('chaatak:languages', JSON.stringify({ ui: 'en', assistant: 'auto', voice: 'en' }));
  const current = languagesSnapshot();
  assert.notEqual(current, migrated);
  assert.equal(current.ui, 'en');
  assert.equal(languagesSnapshot(), current);

  // A corrupt value is the defaults — the same defaults every time.
  store.set('chaatak:languages', '{not json');
  assert.equal(languagesSnapshot(), DEFAULT_PREFERENCES);
  assert.equal(languagesSnapshot(), DEFAULT_PREFERENCES);
});
