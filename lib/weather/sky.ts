/**
 * The two things the weather card's ground answers to.
 *
 * Kept out of the component because they are decisions rather than markup:
 * which sky is over the place, and what kind of weather is in it. Pure, so
 * the boundaries can be asserted instead of squinted at.
 */

/**
 * The sky, reduced to the four states worth colouring differently.
 *
 * Read from the PLACE's own clock, not the reader's. Someone in Delhi asking
 * about Mumbai at midnight is asking about a place where it is also midnight;
 * someone abroad is not, and the card should show the sky over the place it
 * names.
 */
export type SkyPhase = 'night' | 'dawn' | 'day' | 'dusk';

export function skyPhase(timeZone: string, now = new Date()): SkyPhase {
  let hour: number;

  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        hour12: false,
      }).format(now),
    );
  } catch {
    // An unusable timezone throws rather than returning something odd, and a
    // card that crashes over a ground colour would take the temperature with
    // it. Day is the neutral answer.
    return 'day';
  }

  if (Number.isNaN(hour)) return 'day';
  if (hour < 5 || hour >= 20) return 'night';
  if (hour < 8) return 'dawn';
  if (hour < 17) return 'day';
  return 'dusk';
}

/**
 * The condition, reduced to the groups that change what the sky looks like.
 *
 * WMO codes, grouped the way a person would: clear, cloudy, wet, storm. Fog
 * joins cloud because they look the same from underneath.
 */
export type ConditionGroup = 'clear' | 'cloud' | 'wet' | 'storm';

export function conditionGroup(code: number | null): ConditionGroup {
  if (code === null) return 'cloud';
  if (code === 0 || code === 1) return 'clear';
  if (code >= 95) return 'storm';
  if (code >= 51) return 'wet';
  return 'cloud';
}
