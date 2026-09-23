/**
 * The Telegram bot: one update in, the right messages out.
 *
 * It is a CLIENT of Chaatak, not a second Chaatak. Every question goes
 * through `answerQuestion` — the same parser, place pipeline, snapshot and
 * verification gate the website uses. Every weather card is a snapshot from
 * `snapshotFor`. Saved places are the account's monitored locations, changed
 * through the same store functions and the same three-place limit. Language
 * follows the account's existing preferences. What this file adds is only
 * what a chat needs and a browser does not: somewhere to keep the
 * conversation, and Telegram's own ways of asking — keyboards, buttons, a
 * location share.
 *
 * Every dependency is passed in, so the whole of it runs in a test with a
 * memory store and a recording Telegram.
 */

import { firstName, greeting } from '../i18n/greetings';
import { isLanguagePreference, type LanguagePreferences } from '../i18n/preferences';
import type { InterfaceLang, LanguageCode } from '../i18n/languages';
import { replyLanguage } from '../i18n/detect';
import { translate, type StringKey, type Vars } from '../i18n/strings';
import { districtKey } from '../accounts/store';
import {
  MAX_MONITORED,
  type AddLocationResult,
  type MonitoredLocation,
  type Profile,
} from '../accounts/types';
import type { Answer, AnswerInput } from '../chat/answer';
import type { Message, StandingQuery } from '../chat/types';
import { wantsCurrentLocation } from '../parse/location-intent';
import { patternParser } from '../parse/patterns';
import type { ParseResult } from '../parse/types';
import { rateLimit } from '../ratelimit';
import type { WeatherSnapshot } from '../weather/api';
import { districtOf } from '../weather/snapshot';
import type { Location, NoData } from '../weather/types';
import type { TelegramResult } from './api';
import { chromeLanguage, chatLanguage } from './language';
import { hashLinkToken, maskEmail, readLinkPayload } from './link';
import {
  alertsMessage,
  answerMessage,
  askPlaceMessage,
  connectUrl,
  helpMessage,
  isPlacesKey,
  linkConfirmMessage,
  mainKeyboard,
  note,
  placeKey,
  placesMessage,
  settingsMessage,
  siteUrl,
  unlinkConfirmMessage,
  weatherCard,
  welcomeMessage,
  type WatchOffer,
} from './render';
import type { ChatContext, ChatRecord, TelegramStore } from './store';
import type {
  InlineKeyboard,
  OutgoingMessage,
  TgCallbackQuery,
  TgChatMemberUpdated,
  TgMessage,
  TgUpdate,
  TgUser,
} from './types';

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

/** The account functions the bot uses — the web's own, passed in. */
export type AccountsPort = {
  profile(userId: string): Promise<Profile | null>;
  locations(userId: string): Promise<MonitoredLocation[]>;
  addLocation(userId: string, place: Location): Promise<AddLocationResult>;
  removeLocation(userId: string, id: string): Promise<boolean>;
  saveLanguages(userId: string, preferences: LanguagePreferences): Promise<unknown>;
};

export type BotDeps = {
  /** One Bot API call. The real one retries a transient failure once. */
  send(method: string, params: Record<string, unknown>): Promise<TelegramResult<unknown>>;
  store: TelegramStore;
  answer(input: AnswerInput): Promise<Answer>;
  snapshot(place: Location): Promise<WeatherSnapshot>;
  resolvePlace(query: string): Promise<Location | NoData>;
  resolvePoint(latitude: number, longitude: number): Location | NoData;
  accounts: AccountsPort;
  site?: string;
  now?: () => Date;
};

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/**
 * A conversation this old is let go: the next question starts fresh rather
 * than inheriting "Delhi" from yesterday afternoon. Twelve hours carries a
 * morning question into the evening and no further.
 */
const CONTEXT_TTL_MS = 12 * 60 * 60 * 1000;

/** How long "which place?" waits for its answer. */
const PENDING_TTL_MS = 15 * 60 * 1000;

/**
 * The longest question passed on. Telegram allows 4096 characters; a weather
 * question is a sentence, and everything past this would only be spent as
 * model tokens.
 */
const MAX_QUESTION_CHARS = 1_000;

const MAX_HISTORY = 8;
const MAX_TURN_CHARS = 600;
const MAX_PLACES = 8;

/**
 * Per chat, per minute. Loose on purpose — a person tapping through places
 * and asking a few questions is using the bot — and it exists to stop a stuck
 * client or a script from spending the free-tier model budget. In-process,
 * like every limiter here, and not a security boundary.
 */
