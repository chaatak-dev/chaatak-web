/**
 * Telegram HTML, escaped.
 *
 * HTML rather than Markdown, on purpose. Legacy Markdown has no escape for a
 * stray underscore or asterisk, and district names, place names typed by a
 * person and a model's prose can all contain one — the result is a 400 from
 * Telegram and a message that never arrives. HTML needs exactly three
 * characters escaped and nothing else, so every piece of text that did not
 * come from this codebase goes through `esc` and cannot break the markup.
 */

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const b = (text: string) => `<b>${esc(text)}</b>`;
export const i = (text: string) => `<i>${esc(text)}</i>`;

/** Lines joined, with empty ones dropped so an absent part leaves no gap. */
export function lines(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');
}

/** Blocks separated by a blank line. */
export function blocks(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n\n');
}

/** Telegram's limit for one message's text, after entities are parsed. */
export const MESSAGE_LIMIT = 4096;
