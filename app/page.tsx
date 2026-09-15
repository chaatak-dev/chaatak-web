'use client';

/**
 * The weather query page: ask by voice or by typing, hear the answer back.
 *
 * The mic never changes what is said. A transcript goes to the query layer
 * exactly as the engine produced it, and TTS reads the composed answer. There
 * is no rewriting in between.
 *
 * Nothing numeric on screen or in the spoken reply is computed here. It
 * arrived in the response body from /api/weather, which got it from an
 * adapter, which got it from upstream.
 */

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { WeatherResponse } from '@/lib/weather/api';
import type { NoData } from '@/lib/weather/types';
import type { MicState, SpeechLang } from '@/lib/speech/types';
import { composeAnswer } from '@/lib/speech/compose';
import { pickSource } from '@/lib/speech/source';
import { placeLine } from '@/lib/format';
import { CurrentConditions } from './components/CurrentConditions';
import { LangToggle } from './components/LangToggle';
import { LogoMark } from './components/LogoMark';
import { Mic } from './components/Mic';
import { NoDataField } from './components/NoDataField';
import { Outlook } from './components/Outlook';
import { WarningSlot } from './components/WarningSlot';

type Status = 'idle' | 'loading' | 'done';

const LANG_KEY = 'chaatak:voice-lang';
const LANG_EVENT = 'chaatak:voice-lang-changed';

/**
 * Browser capability and the stored language preference are external values,
 * not component state. Reading them through useSyncExternalStore gives the
 * server a defined snapshot — so there is no hydration mismatch — and avoids
 * setting state from an effect just to learn what the browser can do.
 */
const noopSubscribe = () => () => {};

function subscribeLang(onChange: () => void): () => void {
  window.addEventListener(LANG_EVENT, onChange);
  return () => window.removeEventListener(LANG_EVENT, onChange);
}

function storedLang(): SpeechLang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'hi';
  } catch {
    // Private mode, or site data blocked. Hindi is the default either way.
    return 'hi';
  }
}

function readerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Our own failure, not a source's. Named so it is not read as Open-Meteo. */
function routeFailure(): NoData {
  return {
    kind: 'noData',
    reason: 'lookupFailed',
    source: 'Chaatak',
    endpoint: '/api/weather',
    checkedAt: new Date().toISOString(),
    statement: {
      hi: 'यह ऐप अपने सर्वर तक नहीं पहुँच सका। इंटरनेट जाँचें और फिर कोशिश करें।',
      en: 'This app could not reach its own server. Check your connection and try again.',
    },
  };
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<WeatherResponse | null>(null);
  const [failure, setFailure] = useState<NoData | null>(null);

  const lang = useSyncExternalStore<SpeechLang>(
    subscribeLang,
    storedLang,
    // Server snapshot: Hindi is primary, so it is also the pre-hydration value.
    () => 'hi',
  );
  const [micState, setMicState] = useState<MicState>('idle');
  const [partial, setPartial] = useState('');
  const [speaking, setSpeaking] = useState(false);

  const sessionRef = useRef<{ stop(): void } | null>(null);
  const speakingRef = useRef<{ cancel(): void } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Capability decides whether the mic renders at all. A browser with no
  // recogniser shows no control rather than one that cannot work.
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

  const chooseLang = useCallback((next: SpeechLang) => {
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* preference simply does not persist */
    }
    window.dispatchEvent(new Event(LANG_EVENT));
  }, []);

  const lookup = useCallback(
    async (place: string, spoken: boolean) => {
      setStatus('loading');
      setFailure(null);

      let response: WeatherResponse | null = null;
      try {
        const res = await fetch(`/api/weather?place=${encodeURIComponent(place)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        response = (await res.json()) as WeatherResponse;
        setResult(response);
      } catch {
        setResult(null);
        setFailure(routeFailure());
      } finally {
        setStatus('done');
        setMicState('idle');
      }

      // Asked by voice, answered by voice — including where the value came
      // from, so a listener who cannot read the screen still gets provenance.
      if (spoken && response) {
        const speaker = pickSource('speak');
        if (speaker) {
          speakingRef.current?.cancel();
          const handle = speaker.speak(composeAnswer(response, lang));
          speakingRef.current = handle;
          setSpeaking(true);
          void handle.done.finally(() => setSpeaking(false));
        }
      }
    },
    [lang],
  );

  const startListening = useCallback(() => {
    const source = pickSource('recognise');
    if (!source) return setMicState('unsupported');

    speakingRef.current?.cancel();
    setPartial('');
    setMicState('listening');

    const session = source.recognise({
      lang,
      onPartial: (text) => setPartial(text),
    });
    sessionRef.current = session;

    void session.result.then((recognition) => {
      sessionRef.current = null;
      setPartial('');

      if (recognition.kind === 'heard') {
        // Verbatim into the query layer. No trimming, no correction.
        setQuery(recognition.transcript);
        void lookup(recognition.transcript, true);
        return;
      }
      if (recognition.kind === 'denied') return setMicState('denied');
      // Heard nothing, or the engine failed: say so, and the text input is
      // right there. Never a guess at what was said.
      setMicState('failed');
      inputRef.current?.focus();
    });
  }, [lang, lookup]);

  const stopListening = useCallback(() => {
    // Entered the moment the user stops, not when the response lands. ASR is
    // a ~1.6s round trip with no streaming endpoint behind it.
    setMicState('processing');
    sessionRef.current?.stop();
  }, []);

  const onSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void lookup(query, false);
    },
    [lookup, query],
  );

  const timeZone =
    result?.kind === 'resolved' ? result.place.timezone : readerZone();
  const header = result?.kind === 'resolved' ? placeLine(result.place) : null;
  // Capability wins over the state machine: unsupported renders nothing.
  const shownMicState: MicState = canRecognise ? micState : 'unsupported';

  return (
    <>
      <header className="masthead">
        <div className="masthead__inner">
          <LogoMark size={40} />
          <div className="masthead__where">
            {header ? (
              <p className="masthead__place">{header}</p>
            ) : (
              <p className="masthead__brand">
                <span lang="hi" className="masthead__brand-hi">
                  चातक
                </span>
                <span className="masthead__brand-en">Chaatak</span>
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="page">
        {shownMicState !== 'unsupported' && (
          <LangToggle value={lang} onChange={chooseLang} />
        )}

        <Mic
          state={shownMicState}
          lang={lang}
          partial={partial}
          onStart={startListening}
          onStop={stopListening}
        />

        <form className="query" onSubmit={onSubmit}>
          <label className="query__label" htmlFor="place">
            <span lang="hi" className="query__label-hi">
              या जगह का नाम लिखें
            </span>
            <span className="query__label-en">Or type a place name</span>
          </label>

          <div className="query__row">
            <input
              id="place"
              ref={inputRef}
              className="query__input"
              type="text"
              name="place"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ghaziabad"
              autoComplete="off"
              enterKeyHint="search"
            />
            <button
              className="query__submit"
              type="submit"
              disabled={status === 'loading'}
              aria-label="Show weather for this place"
            >
              <span lang="hi">देखें</span>
            </button>
          </div>
        </form>

        <div className="results" aria-live="polite" aria-busy={status === 'loading'}>
          {status === 'idle' && (
            <section className="idle">
              <p lang="hi" className="idle__headline">
                बोलकर या लिखकर पूछें
              </p>
              <p className="idle__subtitle">
                Current conditions and a three-day outlook, with the source and
                the time it was last updated under every value.
              </p>
            </section>
          )}

          {status === 'loading' && (
            <p className="loading">
              <span lang="hi">जाँच रहे हैं…</span>
              <span className="loading__en">Checking the source…</span>
            </p>
          )}

          {status === 'done' && failure && (
            <NoDataField state={failure} timeZone={timeZone} />
          )}

          {status === 'done' && result?.kind === 'unresolved' && (
            <NoDataField state={result.noData} timeZone={timeZone} />
          )}

          {status === 'done' && result?.kind === 'resolved' && (
            <>
              {canSpeak && (
                <div className="playback">
                  <button
                    type="button"
                    className="playback__button"
                    onClick={() => {
                      if (speaking) {
                        speakingRef.current?.cancel();
                        setSpeaking(false);
                        return;
                      }
                      const speaker = pickSource('speak');
                      if (!speaker) return;
                      const handle = speaker.speak(composeAnswer(result, lang));
                      speakingRef.current = handle;
                      setSpeaking(true);
                      void handle.done.finally(() => setSpeaking(false));
                    }}
                  >
                    <span lang="hi">{speaking ? 'बंद करें' : 'सुनें'}</span>
                    <span className="playback__en">
                      {speaking ? 'Stop' : 'Listen'}
                    </span>
                  </button>
                </div>
              )}

              <WarningSlot warnings={result.warnings} timeZone={timeZone} />
              <CurrentConditions reading={result.current} timeZone={timeZone} />
              <Outlook forecast={result.outlook} timeZone={timeZone} />
            </>
          )}
        </div>
      </main>

      <footer className="colophon">
        <p>
          Chaatak shows India Meteorological Department bulletins. IMD API
          access is pending, so values here come from Open-Meteo and are
          labelled as such. No value on this page is generated by Chaatak.
        </p>
      </footer>
    </>
  );
}