const RATE = { limit: 20, windowMs: 60_000 };

/* ------------------------------------------------------------------ */
/* Pure helpers, exported for tests                                    */
/* ------------------------------------------------------------------ */

/** Drop what has gone stale, and hold everything to its bound. */
export function boundContext(context: ChatContext, now: Date): ChatContext {
  const at = context.at ? Date.parse(context.at) : NaN;
  const fresh = Number.isFinite(at) && now.getTime() - at < CONTEXT_TTL_MS;

  const pendingAt = context.pending ? Date.parse(context.pending.at) : NaN;
  const pendingFresh =
    Number.isFinite(pendingAt) && now.getTime() - pendingAt < PENDING_TTL_MS;

  return {
    standing: fresh ? (context.standing ?? null) : null,
    history: fresh
      ? (context.history ?? [])
          .slice(-MAX_HISTORY)
          .map((m) => ({ ...m, text: m.text.slice(0, MAX_TURN_CHARS) }))
      : [],
    pending: fresh && pendingFresh ? (context.pending ?? null) : null,
    places: (context.places ?? []).slice(-MAX_PLACES),
    at: context.at,
  };
}

/** Recent places, newest last, one entry per place. */
function rememberPlace(places: Location[] | undefined, place: Location): Location[] {
  const key = placeKey(place);
  return [...(places ?? []).filter((p) => placeKey(p) !== key), place].slice(-MAX_PLACES);
}

/**
 * Is this message just a place — the answer to "which place?" — rather than a
 * new question?
 *
 * Decided by the existing parser, not a second one: a query that names a
 * place and asks nothing else in particular. "Ghaziabad" is; "Ghaziabad
 * tomorrow" and "rain in Ghaziabad" are questions of their own.
 */
export function isBarePlace(parsed: ParseResult | null): parsed is Extract<ParseResult, { kind: 'query' }> {
  return (
    parsed?.kind === 'query' &&
    !parsed.placeWasImplied &&
    parsed.intent === 'current' &&
    parsed.timeWindow.kind === 'now' &&
    parsed.variable === 'all'
  );
}

/**
 * Hello, in the ways people say it here.
 *
 * Not a parser of weather questions — the pipeline is that. It exists because
 * a greeting is the most common first message a bot receives, and the
 * pipeline reads a lone "hello" as a place name and answers that no place
 * matched it. A chat should say hello back.
 */
const GREETING =
  /^(?:hi+|hello+|hey+|hii+|helo|namaste|namaskar|namaskaar|ram ram|jai hind|good (?:morning|afternoon|evening)|नमस्ते|नमस्कार|राम राम|हेलो|हाय|प्रणाम)[\s!.,।🙏]*$/iu;

export function isGreeting(text: string): boolean {
  return GREETING.test(text.trim());
}

/** "/weather@ChaatakBot Delhi" → { command: 'weather', arg: 'Delhi' }. */
export function readCommand(text: string): { command: string; arg: string } | null {
  const match = /^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), arg: (match[2] ?? '').trim() };
}

