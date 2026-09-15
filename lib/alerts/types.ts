/**
 * Alerts: subscribers, dispatch claims, and the store they live in.
 *
 * The alert pipeline never calls a model. Severity is too important for
 * either machine translation or generation, so everything a subscriber
 * receives comes from the template catalogue.
 */

import type { DistrictId, Provenance, Severity, Warning } from '../weather/types';

export type SubscriberId = string & { readonly __brand: 'SubscriberId' };

export type Channel =
  | {
      kind: 'webpush';
      endpoint: string;
      /** Subscription keys. Server-side only; never sent back to a client. */
      p256dh: string;
      auth: string;
    }
  | { kind: 'telegram'; chatId: string };

export type ChannelKind = Channel['kind'];

/**
 * Anonymous: an id we generate, not an account. Saved districts live in
 * localStorage for the user's own view, but a subscription must also exist
 * server-side — a scheduled job cannot read localStorage, and the push
 * endpoint has to be somewhere the daemon can reach.
 */
export type Subscriber = {
  id: SubscriberId;
  districts: DistrictId[];
  lang: 'hi' | 'en';
  channels: Channel[];
  createdAt: string;
};

/** What a dispatch is about: a warning coming into force, or lifting. */
export type DispatchKind = 'warning' | 'allClear';

export type ClaimState = 'claimed' | 'sent' | 'failed';

/**
 * One row of the idempotency table, keyed on (subscriberId, dispatchKey).
 *
 * `claimedAt` is a lease, not a timestamp for the record. A runner that claims
 * and then dies would otherwise block the dispatch forever, and a silently
 * dropped cyclone warning is the worst outcome this system has.
 */
export type DispatchClaim = {
  subscriberId: SubscriberId;
  dispatchKey: string;
  state: ClaimState;
  attempt: number;
  claimedAt: string;
};

export type DispatchResult = 'sent' | 'failed' | 'expired' | 'skipped';

export type DispatchRecord = {
  subscriberId: SubscriberId;
  dispatchKey: string;
  warningId: string;
  district: DistrictId;
  severity: Severity | 'none';
  kind: DispatchKind;
  channel: ChannelKind;
  result: DispatchResult;
  attempt: number;
  latencyMs: number;
  at: string;
  error?: string;
};

/**
 * A warning we have already seen in a district, kept so that a warning
 * VANISHING from the feed can be told apart from one that merely expired.
 */
export type SeenWarning = {
  district: DistrictId;
  warningId: string;
  fingerprint: string;
  severity: Severity;
  validTo: string;
  lastSeenAt: string;
};

/** What a poll decided about one warning, before any dispatch happens. */
export type PollDecision =
  | { kind: 'warning'; warning: Warning; fingerprint: string; dispatchKey: string }
  | {
      kind: 'allClear';
      district: DistrictId;
      warningId: string;
      /** The severity that has just lifted — what the all-clear refers to. */
      wasSeverity: Severity;
      dispatchKey: string;
    };

/**
 * Storage.
 *
 * `claim` is the whole concurrency story: it must be a single atomic
 * conditional write, never a read followed by a write. Two runners firing at
 * the same moment both call it, and exactly one gets true.
 */
export interface AlertStore {
  name: string;
  /** Creates tables if they are absent. Safe to run repeatedly. */
  migrate(): Promise<void>;

  subscribersForDistricts(districts: DistrictId[]): Promise<Subscriber[]>;
  allSubscribedDistricts(): Promise<DistrictId[]>;
  upsertSubscriber(subscriber: Subscriber): Promise<void>;
  removeChannel(id: SubscriberId, channel: Channel): Promise<void>;

  /**
   * Atomically take ownership of one dispatch.
   *
   * True means this runner owns it. False means another runner holds a live
   * lease, or it has already been sent, or it has failed too many times.
   */
  claim(
    subscriberId: SubscriberId,
    dispatchKey: string,
    leaseMs: number,
    maxAttempts: number,
  ): Promise<boolean>;

  settleClaim(
    subscriberId: SubscriberId,
    dispatchKey: string,
    state: Exclude<ClaimState, 'claimed'>,
  ): Promise<void>;

  seenWarnings(district: DistrictId): Promise<SeenWarning[]>;
  markSeen(seen: SeenWarning[]): Promise<void>;
  forgetSeen(district: DistrictId, warningIds: string[]): Promise<void>;

  recordDispatch(record: DispatchRecord): Promise<void>;
  close(): Promise<void>;
}

/** Everything a template needs to render one alert. */
export type AlertPayload = {
  kind: DispatchKind;
  district: DistrictId;
  warningId: string;
  code: string;
  severity: Severity;
  validFrom: string;
  validTo: string;
  provenance: Provenance;
};
