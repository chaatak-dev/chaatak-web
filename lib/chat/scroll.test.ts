/**
 * The scroll rules, asserted rather than eyeballed.
 *
 * Scroll behaviour is normally only testable by watching it, which means it
 * is normally only tested once. The decisions are pure functions so they can
 * be checked here, and the component is left with nothing but the plumbing.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  distanceFromBottom,
  isNearBottom,
  isScrollable,
  NEAR_BOTTOM_PX,
  preservedScrollTop,
  shouldFollow,
  showsJumpToLatest,
} from './scroll';

/** A transcript taller than its container, scrolled to `scrollTop`. */
const at = (scrollTop: number) => ({
  scrollTop,
  scrollHeight: 4000,
  clientHeight: 800,
});

const PINNED = at(3200);
const SCROLLED_UP = at(1000);

test('distance from the bottom is measured, and never negative', () => {
  assert.equal(distanceFromBottom(PINNED), 0);
  assert.equal(distanceFromBottom(SCROLLED_UP), 2200);
  // Overscroll on a touch device reports past the end.
  assert.equal(distanceFromBottom(at(3300)), 0);
});

test('a few pixels off the bottom still counts as the bottom', () => {
  // Browsers report fractional offsets; an exact comparison drops out of
  // follow mode on a rounding error.
  assert.equal(isNearBottom(at(3200 - 1)), true);
  assert.equal(isNearBottom(at(3200 - NEAR_BOTTOM_PX)), true);
  assert.equal(isNearBottom(at(3200 - NEAR_BOTTOM_PX - 1)), false);
});

test('a transcript that fits its container is always at the bottom', () => {
  const short = { scrollTop: 0, scrollHeight: 400, clientHeight: 800 };
  assert.equal(isScrollable(short), false);
  assert.equal(isNearBottom(short), true);
  assert.equal(shouldFollow(true, short), true);
  // Nothing to jump to.
  assert.equal(showsJumpToLatest(false, short), false);
});

/* ---- the rule that matters ----------------------------------------- */

test('a reader who has scrolled up is not dragged back down', () => {
  // The single most irritating thing a chat log can do, and it happens
  // exactly when someone is re-reading a number they were told.
  assert.equal(shouldFollow(false, SCROLLED_UP), false);
});

test('a reader at the bottom follows the conversation', () => {
  assert.equal(shouldFollow(true, PINNED), true);
});

test('new content does not change who is in control', () => {
  // Arriving content must not re-pin a reader who scrolled away, and must not
  // unpin one who did not.
  const grown = { scrollTop: 1000, scrollHeight: 6000, clientHeight: 800 };
  assert.equal(shouldFollow(false, grown), false);
  assert.equal(shouldFollow(true, grown), true);
});

/* ---- the jump-to-latest control ------------------------------------ */

test('jump-to-latest appears only when there is somewhere to jump to', () => {
  assert.equal(showsJumpToLatest(false, SCROLLED_UP), true);
  // Already there: the button would do nothing.
  assert.equal(showsJumpToLatest(true, PINNED), false);
  assert.equal(showsJumpToLatest(false, PINNED), false);
  // Just above the threshold is still "there".
  assert.equal(showsJumpToLatest(false, at(3200 - NEAR_BOTTOM_PX)), false);
});

/* ---- prepending history -------------------------------------------- */

test('loading older messages keeps the same line under the same pixel', () => {
  // 1200px of history inserted above. Without the correction the view jumps
  // by exactly that much and the reader loses their place.
  assert.equal(preservedScrollTop(4000, 5200, 1000), 2200);
});

test('preserving a position never scrolls above the top', () => {
  assert.equal(preservedScrollTop(5200, 4000, 100), 0);
});

test('nothing added means nothing moved', () => {
  assert.equal(preservedScrollTop(4000, 4000, 1234), 1234);
});