/** A place key from callback data, or null for anything malformed. */
export function readPlaceKey(key: string): { latitude: number; longitude: number } | null {
  const match = /^(-?\d{1,2}\.\d{4}),(-?\d{1,3}\.\d{4})$/.exec(key);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** "Yash (ya•••@gmail.com)", or whichever half exists. */
export function accountLabel(profile: Pick<Profile, 'name' | 'email'> | null): string {
  const masked = maskEmail(profile?.email);
  const name = firstName(profile?.name);
  if (name && masked) return `${name} (${masked})`;
  return name ?? masked ?? '—';
}

/** What a monitored location looks like as a place the pipeline can use. */
function asLocation(saved: MonitoredLocation): Location {
  return {
    name: saved.placeName,
    admin1: saved.state ?? undefined,
    admin2: saved.district,
    country: 'India',
    countryCode: 'IN',
    latitude: saved.latitude,
    longitude: saved.longitude,
    timezone: saved.timezone,
    resolvedBy: saved.resolvedBy ?? 'Chaatak monitored location',
    endpoint: saved.endpoint ?? 'monitored_locations',
  };
}

/* ------------------------------------------------------------------ */
/* The bot                                                             */
/* ------------------------------------------------------------------ */

type Session = {
  chatId: number;
  from: TgUser | undefined;
  record: ChatRecord;
  profile: Profile | null;
  context: ChatContext;
  /** The chat's language: assistant preference, then mirroring, then fallbacks. */
  lang: LanguageCode;
  /** The same, narrowed to a language the catalogue is written in. */
  chrome: InterfaceLang;
};

export function createBot(deps: BotDeps) {
  const now = deps.now ?? (() => new Date());
  const site = deps.site ?? siteUrl();

  /* ---- plumbing ---------------------------------------------------- */

  /**
   * A store call that must not cost anyone their answer.
   *
   * The database holds conversation context and links, not weather. If it is
   * down, a question still gets answered — without the follow-up memory — in
   * the same spirit as the website shipping an answer when history cannot be
   * saved.
   */
  async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'telegram.store.failed',
          op: label,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return fallback;
    }
  }

  function params(chatId: number, message: OutgoingMessage): Record<string, unknown> {
    return {
      chat_id: chatId,
      text: message.html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(message.markup ? { reply_markup: message.markup } : {}),
      ...(message.silent ? { disable_notification: true } : {}),
    };
  }

  async function send(chatId: number, message: OutgoingMessage): Promise<void> {
    const result = await deps.send('sendMessage', params(chatId, message));
    if (!result.ok) {
      console.warn(
        JSON.stringify({
          event: 'telegram.send.failed',
          status: result.status,
          description: result.description,
        }),
      );
    }
  }

  /**
   * Replace a message in place — the list you are looking at updates rather
   * than a new copy of it arriving underneath. Falls back to sending when the
   * original cannot be edited any more.
   */
  async function edit(chatId: number, messageId: number | undefined, message: OutgoingMessage) {
    if (messageId === undefined) return send(chatId, message);
    const markup = message.markup && 'inline_keyboard' in message.markup ? message.markup : undefined;
    const result = await deps.send('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: message.html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(markup ? { reply_markup: markup } : {}),
    });
    if (result.ok || /message is not modified/i.test(result.description)) return;
    await send(chatId, message);
  }

  async function toast(callbackId: string, text?: string, asAlert = false): Promise<void> {
    await deps.send('answerCallbackQuery', {
      callback_query_id: callbackId,
      ...(text ? { text: text.slice(0, 200), show_alert: asAlert } : {}),
    });
  }

  /** "Chaatak is typing…" while the pipeline works. Never awaited for. */
  function busy(chatId: number, action: 'typing' | 'find_location' = 'typing'): void {
    void deps.send('sendChatAction', { chat_id: chatId, action }).catch(() => {});
  }

  function t(session: Session, key: StringKey, vars?: Vars): string {
    return translate(key, session.chrome, vars);
  }

  /* ---- a session per update --------------------------------------- */

  async function open(chatId: number, from: TgUser | undefined): Promise<Session> {
    const stored = await safe('readChat', () => deps.store.readChat(chatId), null);
    const record: ChatRecord = stored ?? {
      chatId,
      userId: null,
      displayName: null,
      alerts: true,
      context: {},
    };

    const profile = record.userId
      ? await safe('profile', () => deps.accounts.profile(record.userId!), null)
      : null;

    const context = boundContext(record.context, now());
    const lastTurn = [...(context.history ?? [])].reverse().find((m) => m.role === 'user');

    const signals = {
      assistant: profile?.languages.assistant ?? null,
      ui: profile?.languages.ui ?? null,
      lastTurn: lastTurn?.lang ?? null,
      telegram: from?.language_code,
    };

    return {
      chatId,
      from,
      record,
      profile,
      context,
      lang: chatLanguage(signals),
      chrome: chromeLanguage(signals),
    };
  }

  async function remember(session: Session, patch: Partial<ChatContext>): Promise<void> {
    session.context = { ...session.context, ...patch, at: now().toISOString() };
    await safe('writeContext', () => deps.store.writeContext(session.chatId, session.context), undefined);
  }

  function linkedUser(session: Session): string | null {
    return session.record.userId;
  }

  async function savedPlaces(session: Session): Promise<MonitoredLocation[]> {
    const userId = linkedUser(session);
    if (!userId) return [];
    return safe('locations', () => deps.accounts.locations(userId), []);
  }

  /** Where a button's place key points: a place this chat has seen, a saved one, or the gazetteer's. */
  async function findPlace(session: Session, key: string): Promise<Location | null> {
    const point = readPlaceKey(key);
    if (!point) return null;

    const seen = (session.context.places ?? []).find((p) => placeKey(p) === key);
    if (seen) return seen;

    const saved = (await savedPlaces(session)).find((l) => placeKey(l) === key);
    if (saved) return asLocation(saved);

    const resolved = deps.resolvePoint(point.latitude, point.longitude);
    return 'kind' in resolved ? null : resolved;
  }

  async function watchOffer(session: Session, place: Location): Promise<WatchOffer> {
    const userId = linkedUser(session);
    // A guest is offered it too: the tap is where accounts get explained.
    if (!userId) return 'offer';
    const saved = await savedPlaces(session);
    const key = districtKey(districtOf(place));
    if (saved.some((l) => districtKey(l.district) === key)) return 'watching';
    return saved.length >= MAX_MONITORED ? 'none' : 'offer';
  }

  /* ---- answering --------------------------------------------------- */

  /**
   * One question through the shared pipeline, and the answer into the chat.
   *
   * `place` answers a "which place?" that was asked earlier: a name typed in
   * reply becomes the standing place, a location share or a saved place
   * arrives as a coordinate — exactly the two ways the website answers the
   * same prompt.
   */
  async function ask(
    session: Session,
    question: string,
    place: { standing?: string; coords?: { latitude: number; longitude: number } } = {},
  ): Promise<void> {
    busy(session.chatId, place.coords ? 'find_location' : 'typing');

    const standing: StandingQuery | null = place.standing
      ? {
          place: place.standing,
          resolvedPlace: null,
          intent: 'current',
          timeWindow: { kind: 'now' },
          variable: 'all',
          setAt: now().toISOString(),
        }
      : (session.context.standing ?? null);

    const { reply, chrome } = await deps.answer({
      question,
      lang: session.lang,
      assistant: session.profile?.languages.assistant ?? 'auto',
      history: session.context.history ?? [],
      standing,
      coords: place.coords ?? null,
    });

    if (reply.needsLocation) {
      // Kept, so the 📍 key or a saved place can answer it without the
      // person having to ask again.
      await send(session.chatId, askPlaceMessage(reply.text, chrome, await savedPlaces(session), 'pq'));
      await remember(session, { pending: { question, at: now().toISOString() } });
      return;
    }

    const snapshot = reply.snapshot;
    const offerWatch =
      Boolean(snapshot) && Boolean(linkedUser(session)) && (await watchOffer(session, snapshot!.place)) === 'offer';

    await send(session.chatId, answerMessage(reply, chrome, { offerWatch }));

    const at = now().toISOString();
    const turns: Message[] = [
      {
        id: `tg:${at}:q`,
        role: 'user',
        text: question,
        // The language this person wrote in — what `auto` mirrors when the
        // next thing they send has no words in it.
        lang: replyLanguage(question, session.lang, 'auto'),
        at,
      },
      { id: `tg:${at}:a`, role: 'assistant', text: reply.text, lang: chrome, at },
    ];

    await remember(session, {
      standing: reply.standing ?? session.context.standing ?? null,
      history: [...(session.context.history ?? []), ...turns].slice(-MAX_HISTORY),
      pending: null,
      places: snapshot ? rememberPlace(session.context.places, snapshot.place) : session.context.places,
    });
  }

  /** A card for a place: warnings, now, the next three days. No model involved. */
  async function card(session: Session, place: Location, replaceMessageId?: number): Promise<void> {
    busy(session.chatId);
    const snapshot = await deps.snapshot(place);
    const message = weatherCard(snapshot, session.chrome, {
      watch: await watchOffer(session, place),
      site,
    });

    if (replaceMessageId !== undefined) await edit(session.chatId, replaceMessageId, message);
    else await send(session.chatId, message);

    await remember(session, {
      // The card's place becomes what "and tomorrow?" is about.
      standing: {
        place: place.name,
        resolvedPlace: place,
        intent: 'current',
        timeWindow: { kind: 'now' },
        variable: 'all',
        setAt: now().toISOString(),
      },
      places: rememberPlace(session.context.places, place),
    });
  }

  async function askWhichPlace(session: Session): Promise<void> {
    await send(
      session.chatId,
      askPlaceMessage(t(session, 'tg.whichPlace'), session.chrome, await savedPlaces(session), 'wx'),
    );
  }

  /* ---- screens ----------------------------------------------------- */

  function accountState(session: Session) {
    return session.record.userId
      ? { linked: true as const, alertsOn: session.record.alerts, account: accountLabel(session.profile) }
      : { linked: false as const };
  }

  async function welcome(session: Session): Promise<void> {
    const name = firstName(session.profile?.name ?? session.from?.first_name ?? null);
    const line = greeting(String(session.chatId), name, session.chrome);
    await send(session.chatId, welcomeMessage(session.chrome, line, accountState(session), site));
  }

  async function placesScreen(session: Session, replaceMessageId?: number): Promise<void> {
    const userId = linkedUser(session);
    const message = userId
      ? placesMessage(
          session.chrome,
          { linked: true, locations: await savedPlaces(session), limit: MAX_MONITORED },
          site,
        )
      : placesMessage(session.chrome, { linked: false }, site);

    if (replaceMessageId !== undefined) await edit(session.chatId, replaceMessageId, message);
    else await send(session.chatId, message);
  }

  async function alertsScreen(session: Session, replaceMessageId?: number): Promise<void> {
    const message = session.record.userId
      ? alertsMessage(
          session.chrome,
          {
            linked: true,
            alertsOn: session.record.alerts,
            places: (await savedPlaces(session)).map((l) => l.placeName),
          },
          site,
        )
      : alertsMessage(session.chrome, { linked: false }, site);

    if (replaceMessageId !== undefined) await edit(session.chatId, replaceMessageId, message);
    else await send(session.chatId, message);
  }

  async function settingsScreen(session: Session, replaceMessageId?: number): Promise<void> {
    const message = session.record.userId
      ? settingsMessage(
          session.chrome,
          {
            linked: true,
            account: accountLabel(session.profile),
            assistant: session.profile?.languages.assistant ?? 'auto',
          },
          site,
        )
      : settingsMessage(session.chrome, { linked: false }, site);

    if (replaceMessageId !== undefined) await edit(session.chatId, replaceMessageId, message);
    else await send(session.chatId, message);
  }

  /* ---- linking ----------------------------------------------------- */

  /**
   * /start link_<token>.
   *
   * The token is bound to this chat first — one statement, so a link opened
   * in two chats belongs to whichever got there first — and then the person
   * is asked to confirm, with the account named. Nothing is linked until they
   * press Connect: a link someone else sent them shows them someone else's
   * account, and they can say no.
   */
  async function startLink(session: Session, token: string): Promise<void> {
    const binding = await safe(
      'bindLinkToken',
      () => deps.store.bindLinkToken(hashLinkToken(token), session.chatId),
      { ok: false } as const,
    );

    if (!binding.ok) {
      await send(session.chatId, { ...note(t(session, 'tg.link.expired')), markup: mainKeyboard(session.chrome) });
      return;
    }

    const current = session.record.userId;
    if (current && current !== binding.userId) {
      // Never switched silently. The token stays bound to this chat, so it
      // still works here once the other account has been disconnected.
      await send(session.chatId, note(t(session, 'tg.link.otherAccount')));
      return;
    }

    if (current === binding.userId) {
      await safe('consume', () => deps.store.consumeLinkToken(binding.tokenId, session.chatId), null);
      await send(session.chatId, { ...note(t(session, 'tg.link.already')), markup: mainKeyboard(session.chrome) });
      return;
    }

    const profile = await safe('profile', () => deps.accounts.profile(binding.userId), null);
    await send(session.chatId, linkConfirmMessage(session.chrome, accountLabel(profile), binding.tokenId));
  }

  async function confirmLink(session: Session, query: TgCallbackQuery, tokenId: string): Promise<void> {
    const messageId = query.message?.message_id;
    const userId = await safe(
      'consume',
      () => deps.store.consumeLinkToken(tokenId, session.chatId),
      null,
    );

    if (!userId) {
      await toast(query.id);
      await edit(session.chatId, messageId, note(t(session, 'tg.link.expired')));
      return;
    }

    const from = query.from;
    const display = from.username ? `@${from.username}` : (from.first_name ?? null);
    const outcome = await safe(
      'linkChat',
      () => deps.store.linkChat(session.chatId, userId, display),
      { ok: false, reason: 'conflict' } as const,
    );

    if (!outcome.ok) {
      await toast(query.id);
      await edit(
        session.chatId,
        messageId,
        note(t(session, outcome.reason === 'otherAccount' ? 'tg.link.otherAccount' : 'tg.link.failed')),
      );
      return;
    }

    // From here on this chat speaks for the account, in its language.
    const linked = await open(session.chatId, from);
    const saved = await savedPlaces(linked);

    await toast(query.id);
    await edit(
      session.chatId,
      messageId,
      note(
        t(linked, saved.length > 0 ? 'tg.link.done' : 'tg.link.doneEmpty'),
        saved.length > 0
          ? { inline_keyboard: [[{ text: t(linked, 'tg.kb.places'), callback_data: 'pl' }]] }
          : undefined,
      ),
    );

    /*
     * Someone who arrived through the link has never seen the welcome: their
     * first /start WAS the link. They get it now — how to ask, and the 📍 key
     * — without the account paragraph they were just shown.
     */
    if (!session.context.at) {
      const name = firstName(linked.profile?.name ?? from.first_name ?? null);
      await send(
        session.chatId,
        welcomeMessage(linked.chrome, greeting(String(session.chatId), name, linked.chrome), null, site),
      );
    }

    // A Telegram that has just been replaced is told so. If that was not the
    // account's owner, this message is how they find out.
    for (const chatId of outcome.movedFrom) {
      await send(chatId, note(translate('tg.link.moved', linked.chrome)));
    }

    console.log(JSON.stringify({ event: 'telegram.linked', moved: outcome.movedFrom.length }));
  }

  /* ---- messages ---------------------------------------------------- */

  function limited(chatId: number): 'ok' | 'notify' | 'drop' {
    if (rateLimit(`tg:${chatId}`, RATE.limit, RATE.windowMs).ok) return 'ok';
    // Said once per window, then silence: replying to every message of a
    // flood would be its own flood.
    return rateLimit(`tg-notice:${chatId}`, 1, RATE.windowMs).ok ? 'notify' : 'drop';
  }

  async function onMessage(message: TgMessage): Promise<string> {
    // Private chats only. A weather bot in a group would answer everyone's
    // questions to everyone, and would need a privacy story it does not have.
    if (message.chat.type !== 'private') return 'ignored:group';

    const chatId = message.chat.id;
    const gate = limited(chatId);
    if (gate === 'drop') return 'limited';

    const session = await open(chatId, message.from);
    if (gate === 'notify') {
      await send(chatId, note(t(session, 'tg.slowDown')));
      return 'limited';
    }

    if (message.location) {
      const coords = {
        latitude: message.location.latitude,
        longitude: message.location.longitude,
      };
      // A question was waiting for a place: this is its answer.
      if (session.context.pending) {
        await ask(session, session.context.pending.question, { coords });
        return 'location:answer';
      }
      // Otherwise the location IS the question. Resolved to a canonical town
      // through the gazetteer, and the coordinate is not kept.
      busy(chatId, 'find_location');
      const place = deps.resolvePoint(coords.latitude, coords.longitude);
      if ('kind' in place) {
        await send(chatId, note(place.statement[session.chrome]));
        return 'location:outside';
      }
      await card(session, place);
      return 'location:card';
    }

    const text = message.text?.trim().slice(0, MAX_QUESTION_CHARS);
    if (!text) {
      await send(chatId, { ...note(t(session, 'tg.unsupported')), markup: mainKeyboard(session.chrome) });
      return 'unsupported';
    }

    const command = readCommand(text);
    if (command) return onCommand(session, command.command, command.arg);

    if (isPlacesKey(text)) {
      await placesScreen(session);
      return 'places';
    }

    if (isGreeting(text)) {
      await welcome(session);
      return 'greeting';
    }

    // A place, typed in reply to "which place?".
    const pending = session.context.pending;
    if (pending) {
      const parsed = await patternParser.parse(text, { lang: session.lang });
      if (isBarePlace(parsed) && !wantsCurrentLocation(pending.question)) {
        await ask(session, pending.question, { standing: parsed.place });
        return 'question:answered-pending';
      }
    }

    await ask(session, text);
    return 'question';
  }

  async function onCommand(session: Session, command: string, arg: string): Promise<string> {
    switch (command) {
      case 'start': {
        const token = readLinkPayload(arg);
        if (token) {
          await startLink(session, token);
          return 'start:link';
        }
        await welcome(session);
        return 'start';
      }

      case 'help':
        await send(session.chatId, helpMessage(session.chrome));
        return 'help';

      case 'weather': {
        if (arg) {
          // The place is found by the same parser every question goes
          // through, so "/weather Barabanki tomorrow" works as well as the
          // bare name.
          const parsed = await patternParser.parse(arg, { lang: session.lang });
          if (parsed?.kind === 'currentLocation') {
            await askWhichPlace(session);
            return 'weather:ask';
          }
          const query = parsed?.kind === 'query' ? parsed.place : arg;
          const place = await deps.resolvePlace(query);
          if ('kind' in place) {
            await send(session.chatId, note(place.statement[session.chrome]));
            return 'weather:unresolved';
          }
          await card(session, place);
          return 'weather:card';
        }

        const standing = session.context.standing?.resolvedPlace;
        if (standing) {
          await card(session, standing);
          return 'weather:standing';
        }
        await askWhichPlace(session);
        return 'weather:ask';
      }

      case 'locations':
      case 'places':
        await placesScreen(session);
        return 'places';

      case 'alerts':
        await alertsScreen(session);
        return 'alerts';

      case 'settings':
        await settingsScreen(session);
        return 'settings';

      default:
        await send(session.chatId, {
          html: `${note(t(session, 'tg.unknownCommand')).html}\n\n${helpMessage(session.chrome).html}`,
          markup: mainKeyboard(session.chrome),
        });
        return 'unknownCommand';
    }
  }

  /* ---- buttons ----------------------------------------------------- */

  async function onCallback(query: TgCallbackQuery): Promise<string> {
    const message = query.message;
    if (message && message.chat.type !== 'private') {
      await toast(query.id);
      return 'ignored:group';
    }

    const chatId = message?.chat.id ?? query.from.id;
    const messageId = message?.message_id;
    const data = query.data ?? '';

    if (limited(chatId) !== 'ok') {
      await toast(query.id);
      return 'limited';
    }

    const session = await open(chatId, query.from);
    const [action, ...rest] = data.split(':');
    const value = rest.join(':');

    const expired = async () => {
      await toast(query.id, t(session, 'tg.expired'));
      return 'expired';
    };

    switch (action) {
      case 'wx':
      case 'rf': {
        const place = await findPlace(session, value);
        if (!place) return expired();
        await toast(query.id);
        // Refresh replaces the card in place; the forecast button under an
        // answer sends a new one beneath it.
        await card(session, place, action === 'rf' ? messageId : undefined);
        return action === 'rf' ? 'card:refresh' : 'card';
      }

      case 'pq': {
        const place = await findPlace(session, value);
        if (!place) return expired();
        await toast(query.id);
        const pending = session.context.pending;
        if (!pending) {
          await card(session, place);
          return 'card';
        }
        await ask(session, pending.question, {
          coords: { latitude: place.latitude, longitude: place.longitude },
        });
        return 'question:answered-pending';
      }

      case 'wa': {
        const place = await findPlace(session, value);
        if (!place) return expired();
        return watch(session, query, place);
      }

      case 'ad': {
        await toast(query.id);
        const place = await deps.resolvePlace(value);
        if ('kind' in place) {
          await send(chatId, note(place.statement[session.chrome]));
          return 'details:unresolved';
        }
        await card(session, place);
        return 'details';
      }

      case 'lk':
        await confirmLink(session, query, value);
        return 'link:confirm';

      case 'lx':
        await safe('cancelLink', () => deps.store.cancelLinkToken(value, chatId), undefined);
        await toast(query.id);
        await edit(chatId, messageId, note(t(session, 'tg.link.cancelled')));
        return 'link:cancel';

      case 'pl':
        await toast(query.id);
        await placesScreen(session);
        return 'places';

      case 'rm': {
        const userId = linkedUser(session);
        if (!userId) return expired();
        const saved = await savedPlaces(session);
        const target = saved.find((l) => l.id === value);
        const removed = target
          ? await safe('removeLocation', () => deps.accounts.removeLocation(userId, value), false)
          : false;
        await toast(
          query.id,
          removed && target ? t(session, 'tg.places.removed', { place: target.placeName }) : undefined,
        );
        await placesScreen(session, messageId);
        return removed ? 'places:removed' : 'places:unchanged';
      }

      case 'al': {
        if (!linkedUser(session)) return expired();
        const on = value === 'on';
        await safe('setAlerts', () => deps.store.setAlerts(chatId, on), null);
        session.record.alerts = on;
        await toast(query.id, t(session, on ? 'tg.alerts.resumedToast' : 'tg.alerts.pausedToast'));
        await alertsScreen(session, messageId);
        return on ? 'alerts:on' : 'alerts:off';
      }

      case 'lg': {
        const userId = linkedUser(session);
        if (!userId || !isLanguagePreference(value) || !session.profile) return expired();
        // The account's own assistant preference — the same value the
        // website's settings write, through the same function. There is no
        // Telegram-only language.
        const next = { ...session.profile.languages, assistant: value };
        await safe('saveLanguages', () => deps.accounts.saveLanguages(userId, next), undefined);
        const updated = await open(chatId, query.from);
        await toast(query.id, t(updated, 'tg.settings.saved'));
        await settingsScreen(updated, messageId);
        return 'settings:language';
      }

      case 'ul': {
        if (!linkedUser(session)) return expired();
        await toast(query.id);
        if (value === 'ask') {
          await edit(chatId, messageId, unlinkConfirmMessage(session.chrome));
          return 'unlink:ask';
        }
        if (value === 'yes') {
          await safe('unlinkChat', () => deps.store.unlinkChat(chatId), null);
          await edit(chatId, messageId, note(t(session, 'tg.unlink.done')));
          console.log(JSON.stringify({ event: 'telegram.unlinked', from: 'telegram' }));
          return 'unlink:done';
        }
        await settingsScreen(session, messageId);
        return 'unlink:cancel';
      }

      default:
        return expired();
    }
  }

  async function watch(session: Session, query: TgCallbackQuery, place: Location): Promise<string> {
    const userId = linkedUser(session);
    const district = districtOf(place);

    if (!userId) {
      await toast(query.id);
      await send(session.chatId, {
        html: note(t(session, 'tg.watch.needsAccount')).html,
        markup: {
          inline_keyboard: [
            [{ text: t(session, 'tg.connectLink'), url: connectUrl(site), style: 'primary' }],
          ],
        },
      });
      return 'watch:guest';
    }

    // The account's own monitored locations: the same store function, the
    // same three-place limit, the same one-district-once rule as the website.
    const result = await deps.accounts.addLocation(userId, place);

    if (!result.ok) {
      await toast(
        query.id,
        result.reason === 'full'
          ? t(session, 'places.full')
          : t(session, 'places.duplicate', {
              district: result.existing.district,
              place: result.existing.placeName,
            }),
        true,
      );
      return `watch:${result.reason}`;
    }

    await toast(
      query.id,
      t(session, session.record.alerts ? 'tg.watch.added' : 'tg.watch.addedPaused', { place: district }),
    );

    // The button becomes the fact: tapped, it now says what it did.
    const markup = query.message && withWatching(query.message, district, session);
    if (markup && query.message) {
      await deps.send('editMessageReplyMarkup', {
        chat_id: session.chatId,
        message_id: query.message.message_id,
        reply_markup: markup,
      });
    }
    return 'watch:added';
  }

  /** The same keyboard, with the watch button swapped for its outcome. */
  function withWatching(message: TgMessage, district: string, session: Session): InlineKeyboard | null {
    const current = message.reply_markup;
    if (!current?.inline_keyboard) return null;
    return {
      inline_keyboard: current.inline_keyboard.map((row) =>
        row.map((button) =>
          'callback_data' in button && button.callback_data.startsWith('wa:')
            ? { text: t(session, 'tg.btn.watching', { place: district }), callback_data: 'pl' }
            : button,
        ),
      ),
    };
  }

  /* ---- membership -------------------------------------------------- */

  /**
   * Blocking the bot is a decision, and alerts stop with it — immediately,
   * rather than on the next warning's 403. Unblocking does not switch them
   * back on by itself: the person resumes them in /alerts, deliberately.
   */
  async function onMembership(update: TgChatMemberUpdated): Promise<string> {
    if (update.chat.type !== 'private') return 'ignored:group';
    const status = update.new_chat_member.status;
    if (status === 'kicked' || status === 'left') {
      await safe('setAlerts', () => deps.store.setAlerts(update.chat.id, false), null);
      return 'blocked';
    }
    return 'member';
  }

  /* ---- entry ------------------------------------------------------- */

  async function handle(update: TgUpdate): Promise<string> {
    const started = Date.now();
    let outcome = 'ignored';
    const chatId =
      update.message?.chat.id ??
      update.callback_query?.message?.chat.id ??
      update.callback_query?.from.id;

    try {
      if (update.message) outcome = await onMessage(update.message);
      else if (update.callback_query) outcome = await onCallback(update.callback_query);
      else if (update.my_chat_member) outcome = await onMembership(update.my_chat_member);
    } catch (error) {
      outcome = 'failed';
      // Never the user's text: a question can name where someone lives.
      console.error(
        JSON.stringify({
          event: 'telegram.update.failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      const chatType =
        update.message?.chat.type ?? update.callback_query?.message?.chat.type ?? 'private';
      if (chatId !== undefined && chatType === 'private') {
        const lang = chromeLanguage({
          assistant: null,
          ui: null,
          lastTurn: null,
          telegram: update.message?.from?.language_code ?? update.callback_query?.from.language_code,
        });
        await send(chatId, note(translate('error.generic', lang))).catch(() => {});
        if (update.callback_query) await toast(update.callback_query.id).catch(() => {});
      }
    }

    console.log(
      JSON.stringify({ event: 'telegram.update', outcome, latencyMs: Date.now() - started }),
    );
    return outcome;
  }

  return { handle };
}
