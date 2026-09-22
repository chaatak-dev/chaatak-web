/**
 * One turn in the conversation.
 *
 * The provenance line appears only on a turn that actually reported values.
 * A turn that is pure conversation gets none — bolting a citation onto
 * "hello" would make provenance decoration, which is exactly what it is not.
 */

'use client';

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

export function ChatTurn({ message }: { message: Message }) {
  const { t } = useApp();
  const isUser = message.role === 'user';
  const grounding = message.grounding;

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
            <span>{t('chat.using', { place: message.via.name })}</span>
          </p>
        ) : null}

        <p className="turn__text" lang={message.lang}>
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
