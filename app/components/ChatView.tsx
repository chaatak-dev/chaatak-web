'use client';

/**
 * Chaatak: a weather conversation.
 *
 * Ask by voice or by typing, get a verified answer, follow up. Both go
 * through one `ask`, and so through one conversation: type, speak, type,
 * speak, and the place, the day and the language carry across all of it.
 * The voice session only adds a microphone in front and a voice behind.
 *
 * Nothing numeric here is computed on this side. Every number came through
 * /api/chat, which got it from an adapter, and passed the gate before it was
 * allowed into the transcript.
 *
 * The transcript itself lives in AppState: sessionStorage for a guest, the
 * account's conversation once signed in. This component does not know which,
 * which is what keeps one send path instead of two.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ChatReply } from '@/lib/chat/answer';
import type { Message, StandingQuery } from '@/lib/chat/types';
import type { SpeechLang } from '@/lib/speech/types';
import type { LanguageCode } from '@/lib/i18n/languages';
import { readTurn } from '@/lib/i18n/detect';
import { classifyFailure, failureText } from '@/lib/chat/failure';
import { greeting, firstName, suggestions } from '@/lib/i18n/greetings';
import { formatStamp, placeLine } from '@/lib/format';
import {
  isOffline,
  readCache,
  staleness,
  subscribeCache,
  subscribeOnline,
  writeCache,
} from '@/lib/offline/cache';
import { canAskForLocation, currentPosition, geoSupported, type Coords } from '@/lib/geo';
import {
  isNearBottom,
  preservedScrollTop,
  shouldFollow,
  showsJumpToLatest,
} from '@/lib/chat/scroll';
import { ChatTurn } from './ChatTurn';
import { StaleBand } from './StaleBand';
import { LogoMark } from './LogoMark';
import { VoiceControl } from './VoiceControl';
import { useVoiceSession } from './useVoiceSession';
import { useApp } from './AppState';

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}-${(seq += 1)}`;

/** How the last request ended, when it ended needing a place. */
type LocationNeed = null | 'asking' | 'refused';

type AskOptions = {
  /** Sent only when the person has just agreed to share their position. */
  coords?: Coords;
  /**
   * The transcript to build on, INCLUDING the question being asked.
   *
   * Given when a question is being answered a second time — the retry after
   * "use my location" — so the question is not appended twice for what the
   * person experienced as one question that paused to ask where they were.
   */
  history?: Message[];
  /** For a spoken question: the language the recogniser detected. */
  heard?: LanguageCode | null;
};

type Ask = (question: string, spoken: boolean, options?: AskOptions) => Promise<ChatReply | null>;

