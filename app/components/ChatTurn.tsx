/**
 * One turn in the conversation.
 *
 * The provenance line appears only on a turn that actually reported values.
 * A turn that is pure conversation gets none — bolting a citation onto
 * "hello" would make provenance decoration, which is exactly what it is not.
 */

import type { Message } from '@/lib/chat/types';
import { Provenance } from './Provenance';

const SEVERITY_TONE: Record<string, 'none' | 'watch' | 'alert' | 'warning' | 'unknown'> = {
  none: 'none',
  watch: 'watch',
  alert: 'alert',
  warning: 'warning',
  unknown: 'unknown',
};

export function ChatTurn({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const grounding = message.grounding;

  return (
    <article
      className={`turn turn--${message.role}`}
      // The visible label is Devanagari and decorative; the accessible name
      // says who is speaking without depending on the reader knowing Hindi.
      aria-label={isUser ? 'You said' : 'Chaatak replied'}
    >
      <p className="turn__role" aria-hidden="true">
        {isUser ? 'आप' : 'चातक'}
      </p>

      <div className="turn__bubble">
        {/*
          The place was taken from the device, not from the question. Stated
          above the answer rather than buried in it, because "what's the
          temperature" deserves to be told WHERE before it is told what.
        */}
        {message.via ? (
          <p className="turn__via">
            <svg viewBox="0 0 12 12" aria-hidden="true">
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
            <span lang="hi">{message.via.name} की जानकारी</span>
            <span className="turn__via-en">Using {message.via.name}</span>
          </p>
        ) : null}

        <p className="turn__text" lang={message.lang}>
          {message.text}
        </p>

        {grounding ? (
          <Provenance
            source={grounding.provenance.source}
            endpoint={grounding.provenance.endpoint}
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
