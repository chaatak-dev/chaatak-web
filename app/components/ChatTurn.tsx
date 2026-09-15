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
    <article className={`turn turn--${message.role}`}>
      <p className="turn__role" aria-hidden="true">
        {isUser ? 'आप' : 'चातक'}
      </p>

      <div className="turn__bubble">
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