export function ChatView() {
  const app = useApp();
  const { messages, setMessages, t } = app;

  /*
   * Voice and interface are different settings and this component needs both.
   * `lang` is the voice language — the one chosen, or where detection starts —
   * and only a fallback for the text: a question's language is read from the
   * question. `t` writes the chrome.
   */
  const lang: SpeechLang = app.languages.voice;

  const [standing, setStanding] = useState<StandingQuery | null>(null);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [locationNeed, setLocationNeed] = useState<LocationNeed>(null);
  /** How sure the last answer was of the conversation's language. */
  const [langConfidence, setLangConfidence] = useState<'high' | 'medium' | 'low' | null>(null);
  /**
   * Whether opening has taken long enough to be worth saying out loud.
   *
   * A conversation that has been read once opens on the same tick, and most
   * cold opens land inside a couple of hundred milliseconds. A loading line
   * that appears and vanishes in that time is a flash, not feedback — so the
   * transcript area stays empty and quiet until it is genuinely slow.
   */
  const [slowOpen, setSlowOpen] = useState(false);

  /**
   * Whether the reader is at the bottom and therefore following along.
   *
   * State rather than a ref because the jump-to-latest control renders from
   * it. It changes ONLY when the reader scrolls — never when content
   * arrives — which is what stops a new answer dragging somebody back down
   * from the number they were re-reading.
   */
  const [pinned, setPinned] = useState(true);
  /**
   * Whether the jump-to-latest control is worth showing.
   *
   * State, not a value read from the ref at render time: a ref is not
   * reactive, so a button derived from one appears and disappears a render
   * late — or not at all. Recomputed wherever the geometry can have changed.
   */
  const [jumpVisible, setJumpVisible] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** The scroll height before the last render, for history prepends. */
  const lastHeight = useRef(0);
  /** The id at the top, which is how a prepend is told from an append. */
  const firstId = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  /** The question that stalled for want of a place, so it can be retried. */
  const pendingQuestion = useRef<{ text: string; spoken: boolean } | null>(null);
  /**
   * One question at a time.
   *
   * A ref rather than the `thinking` state, because the guard has to hold
   * between a keypress and the next render. Two questions in flight at once
   * in a NEW conversation would both be sent with no conversation id, and the
   * server would obligingly create two conversations for what the person
   * asked as one exchange.
   */
  const inFlight = useRef(false);

  /*
   * Offline status and the cached answer are read synchronously from the
   * browser, never inferred from a failed request. Waiting for a fetch to time
   * out before admitting we are offline would show a cached answer looking
   * current for three seconds first — the same lie, shorter.
   */
  const offline = useSyncExternalStore(subscribeOnline, isOffline, () => false);
  const cached = useSyncExternalStore(subscribeCache, readCache, () => null);

  /*
   * Follow the conversation, or leave the reader where they are.
   *
   * Runs after every change to the transcript. Three cases, and the middle
   * one is the one people notice:
   *
   *   pinned          → move to the latest
   *   scrolled up     → do nothing at all
   *   grew at the top → hold the same line under the same pixel
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const metrics = {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };

    /*
     * A PREPEND is told from an append by what is at the top, not by the
     * height changing — both change the height, and only one of them moves
     * the content the reader is looking at. Correcting for an append scrolled
     * them down by exactly the height of every new answer, which is the
     * behaviour this whole module exists to prevent.
     */
    const topId = messages[0]?.id ?? null;
    const prepended =
      lastHeight.current > 0 &&
      firstId.current !== null &&
      topId !== firstId.current &&
      messages.some((m) => m.id === firstId.current);

    if (prepended) {
      el.scrollTop = preservedScrollTop(lastHeight.current, el.scrollHeight, el.scrollTop);
    } else if (shouldFollow(pinned, metrics)) {
      el.scrollTop = el.scrollHeight;
    }

    firstId.current = topId;

    lastHeight.current = el.scrollHeight;

    // The transcript grew, so the geometry the control depends on changed
    // even though nobody scrolled.
    setJumpVisible(
      showsJumpToLatest(pinned, {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }),
    );
    // `pinned` is deliberately not a dependency: this reacts to the
    // transcript changing, not to the reader scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, thinking]);

  /**
   * The reader's own scrolling is the only thing that changes who is in
   * control.
   */
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const metrics = {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };

    const nowPinned = isNearBottom(metrics);
    setPinned(nowPinned);
    setJumpVisible(showsJumpToLatest(nowPinned, metrics));
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    /*
     * Instant, not smooth. A smooth scroll fires a scroll event from every
     * intermediate position, and the handler correctly read those as "the
     * reader is not at the bottom" — so the control reappeared halfway
     * through its own animation and the jump never completed.
     */
    el.scrollTop = el.scrollHeight;
    setPinned(true);
    setJumpVisible(false);
  }, []);

  useEffect(() => {
    if (!app.loadingConversation) return;
    // Set from a timer, not from the effect body: a fast open never renders
    // this at all.
    const timer = setTimeout(() => setSlowOpen(true), 250);
    return () => {
      clearTimeout(timer);
      setSlowOpen(false);
    };
  }, [app.loadingConversation]);

  // Registers the offline shell. Without it a cold start with no network
  // reaches the browser's error page and the cached warning is never seen —
  // which would make "show the last known warning offline" impossible.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // No shell cache. The app still works online; it just cannot cold-start
      // offline. Not worth telling the user about.
    });
  }, []);

  const reportFailure = useCallback(
    (failure: Parameters<typeof failureText>[0], history: Message[]) => {
      setMessages([
        ...history,
        {
          id: nextId(),
          role: 'assistant',
          text: failureText(failure, lang),
          lang,
          at: new Date().toISOString(),
        },
      ]);
    },
    [lang, setMessages],
  );

  const ask: Ask = useCallback<Ask>(
    async (question, spoken, options) => {
      if (inFlight.current) return null;
      inFlight.current = true;

      // The question's own language and script, read from its words — or,
      // for a spoken turn, from what the recogniser detected. This is what
      // its `lang` attribute says and what a screen reader reads it in.
      const read = readTurn(question, options?.heard ?? undefined);
      const asked: Message = {
        id: nextId(),
        role: 'user',
        text: question,
        lang: options?.heard ?? read?.code ?? lang,
        ...(read && read.script === 'Latn' && read.code === 'hi' ? { script: 'Latn' as const } : {}),
        at: new Date().toISOString(),
      };

      /*
       * On a retry the caller hands over the transcript it wants built on —
       * the one that still holds the original question and no longer holds
       * the "which place?" line. Writing it is what removes that line.
       */
      const history = options?.history ?? [...messages, asked];
      setMessages(history);

      setDraft('');
      setThinking(true);

      const send = (coords?: Coords) =>
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            question,
            lang,
            // A spoken turn carries the language that was detected in it,
            // which the text alone may not show ("Lucknow").
            heard: options?.heard ?? null,
            history,
            standing,
            // Where to keep this turn. Null starts a conversation; a guest
            // sends it and the server ignores it, having no account to write
            // into.
            conversationId: app.activeId,
            // One id for the exchange, so a resend after a timeout does not
            // write the same turn twice.
            clientId: asked.id,
            coords: coords ?? null,
            // `auto` means read each turn's language, which the route does
            // when it sees it. An explicit choice travels.
            assistantLang: app.preferences.assistant,
          }),
        });

      /*
       * A failed request is classified before it is reported. "fetch threw" and
       * "the server answered with an error" are different events, and
       * collapsing them into one message once sent an operator to check their
       * wifi while the fault was an environment variable.
       */
      let res: Response;
      try {
        res = await send(options?.coords);
      } catch {
        // Nothing came back at all, so the network really is the suspect.
        reportFailure(classifyFailure({ threw: true, online: !isOffline() }), history);
        inFlight.current = false;
        setThinking(false);
        return null;
      }

      if (!res.ok) {
        // A response arrived. Whatever is wrong, it is not the connection.
        let detail: string | undefined;
        try {
          const body = (await res.json()) as { error?: { detail?: string } };
          detail = body.error?.detail;
        } catch {
          /* no body, or not JSON: the status alone still says enough */
        }
        reportFailure(
          classifyFailure({ threw: false, online: true, status: res.status, detail }),
          history,
        );
        inFlight.current = false;
        setThinking(false);
        return null;
      }

      try {
        let reply = (await res.json()) as ChatReply;

        /*
         * The question needs a place and did not name one.
         *
         * This is the one moment the browser is asked where it is — not on
         * load, not on a question that named a place, not on a question that
         * needs no place at all. If the answer is yes, the same question goes
         * again with a coordinate and the person never sees this exchange
         * happen. If it is no, the server's line — "type a place name, or let
         * me use your location" — is what lands, with the button beside it.
         *
         * One retry, never a loop: a second refusal is an answer, and asking
         * again would be badgering someone who already said no.
         */
        if (reply.needsLocation && !options?.coords) {
          pendingQuestion.current = { text: question, spoken };

          const askable = await canAskForLocation();
          if (askable) {
            setLocationNeed('asking');
            const fix = await currentPosition();
            setLocationNeed(null);

            if (fix.ok) {
              const second = await send(fix.coords).catch(() => null);
              if (second?.ok) {
                reply = (await second.json()) as ChatReply;
                pendingQuestion.current = null;
              } else {
                // The fix arrived and the second request did not. The first
                // reply still stands, and it asks for a place name.
                setLocationNeed('refused');
              }
            } else {
              setLocationNeed('refused');
            }
          } else {
            setLocationNeed('refused');
          }
        } else {
          setLocationNeed(null);
          pendingQuestion.current = null;
        }

        setStanding(reply.standing);
        setLangConfidence(reply.meta?.langConfidence ?? null);

        /*
         * The rail follows the conversation, and shares its numbers.
         *
         * Adopted rather than re-fetched: this is the snapshot the answer was
         * written from, so the rail cannot contradict the sentence above it.
         */
        if (reply.snapshot) app.adoptSnapshot(reply.snapshot, 'conversation');

        setMessages([
          ...history,
          {
            id: nextId(),
            role: 'assistant',
            text: reply.text,
            // The answer's language and script, as decided before it was
            // written — which is what its `lang` attribute has to say.
            lang: reply.lang,
            ...(reply.script && reply.script === 'Latn' && reply.lang === 'hi' ? { script: 'Latn' as const } : {}),
            at: new Date().toISOString(),
            grounding: reply.grounding,
            via: reply.usedDeviceLocation,
          },
        ]);

        // Where the server kept it. A guest gets nothing back here, and the
        // sidebar has nothing to show.
        if (reply.conversationId) {
          app.noteConversation(reply.conversationId, reply.conversationTitle ?? null);
        }

        // Keep the last answer, with both timestamps. Age is never stored —
        // it is computed on read, so it cannot go stale itself.
        if (reply.grounding) {
          writeCache({
            text: reply.text,
            lang: reply.lang,
            issuedAt: reply.grounding.provenance.issuedAt,
            cachedAt: new Date().toISOString(),
            grounding: reply.grounding,
            validTo: null,
          });
        }

        return reply;
      } catch {
        // The response arrived but could not be read as an answer.
        reportFailure(
          classifyFailure({ threw: false, online: true, status: res.status }),
          history,
        );
        return null;
      } finally {
        inFlight.current = false;
        setThinking(false);
      }
    },
    [app, lang, messages, reportFailure, setMessages, standing],
  );

  /**
   * The button beside a "which place?" answer.
   *
   * The retry drops that line from the transcript and answers the question
   * that is already sitting above it, so the conversation reads as one
   * question and one answer rather than as an argument about geography.
   */
  const useMyLocation = useCallback(async () => {
    const pending = pendingQuestion.current;
    if (!pending) return;

    setLocationNeed('asking');
    const fix = await currentPosition();

    if (!fix.ok) {
      setLocationNeed('refused');
      // Nothing more to offer: the browser will not prompt again after a
      // refusal, so the input is the way forward and the focus goes there.
      inputRef.current?.focus();
      return;
    }

    setLocationNeed(null);
    await ask(pending.text, pending.spoken, {
      coords: fix.coords,
      history: messages.slice(0, -1),
    });
  }, [ask, messages]);

  /*
   * The voice session. It hands a transcript to the same `ask` as the text
   * box, and speaks back what came back — in the answer's own language.
   */
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  const standingRef = useRef(standing);
  const confidenceRef = useRef(langConfidence);
  useEffect(() => {
    standingRef.current = standing;
    confidenceRef.current = langConfidence;
  }, [standing, langConfidence]);

  const voice = useVoiceSession({
    auto: app.languages.voiceAuto,
    lang,
    device: app.languages.uiChoice,
    prior: () => ({
      lang: standingRef.current?.lang?.code ?? null,
      confident: confidenceRef.current === 'high',
    }),
    onTranscript: async (text, heard) => {
      const reply = await askRef.current(text, true, { heard });
      return reply ? { text: reply.text, speakAs: reply.speakAs ?? reply.lang } : null;
    },
  });

  const where = standing?.resolvedPlace ? placeLine(standing.resolvedPlace) : null;

  /*
   * The greeting and the chips are chosen from the CHAT, not from a random
   * number. `viewKey` changes when the person moves to another conversation
   * and not otherwise, so the same chat always opens with the same words and
   * a re-render never reshuffles them — which a `Math.random()` at render
   * time would do on every keystroke.
   */
  const hello = useMemo(
    () => greeting(app.viewKey, firstName(app.user?.name), app.languages.ui),
    [app.viewKey, app.user?.name, app.languages.ui],
  );

  const chips = useMemo(
    () => suggestions(app.viewKey, app.languages.ui),
    [app.viewKey, app.languages.ui],
  );

  return (
    <>
      <header className="masthead">
        <div className="masthead__inner">
          {/*
            The way into the sidebar on a phone. It is in the masthead rather
            than floating over the conversation, because a control that
            overlaps the transcript is a control that covers a warning.
          */}
          <button
            type="button"
            className="masthead__menu"
            onClick={() => app.setDrawerOpen(true)}
            aria-label={t('nav.open')}
            aria-expanded={app.drawerOpen}
            aria-controls="sidebar"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path
                d="M3 5h14M3 10h14M3 15h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>

          {/*
            The mark sits here only while the sidebar is a drawer. On a wide
            screen the sidebar carries it, and two of them on one page is a
            logo used as decoration.
          */}
          <span className="masthead__mark">
            <LogoMark size={40} />
          </span>

          <div className="masthead__where">
            {where ? (
              <p className="masthead__place">{where}</p>
            ) : (
              <p className="masthead__brand">
                <span className="masthead__brand-hi">{t('brand.name')}</span>
                {app.languages.ui !== 'en' && (
                  <span className="masthead__brand-en" lang="en">
                    {t('brand.wordmark')}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="chat" id="conversation" tabIndex={-1}>
      {/*
        The page's one top-level heading, for anyone navigating by them —
        inside the main landmark, so it is not the one piece of the page
        that belongs to no region at all.
      */}
      <h1 className="sr-only">{t('brand.name')}</h1>

      {/*
        role="log" announces ADDITIONS only. A plain aria-live region on a
        growing transcript re-reads the whole conversation on every turn,
        which is unusable the moment there is more than one exchange. An
        answer arrives whole — never token by token — so each is announced
        once, complete.
      */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={`chat__scroll${messages.length === 0 ? ' chat__scroll--empty' : ''}`}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('chat.log')}
        // Focusable so a keyboard can scroll the transcript; the outline is
        // drawn inside it, where the composer cannot cover it.
        tabIndex={0}
      >
        {app.loadingConversation ? (
          /*
            Deliberately nothing for the first quarter second. Falling through
            to the empty state instead would flash "ask me anything" across a
            conversation that is about to appear.
          */
          slowOpen ? (
            <p className="chat__thinking">{t('chat.opening')}</p>
          ) : null
        ) : messages.length === 0 && offline && !cached ? (
          /*
           * Offline with nothing saved. It shows no weather content at all,
           * because there is none — this is noData with a different cause,
           * not a degraded answer.
           */
          <section className="absence absence--nodata" role="status">
            <p className="absence__label">{t('offline.nothingSaved')}</p>
            <p className="absence__statement">{t('offline.nothingSavedBody')}</p>
          </section>
        ) : messages.length === 0 && offline && cached ? (
          /*
           * Something was saved. It renders on first paint, above the value
           * and at the same weight as a severity band — never as a badge.
           */
          <>
            <StaleBand
              ageMinutes={staleness(cached).ageMinutes}
              expired={staleness(cached).expired}
              offline={offline}
              source={cached.grounding.provenance.source}
              issuedAtLabel={formatStamp(
                cached.issuedAt,
                cached.grounding.place.timezone,
              )}
            />
            {!staleness(cached).expired && (
              <ChatTurn
                message={{
                  id: 'cached',
                  role: 'assistant',
                  text: cached.text,
                  lang: cached.lang,
                  at: cached.cachedAt,
                  // The severity colour is dropped while stale: colour means
                  // "this is current", and this is not.
                  grounding: { ...cached.grounding, severity: 'unknown' },
                }}
              />
            )}
          </>
        ) : messages.length === 0 ? (
          <section className="chat__empty">
            <p className="chat__greeting">{hello}</p>
            <p className="chat__empty-subtitle">{t('chat.subtitle')}</p>

            {/*
              Chips, not examples. Each one is the question it says, which is
              the shortest path there is from an empty chat to an answer.
            */}
            <ul className="chat__examples" aria-label={t('chat.suggestions')}>
              {chips.map((chip) => (
                <li key={chip}>
                  <button
                    type="button"
                    className="chat__chip"
                    onClick={() => void ask(chip, false)}
                  >
                    {chip}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          messages.map((message) => <ChatTurn key={message.id} message={message} />)
        )}

        {/*
          Offered only after a question turned out to need a place. The
          browser is never asked before this point, and never asked twice
          after a refusal — once denied, the prompt does not appear again and
          a button that silently does nothing is worse than no button.
        */}
        {locationNeed === 'refused' && geoSupported() && (
          <button type="button" className="uselocation" onClick={useMyLocation}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="2.4" fill="currentColor" />
              <circle
                cx="8"
                cy="8"
                r="5.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
            <span>{t('chat.useMyLocation')}</span>
          </button>
        )}

        {locationNeed === 'asking' && (
          <p className="chat__thinking">{t('chat.locating')}</p>
        )}

        {thinking && locationNeed !== 'asking' && (
          <p className="chat__thinking">{t('chat.thinking')}</p>
        )}

        <div ref={endRef} />
      </div>

      {/*
        The composer: outside the scroller, so it can never cover the
        transcript, and in normal flow, so its height is its own.
      */}
      <div className="composer">
        {/*
          Offered only when there is somewhere to go and the reader is not
          already there. A button that does nothing is worse than no button,
          which is why the condition is computed rather than assumed from
          `pinned` alone.
        */}
        {jumpVisible && (
          <button type="button" className="chat__jump" onClick={jumpToLatest}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M8 3v9M4.5 8.5L8 12l3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t('chat.jumpToLatest')}
          </button>
        )}

        <VoiceControl session={voice} listeningIn={standing?.lang?.code ?? lang} />

        <form
          className="composer__form"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (text) void ask(text, false);
          }}
        >
          <label className="sr-only" htmlFor="composer-input">
            {t('composer.label')}
          </label>
          <input
            id="composer-input"
            ref={inputRef}
            className="composer__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('composer.placeholder')}
            autoComplete="off"
            enterKeyHint="send"
          />
          <button
            className="composer__send"
            type="submit"
            disabled={thinking || !draft.trim()}
            aria-label={t('composer.send')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 12h15M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </div>
      </main>
    </>
  );
}
