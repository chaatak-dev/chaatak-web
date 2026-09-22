/**
 * When a transcript should follow the conversation, and when it should leave
 * the reader alone.
 *
 * The rule people actually expect, and almost never say out loud: a chat
 * scrolls itself only while you are already at the bottom. The moment you
 * scroll up to re-read something, it must stop moving — being yanked back
 * down mid-sentence is the single most irritating thing a chat log can do,
 * and it happens precisely when someone is trying to check a number they were
 * told.
 *
 * The decisions are pure functions here so they can be asserted. The DOM
 * plumbing that calls them lives in the component.
 */

/**
 * How close to the bottom still counts as "at the bottom", in pixels.
 *
 * Generous on purpose. A reader who has drifted up by half a line has not
 * decided to go back and read anything, and a threshold of zero would drop
 * out of follow mode on a rounding error — browsers report fractional scroll
 * offsets, and `scrollTop + clientHeight` rarely equals `scrollHeight`
 * exactly even when pinned.
 */
export const NEAR_BOTTOM_PX = 96;

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** Distance from the bottom, never negative (overscroll reports past it). */
export function distanceFromBottom(m: ScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.scrollTop - m.clientHeight);
}

export function isNearBottom(m: ScrollMetrics, threshold = NEAR_BOTTOM_PX): boolean {
  return distanceFromBottom(m) <= threshold;
}

/**
 * A transcript shorter than its container cannot be scrolled away from, so it
 * is always "at the bottom" — and a jump-to-latest control for it would be a
 * button that does nothing.
 */
export function isScrollable(m: ScrollMetrics): boolean {
  return m.scrollHeight > m.clientHeight + 1;
}

/**
 * Should the view follow new content?
 *
 * `pinned` is the state the component keeps: true while the reader is at the
 * bottom, false from the moment they scroll up, true again when they come
 * back down. New content never changes it — only the reader does.
 */
export function shouldFollow(pinned: boolean, m: ScrollMetrics): boolean {
  if (!isScrollable(m)) return true;
  return pinned;
}

/**
 * Is the jump-to-latest control worth showing?
 *
 * Only when there is somewhere to jump to AND the reader is not already
 * there. Showing it while pinned would be an invitation to do what is already
 * happening.
 */
export function showsJumpToLatest(pinned: boolean, m: ScrollMetrics): boolean {
  return isScrollable(m) && !pinned && distanceFromBottom(m) > NEAR_BOTTOM_PX;
}

/**
 * Where to scroll to keep the reader looking at the same content after
 * something was added ABOVE it.
 *
 * Older messages loaded in at the top push everything down by exactly the
 * height that was inserted. Keeping `scrollHeight - scrollTop` constant keeps
 * the same line under the same pixel, which is the difference between "more
 * history appeared" and "the page jumped".
 */
export function preservedScrollTop(
  previousScrollHeight: number,
  nextScrollHeight: number,
  previousScrollTop: number,
): number {
  return Math.max(0, previousScrollTop + (nextScrollHeight - previousScrollHeight));
}
