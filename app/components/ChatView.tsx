'use client';

/**
 * Chaatak: a weather conversation.
 *
 * Ask by voice or by typing, get a verified answer, follow up. The mic never
 * changes what is said — a transcript goes to the query layer exactly as the
 * engine produced it, and TTS reads what shipped.
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
import type { ChatReply } from '../api/chat/route';
import type { Message, StandingQuery } from '@/lib/chat/types';
import type { MicState, SpeechLang } from '@/lib/speech/types';
import { classifyFailure, failureText } from '@/lib/chat/failure';
import { greeting, firstName, suggestions } from '@/lib/i18n/greetings';
import { pickSource } from '@/lib/speech/source';
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
import { ChatTurn } from './ChatTurn';
import { StaleBand } from './StaleBand';
import { ThemeToggle } from './ThemeToggle';
import { LanguagePanel } from './LanguagePanel';
import { LogoMark } from './LogoMark';
import { Mic } from './Mic';
import { useApp } from './AppState';

const noopSubscribe = () => () => {};

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
};

type Ask = (question: string, spoken: boolean, options?: AskOptions) => Promise<void>;

export function ChatView() {
  const app = useApp();
  const { messages, setMessages, t } = app;

  /*
   * Voice and interface are different settings and this component needs both.
   * `lang` is what the recogniser listens in and the voice reads back; `t`
   * writes the chrome. Conflating them is what used to make choosing a Tamil
   * voice render the page in English — or, worse, switch a typed script.
   */
  const lang: SpeechLang = app.languages.voice;

  const [standing, setStanding] = useState<StandingQuery | null>(null);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [micState, setMicState] = useState<MicState>('idle');
  const [partial, setPartial] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [locationNeed, setLocationNeed] = useState<LocationNeed>(null);
  /**
   * Whether opening has taken long enough to be worth saying out loud.
   *
   * A conversation that has been read once opens on the same tick, and most
   * cold opens land inside a couple of hundred milliseconds. A loading line
   * that appears and vanishes in that time is a flash, not feedback — so the
   * transcript area stays empty and quiet until it is genuinely slow.
   */
  const [slowOpen, setSlowOpen] = useState(false);

  const sessionRef = useRef<{ stop(): void } | null>(null);
  const speakingRef = useRef<{ cancel(): void } | null>(null);
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

  const canRecognise = useSyncExternalStore(
    noopSubscribe,
    () => pickSource('recognise') !== null,
    () => false,
  );
  const canSpeak = useSyncExternalStore(
    noopSubscribe,
    () => pickSource('speak') !== null,
    () => false,
  );

  /*
   * Offline status and the cached answer are read synchronously from the
   * browser, never inferred from a failed request. Waiting for a fetch to time
   * out before admitting we are offline would show a cached answer looking
   * current for three seconds first — the same lie, shorter.
   */
  const offline = useSyncExternalStore(subscribeOnline, isOffline, () => false);
  const cached = useSyncExternalStore(subscribeCache, readCache, () => null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

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

  const speak = useCallback((text: string, at: SpeechLang) => {
    const speaker = pickSource('speak');
    if (!speaker) return;
    speakingRef.current?.cancel();
    const handle = speaker.speak([{ text, lang: at }]);
    speakingRef.current = handle;
    setSpeaking(true);
    void handle.done.finally(() => setSpeaking(false));
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
      if (inFlight.current) return;
      inFlight.current = true;

      const asked: Message = {
        id: nextId(),
        role: 'user',
        text: question,
        lang,
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
            // `auto` means mirror what was just written, which is what the
            // route does when it sees it. An explicit choice travels.
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
        setMicState('idle');
        return;
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
        setMicState('idle');
        return;
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

        setMessages([
          ...history,
          {
            id: nextId(),
            role: 'assistant',
            text: reply.text,
            lang: reply.lang,
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

        if (spoken) speak(reply.text, reply.lang);
      } catch {
        // The response arrived but could not be read as an answer.
        reportFailure(
          classifyFailure({ threw: false, online: true, status: res.status }),
          history,
        );
      } finally {
        inFlight.current = false;
        setThinking(false);
        setMicState('idle');
      }
    },
    [app, lang, messages, reportFailure, setMessages, speak, standing],
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

  const startListening = useCallback(() => {
    const source = pickSource('recognise');
    if (!source) return setMicState('unsupported');

    speakingRef.current?.cancel();
    setPartial('');
    setMicState('listening');

    const session = source.recognise({ lang, onPartial: setPartial });
    sessionRef.current = session;

    void session.result.then((recognition) => {
      sessionRef.current = null;
      setPartial('');

      if (recognition.kind === 'heard') {
        void ask(recognition.transcript, true);
        return;
      }
      if (recognition.kind === 'denied') return setMicState('denied');
      setMicState('failed');
      inputRef.current?.focus();
    });
  }, [ask, lang]);

  const stopListening = useCallback(() => {
    // Entered on stop, not when the answer lands: ASR is a ~1.6s round trip
    // and there is no streaming endpoint to hide it behind.
    setMicState('processing');
    sessionRef.current?.stop();
  }, []);

  const shownMicState: MicState = canRecognise ? micState : 'unsupported';
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
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
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

      <main className="chat">
      {/*
        role="log" announces ADDITIONS only. A plain aria-live region on a
        growing transcript re-reads the whole conversation on every turn,
        which is unusable the moment there is more than one exchange.
      */}
      <div
        className={`chat__scroll${messages.length === 0 ? ' chat__scroll--empty' : ''}`}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('chat.log')}
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
              Chips, not examples. They were decoration before — three lines
              of Hindi that looked tappable and were not. Each one is now the
              question it says, which is the shortest path there is from an
              empty chat to an answer.
            */}
            <ul className="chat__examples">
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
            <svg viewBox="0 0 16 16" aria-hidden="true">
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
        Rendered ONCE. Duplicating the controls into the masthead as well put
        two controls for one setting on screen at every width, and two
        elements sharing an id, which quietly broke the label association.
        A strip above the conversation on narrow screens, a sticky column
        beside it on wide ones — same markup, different placement.
      */}
      <aside className="chat__rail">
        <p className="chat__rail-heading">{t('settings.heading')}</p>
        <LanguagePanel />
        <p className="chat__rail-heading">{t('settings.theme')}</p>
        <ThemeToggle />
      </aside>

      <div className="composer">
        <Mic
          state={shownMicState}
          lang={lang}
          partial={partial}
          onStart={startListening}
          onStop={stopListening}
          compact
        />

        <form
          className="composer__form"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (text) void ask(text, false);
          }}
        >
          <input
            ref={inputRef}
            className="composer__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('composer.placeholder')}
            aria-label={t('composer.label')}
            autoComplete="off"
            enterKeyHint="send"
          />
          <button
            className="composer__send"
            type="submit"
            disabled={thinking || !draft.trim()}
            aria-label={t('composer.send')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
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

        {canSpeak && speaking && (
          <button
            type="button"
            className="composer__stopspeech"
            onClick={() => {
              speakingRef.current?.cancel();
              setSpeaking(false);
            }}
          >
            {t('composer.stopSpeaking')}
          </button>
        )}
      </div>
      </main>
    </>
  );
}
