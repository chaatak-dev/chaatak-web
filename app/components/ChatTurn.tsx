/**
 * One turn in the conversation.
 *
 * The provenance line appears only on a turn that actually reported values.
 * A turn that is pure conversation gets none — bolting a citation onto
 * "hello" would make provenance decoration, which is exactly what it is not.
 *
 * A turn answered under a warning carries the severity as a band at its top,
 * in words and in IMD's colour — severity is the layout, not an accent, and
 * colour never says it alone. The words come from the alert catalogue, in the
 * interface language, never from the model.
 */

'use client';

import { severityAction, severityWords } from '@/lib/alerts/templates';
import { detectScript } from '@/lib/i18n/languages';
import { languageTag } from '@/lib/i18n/detect';
import type { Message } from '@/lib/chat/types';
import { Provenance } from './Provenance';
import { useApp } from './AppState';

const SEVERITY_TONE: Record<string, 'none' | 'watch' | 'alert' | 'warning' | 'unknown'> = {
  none: 'none',
  watch: 'watch',
  alert: 'alert',
  warning: 'warning',
  unknown: 'unknown',
};

/**
 * The BCP-47 tag for a message: hi-Latn for Hinglish, so a screen reader
 * does not read romanised Hindi with an English voice's rules — or Latin
 * letters with a Hindi one. A message stored before scripts were recorded
 * has its script read from its own letters.
 */
function tagFor(message: Message): string {
  const script = message.script ?? (message.lang === 'hi' && detectScript(message.text) === 'Latn' ? 'Latn' : undefined);
  try {
    return languageTag({ code: message.lang, script: script ?? (message.lang === 'hi' ? 'Deva' : 'Latn') });
  } catch {
    return message.lang;
  }
}

export function ChatTurn({ message }: { message: Message }) {
  const { t, languages } = useApp();
  const isUser = message.role === 'user';
  const grounding = message.grounding;
  const severity = grounding?.severity;
  const loud = severity === 'watch' || severity === 'alert' || severity === 'warning';

  return (
    <article
      className={`turn turn--${message.role}`}
      // The visible label is decorative and short; the accessible name is a
      // full phrase, so a screen reader announces who is speaking rather than
      // reading a one-word heading before every turn.
      aria-label={isUser ? t('chat.youSaid') : t('chat.assistantSaid')}
    >
      <p className="turn__role" aria-hidden="true">
        {isUser ? t('chat.you') : t('chat.assistant')}
      </p>

      <div className={`turn__bubble${loud ? ` turn__bubble--${severity}` : ''}`}>
        {/*
          Hidden from assistive technology on purpose: the answer itself
          always OPENS with the same catalogue words — the gate rejects one
          that does not — so a screen reader would otherwise hear the
          severity twice in a row. The band is the eye's signal; the text is
          everyone's.
        */}
        {loud && (
          <p className={`turn__severity turn__severity--${severity}`} aria-hidden="true">
            <span className="turn__severity-words">{severityWords(severity, languages.ui)}</span>
            <span className="turn__severity-action">{severityAction(severity, languages.ui)}</span>
          </p>
        )}

        {/*
          The place was taken from the device, not from the question. Stated
          above the answer rather than buried in it, because "what's the
          temperature" deserves to be told WHERE before it is told what.
        */}
        {message.via ? (
          <p className="turn__via">
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <circle cx="6" cy="6" r="2" fill="currentColor" />
              <circle
                cx="6"
                cy="6"
                r="4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
            <span>{t('chat.using', { place: message.via.name })}</span>
          </p>
        ) : null}

        <p className="turn__text" lang={tagFor(message)}>
          {message.text}
        </p>

        {grounding ? (
          <Provenance
            source={grounding.provenance.source}
            nature={grounding.provenance.nature}
            timestamp={grounding.provenance.issuedAt}
            basis={grounding.provenance.timeBasis}
            timeZone={grounding.place.timezone}
            severity={SEVERITY_TONE[grounding.severity] ?? 'none'}
          />
        ) : null}
      </div>
    </article>
  );
}
