/**
 * Which language the bot speaks — decided from Chaatak's existing
 * preferences, never from a Telegram-only one.
 *
 * There is no telegram_lang, deliberately. The bot is the assistant in
 * another window, so it follows `assistant_lang`, and `auto` means what it
 * means on the web: mirror the person. For a typed question the pipeline
 * mirrors the question itself. This file answers the harder case — a tap on
 * a button, a shared location, /start — where there are no words to mirror.
 *
 * The chain, first match wins:
 *
 *   1. assistant_lang, when the account set one     an explicit choice
 *   2. the language of this chat's last turn        mirroring, over time
 *   3. ui_lang, when the account set one            still an explicit choice
 *   4. Telegram's own language_code                 the initial fallback only
 *   5. English
 *
 * Telegram's language_code is the device's language, the same kind of signal
 * as `navigator.languages` on the web. It is consulted only once every
 * Chaatak preference has been asked, so it can never override one.
 */

import {
  interfaceLanguage,
  isLanguageCode,
  type InterfaceLang,
  type LanguageCode,
} from '../i18n/languages';
import type { LanguagePreference } from '../i18n/preferences';

export type LanguageSignals = {
  /** From the linked account, or null for a guest. */
  assistant: LanguagePreference | null;
  ui: LanguagePreference | null;
  /** The language the conversation was last carried on in, if recent. */
  lastTurn: LanguageCode | null;
  /** `from.language_code`, e.g. "hi" or "en-GB". */
  telegram: string | null | undefined;
};

/** Telegram's IETF tag reduced to one of the seven, or null. */
export function fromTelegramCode(tag: string | null | undefined): LanguageCode | null {
  if (!tag) return null;
  const primary = tag.toLowerCase().split('-')[0];
  return isLanguageCode(primary) ? primary : null;
}

export function chatLanguage(signals: LanguageSignals): LanguageCode {
  if (signals.assistant && signals.assistant !== 'auto') return signals.assistant;
  if (signals.lastTurn) return signals.lastTurn;
  if (signals.ui && signals.ui !== 'auto') return signals.ui;
  return fromTelegramCode(signals.telegram) ?? 'en';
}

/** The same answer, narrowed to a language the string catalogue is written in. */
export function chromeLanguage(signals: LanguageSignals): InterfaceLang {
  return interfaceLanguage(chatLanguage(signals));
}
