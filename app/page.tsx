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
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ChatReply } from './api/chat/route';
import type { Message, StandingQuery } from '@/lib/chat/types';
import type { MicState, SpeechLang } from '@/lib/speech/types';
import { pickSource } from '@/lib/speech/source';
import { placeLine } from '@/lib/format';
import { ChatTurn } from './components/ChatTurn';
import { LangToggle } from './components/LangToggle';
import { LogoMark } from './components/LogoMark';
import { Mic } from './components/Mic';

const LANG_KEY = 'chaatak:voice-lang';
const LANG_EVENT = 'chaatak:voice-lang-changed';
const SCROLLBACK_KEY = 'chaatak:scrollback';
const SCROLLBACK_EVENT = 'chaatak:scrollback-changed';
const MAX_STORED = 40;

const noopSubscribe = () => () => {};

/**
 * Scrollback lives in sessionStorage and is read through useSyncExternalStore
 * rather than restored from an effect. That gives the server a defined
 * snapshot — an empty transcript — so there is no hydration mismatch, and it
 * keeps the persisted copy and the rendered copy from drifting apart.
 *
 * The parsed value is cached because getSnapshot must return a stable
 * reference; re-parsing on every call would re-render forever.
 */
const EMPTY: Message[] = [];
let cachedRaw: string | null = null;
let cachedMessages: Message[] = EMPTY;

function subscribeScrollback(onChange: () => void): () => void {
  window.addEventListener(SCROLLBACK_EVENT, onChange);
  return () => window.removeEventListener(SCROLLBACK_EVENT, onChange);
}

function scrollbackSnapshot(): Message[] {
  try {
    const raw = sessionStorage.getItem(SCROLLBACK_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedMessages = raw ? (JSON.parse(raw) as Message[]) : EMPTY;
    }
    return cachedMessages;
  } catch {
    return EMPTY;
  }
}

function writeScrollback(messages: Message[]): void {
  const kept = messages.slice(-MAX_STORED);
  try {
    sessionStorage.setItem(SCROLLBACK_KEY, JSON.stringify(kept));
  } catch {
    // Private mode: the conversation still works, it just does not persist.
    cachedRaw = null;
    cachedMessages = kept;
  }
  window.dispatchEvent(new Event(SCROLLBACK_EVENT));
}

function subscribeLang(onChange: () => void): () => void {
  window.addEventListener(LANG_EVENT, onChange);
  return () => window.removeEventListener(LANG_EVENT, onChange);
}

function storedLang(): SpeechLang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'hi';
  } catch {
    return 'hi';
  }
}

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}-${(seq += 1)}`;

export default function Chat() {
  const messages = useSyncExternalStore(
    subscribeScrollback,
    scrollbackSnapshot,
    () => EMPTY,
  );
  const [standing, setStanding] = useState<StandingQuery | null>(null);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [micState, setMicState] = useState<MicState>('idle');
  const [partial, setPartial] = useState('');
  const [speaking, setSpeaking] = useState(false);

  const sessionRef = useRef<{ stop(): void } | null>(null);
  const speakingRef = useRef<{ cancel(): void } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const lang = useSyncExternalStore<SpeechLang>(subscribeLang, storedLang, () => 'hi');
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const chooseLang = useCallback((next: SpeechLang) => {
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* preference does not persist */
    }
    window.dispatchEvent(new Event(LANG_EVENT));
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

  const ask = useCallback(
    async (question: string, spoken: boolean) => {
      const asked: Message = {
        id: nextId(),
        role: 'user',
        text: question,
        lang,
        at: new Date().toISOString(),
      };

      const history = [...messages, asked];
      writeScrollback(history);
      setDraft('');
      setThinking(true);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question, lang, history, standing }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const reply = (await res.json()) as ChatReply;

        setStanding(reply.standing);
        writeScrollback([
          ...history,
          {
            id: nextId(),
            role: 'assistant',
            text: reply.text,
            lang: reply.lang,
            at: new Date().toISOString(),
            grounding: reply.grounding,
          },
        ]);

        if (spoken) speak(reply.text, reply.lang);
      } catch {
        writeScrollback([
          ...history,
          {
            id: nextId(),
            role: 'assistant',
            text:
              lang === 'hi'
                ? 'सर्वर तक नहीं पहुँच सका। इंटरनेट जाँचें और फिर कोशिश करें।'
                : 'Could not reach the server. Check your connection and try again.',
            lang,
            at: new Date().toISOString(),
          },
        ]);
      } finally {
        setThinking(false);
        setMicState('idle');
      }
    },
    [lang, messages, speak, standing],
  );

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

  return (
    <>
      <header className="masthead">
        <div className="masthead__inner">
          <LogoMark size={40} />
          <div className="masthead__where">
            {where ? (
              <p className="masthead__place">{where}</p>
            ) : (
              <p className="masthead__brand">
                <span lang="hi" className="masthead__brand-hi">
                  चातक
                </span>
                <span className="masthead__brand-en">Chaatak</span>
              </p>
            )}
          </div>
          {shownMicState !== 'unsupported' && (
            <LangToggle value={lang} onChange={chooseLang} compact />
          )}
        </div>
      </header>

      <main className="chat">
        <div className="chat__scroll" aria-live="polite">
          {messages.length === 0 ? (
            <section className="chat__empty">
              <p lang="hi" className="chat__empty-headline">
                मौसम के बारे में कुछ भी पूछें
              </p>
              <p className="chat__empty-subtitle">
                Ask about the weather — by voice or by typing. Every number
                comes with its source and the time it was issued.
              </p>
              <ul className="chat__examples">
                <li lang="hi">बाराबंकी में कल बारिश होगी?</li>
                <li lang="hi">क्या मैं आज क्रिकेट खेल सकता हूँ?</li>
                <li lang="hi">ऑरेंज अलर्ट का मतलब क्या है?</li>
              </ul>
            </section>
          ) : (
            messages.map((message) => <ChatTurn key={message.id} message={message} />)
          )}

          {thinking && (
            <p className="chat__thinking">
              <span lang="hi">सोच रहे हैं…</span>
              <span className="chat__thinking-en">Thinking</span>
            </p>
          )}

          <div ref={endRef} />
        </div>

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
              placeholder={lang === 'hi' ? 'कुछ भी पूछें…' : 'Ask anything…'}
              aria-label="Ask about the weather"
              autoComplete="off"
              enterKeyHint="send"
            />
            <button
              className="composer__send"
              type="submit"
              disabled={thinking || !draft.trim()}
              aria-label="Send"
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
              <span lang="hi">बोलना बंद करें</span>
            </button>
          )}
        </div>
      </main>
    </>
  );
}
