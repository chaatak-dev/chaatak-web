'use client';

/**
 * Account state for the whole app: who is signed in, their conversations,
 * their monitored locations, and the transcript currently on screen.
 *
 * One provider rather than four, because these are not four independent
 * things — signing in adopts a guest transcript, opening a conversation
 * replaces it, deleting the open one has to start a new chat, and saving a
 * location changes what the alert daemon polls. Splitting them would mean
 * four contexts that all have to be updated in the right order by whichever
 * component happened to cause the change.
 *
 * WHAT IS NOT HERE: anything about the weather. No value, no warning, no
 * severity. Those come from /api/chat, verified, per turn.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Message } from '@/lib/chat/types';
import type { AlertStatus, Conversation } from '@/lib/accounts/types';
import {
  addLocationRequest,
  deleteAccountRequest,
  deleteAllConversationsRequest,
  deleteConversationRequest,
  fetchBootstrap,
  fetchConversations,
  fetchLocations,
  fetchMessages,
  fetchPushConfig,
  importGuestConversation,
  registerPush,
  removeLocationRequest,
  renameConversationRequest,
  setAccountLanguages,
  signOutRequest,
  unregisterPush,
  type AccountUser,
  type AddLocationOutcome,
  type LocationsState,
} from '@/lib/accounts/client';
import {
  currentPushEndpoint,
  pushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  type PushPermission,
} from '@/lib/alerts/push-client';
import {
  clearScrollback,
  EMPTY,
  guestKey,
  scrollbackSnapshot,
  subscribeScrollback,
  writeScrollback,
} from '@/lib/chat/scrollback';
import {
  deviceLanguages,
  languagesSnapshot,
  serverLanguagesSnapshot,
  subscribeLanguages,
  writeLanguagesLocal,
} from '@/lib/i18n/local';
import {
  DEFAULT_PREFERENCES,
  resolveLanguages,
  type LanguagePreference,
  type LanguagePreferences,
  type ResolvedLanguages,
} from '@/lib/i18n/preferences';
import { translator, type Translate } from '@/lib/i18n/strings';
import { bcp47 } from '@/lib/i18n/languages';

/** The device's language list cannot change without a reload. */
const noopSubscribeLanguages = () => () => {};

const NO_ALERTS: AlertStatus = {
  enabled: false,
  channels: { webpush: 0, telegram: 0 },
};

const NO_LOCATIONS: LocationsState = {
  locations: [],
  limit: 3,
  used: 0,
  remaining: 3,
  alerts: NO_ALERTS,
};

export type AppState = {
  /** False until the first account fetch lands. Guards a sign-in flash. */
  ready: boolean;
  /** Whether this deployment has accounts at all. */
  configured: boolean;
  user: AccountUser | null;
  /** Set when a sign-in round trip came back unhappy. */
  signInError: string | null;

  conversations: Conversation[];
  activeId: string | null;
  /**
   * Changes when the person deliberately moves to a different conversation,
   * and NOT when the server assigns an id to the one already on screen.
   *
   * The chat view is keyed on it. Keying on `activeId` instead looked
   * equivalent and was not: the first message in a new chat takes it from null
   * to a uuid, which would remount the view mid-conversation and throw away
   * the standing place — so the very next question, "और अगले दिन?", would have
   * nowhere to be about.
   */
  viewKey: string;
  /** True while a conversation's messages are being fetched. */
  loadingConversation: boolean;

  /** The transcript on screen — server-backed when signed in, else the tab's. */
  messages: Message[];
  setMessages: (next: Message[]) => void;

  locations: LocationsState;
  alerts: AlertStatus;
  pushPermission: PushPermission;
  pushAvailable: boolean;

  /** What the person chose: interface, assistant and voice, each or `auto`. */
  preferences: LanguagePreferences;
  /** What those choices resolve to for this device, right now. */
  languages: ResolvedLanguages;
  /** One string in the interface language. The only way chrome gets words. */
  t: Translate;
  setLanguage: (which: keyof LanguagePreferences, value: LanguagePreference) => void;

  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;

  newChat: () => void;
  openConversation: (id: string) => void;
  /**
   * Warm the cache for a conversation the person is about to open.
   *
   * Called on hover and on touch-start, where there is a few hundred
   * milliseconds of human intent before the click lands. Cheap, idempotent,
   * and silently skipped for anything already held.
   */
  prefetchConversation: (id: string) => void;
  noteConversation: (id: string, title: string | null) => void;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeAll: () => Promise<void>;

  addLocation: (
    input: { place: string } | { latitude: number; longitude: number },
  ) => Promise<AddLocationOutcome>;
  removeLocation: (id: string) => Promise<void>;
  enableAlerts: () => Promise<{ ok: boolean; reason?: string }>;
  disableAlerts: () => Promise<void>;

  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ ok: boolean; error?: string }>;
};

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('useApp outside AppProvider');
  return state;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState('new');
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [serverMessages, setServerMessages] = useState<Message[]>(EMPTY);

  const [locations, setLocations] = useState<LocationsState>(NO_LOCATIONS);
  const [alerts, setAlerts] = useState<AlertStatus>(NO_ALERTS);
  const [permission, setPermission] = useState<PushPermission>('default');
  const [pushAvailable, setPushAvailable] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);

  /* ---- language ---------------------------------------------------- */

  /*
   * The three preferences, read through an external store so a returning
   * visitor's choice is applied on the FIRST paint. Restoring it in an effect
   * would render English for a frame and then correct itself, which reads as
   * a bug even when the result is right.
   */
  const localPreferences = useSyncExternalStore(
    subscribeLanguages,
    languagesSnapshot,
    serverLanguagesSnapshot,
  );

  /*
   * The account's copy wins once it arrives, because it is the same person on
   * another device. Until then — and always, for a guest — the browser's copy
   * is what there is.
   */
  const [accountPreferences, setAccountPreferences] =
    useState<LanguagePreferences | null>(null);

  const preferences = accountPreferences ?? localPreferences;

  /*
   * `navigator.languages`, only consulted when something is on `auto`. The
   * server renders with none of it and hydrates over the top.
   */
  const device = useSyncExternalStore(
    noopSubscribeLanguages,
    deviceLanguages,
    () => undefined,
  );

  const languages = useMemo(
    () => resolveLanguages(preferences, device),
    [preferences, device],
  );

  const t = useMemo(() => translator(languages.ui), [languages.ui]);

  /*
   * The document's own language.
   *
   * Two things depend on it and neither is cosmetic: a screen reader picks
   * its voice from it, and `brand.css` selects the Devanagari face and its
   * looser leading through `:lang(hi)`. Setting it here means one write
   * covers both, and every element inherits rather than being tagged.
   */
  useEffect(() => {
    document.documentElement.lang = bcp47(languages.ui);
  }, [languages.ui]);

  /*
   * The guest transcript, read from sessionStorage through the store rather
   * than copied into state. Keeping one copy is what stops the rendered
   * conversation and the saved one from drifting apart.
   */
  const guestMessages = useSyncExternalStore(
    subscribeScrollback,
    scrollbackSnapshot,
    () => EMPTY,
  );

  const signedIn = Boolean(user);
  const messages = signedIn ? serverMessages : guestMessages;

  const setMessages = useCallback(
    (next: Message[]) => {
      if (signedIn) setServerMessages(next);
      else writeScrollback(next);
    },
    [signedIn],
  );

  /*
   * Conversations already read, kept for the rest of the session.
   *
   * Switching back to a chat that has been opened once costs nothing: it is
   * already here, it renders on the same tick, and there is no loading state
   * because there is nothing to wait for. A background re-read follows so
   * another device's messages still arrive, but it never blocks the paint.
   *
   * A ref rather than state — writing to it must not re-render, and every
   * read of it happens inside an event handler that is about to set state
   * anyway.
   */
  const cache = useRef(new Map<string, Message[]>());

  /** Prefetches already running, so hovering a row twice reads once. */
  const inFlight = useRef(new Set<string>());

  /**
   * The open conversation, readable from inside an async callback.
   *
   * A background read that finishes after the person has moved on must not
   * write its transcript over the one they are now looking at, and the
   * closure it lives in captured the id from the render that started it.
   */
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  /*
   * The open conversation's transcript, mirrored into the cache.
   *
   * Done here rather than in each of the six places that can change it, so a
   * new path cannot forget to. Writing to a Map is not a render, which is why
   * this effect is allowed to be an effect.
   */
  useEffect(() => {
    if (activeId && signedIn) cache.current.set(activeId, serverMessages);
  }, [activeId, serverMessages, signedIn]);

  /* ---- refreshing what the server holds ---------------------------- */

  const refreshConversations = useCallback(async () => {
    setConversations(await fetchConversations());
  }, []);

  const refreshLocations = useCallback(async () => {
    const state = await fetchLocations();
    if (state) {
      setLocations(state);
      setAlerts(state.alerts);
    }
  }, []);

  /* ---- first load ------------------------------------------------- */

  /** Guards against two sign-ins racing the same guest transcript. */
  const adopting = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // ONE request. Account, conversations and places arrive together, so
      // the sidebar does not wait on a second hop to find out what to draw.
      const boot = await fetchBootstrap();
      if (cancelled) return;

      setConfigured(boot.configured);
      setUser(boot.user);
      setAlerts(boot.alerts);
      setConversations(boot.conversations);
      setLocations(boot.locations);
      setReady(true);

      /*
       * Whose language choice wins.
       *
       * The account's, when it has one — it is the same person on another
       * device, and that is what "syncs across devices" has to mean. When the
       * account has never been told (everything still on auto) and this
       * browser HAS been, the browser's choice is adopted upward, the same
       * way the guest conversation is: a setting made before signing in is
       * still a setting the person made.
       */
      if (boot.user) {
        const fromAccount = boot.user.languages ?? DEFAULT_PREFERENCES;
        const accountIsUntold =
          fromAccount.ui === 'auto' &&
          fromAccount.assistant === 'auto' &&
          fromAccount.voice === 'auto';
        const local = languagesSnapshot();
        const localHasChoice =
          local.ui !== 'auto' || local.assistant !== 'auto' || local.voice !== 'auto';

        if (accountIsUntold && localHasChoice) {
          setAccountPreferences(local);
          void setAccountLanguages(local);
        } else {
          setAccountPreferences(fromAccount);
          writeLanguagesLocal(fromAccount);
        }
      }

      // Read once and cleared from the address bar: a sign-in flag that stays
      // in the URL re-runs adoption on every refresh.
      const params = new URLSearchParams(window.location.search);
      const signin = params.get('signin');
      if (signin) {
        params.delete('signin');
        const query = params.toString();
        window.history.replaceState(
          null,
          '',
          window.location.pathname + (query ? `?${query}` : ''),
        );
      }

      if (signin === 'failed') {
        setSignInError('Sign-in did not complete. Try again.');
      } else if (signin === 'unavailable') {
        setSignInError('Accounts are not configured on this deployment.');
      }

      if (!boot.user) return;

      /*
       * Adopt whatever the person was in the middle of.
       *
       * The order matters and is deliberate: the server confirms it has the
       * conversation, and only then is the browser's copy cleared. The other
       * order loses a transcript to any request that fails.
       */
      const pending = scrollbackSnapshot();
      if (pending.length > 0 && !adopting.current) {
        adopting.current = true;
        const adopted = await importGuestConversation(guestKey(), pending);
        if (adopted) {
          clearScrollback();
          setActiveId(adopted.id);
          setServerMessages(pending);
          setConversations((current) => [adopted, ...current]);
          void refreshConversations();
        }
        adopting.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
    // Runs once. The helpers it calls are stable and defined below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- notifications: capability, not permission ------------------ */

  useEffect(() => {
    if (!user) return;

    void (async () => {
      // Reading the permission is not asking for it. `Notification.permission`
      // is a value, not a prompt — the prompt is `requestPermission()`, which
      // is called from one place only and only when someone presses the
      // control that says what it will do.
      setPermission(pushPermission());

      // Whether the server can send a push at all — VAPID keys configured.
      const config = await fetchPushConfig();
      if (config) {
        setPushAvailable(config.available);
        setAlerts(config.alerts);
      }
    })();
  }, [user]);

  /* ---- conversations ---------------------------------------------- */

  const newChat = useCallback(() => {
    setActiveId(null);
    setServerMessages(EMPTY);
    // A new chat is not loading anything. Leaving this true — pressing New
    // chat while another one was still opening — held the transcript blank
    // behind a state that had nothing to resolve it.
    setLoadingConversation(false);
    // A different key each time, so pressing "New chat" twice still resets a
    // view that is already showing a new chat.
    setViewKey(`new:${Date.now()}`);
    if (!signedIn) writeScrollback(EMPTY);
    setDrawerOpen(false);
  }, [signedIn]);

  const openConversation = useCallback(
    (id: string) => {
      if (id === activeId) {
        setDrawerOpen(false);
        return;
      }

      const held = cache.current.get(id);

      setActiveId(id);
      setViewKey(id);
      setDrawerOpen(false);

      /*
       * Already read once: it renders on this tick. No spinner, no request
       * the person waits on — the only honest reason to show a loading state
       * is that there is genuinely nothing to show yet.
       */
      setServerMessages(held ?? EMPTY);
      setLoadingConversation(!held);

      void (async () => {
        const loaded = await fetchMessages(id);

        // The person may have moved on while this was in flight. Writing it
        // now would drop another conversation's transcript on top of the one
        // they are reading.
        if (activeIdRef.current !== id) return;

        setLoadingConversation(false);

        // Null means the server does not have it — deleted in another tab, or
        // never this account's. Falling back to a new chat is the honest
        // outcome; showing an empty conversation that cannot be written to is
        // not.
        if (loaded === null) {
          cache.current.delete(id);
          setActiveId(null);
          setViewKey(`new:${Date.now()}`);
          void refreshConversations();
          return;
        }

        const next = loaded as Message[];
        cache.current.set(id, next);

        // Skip the re-render when the background read agrees with what is
        // already on screen, which is the usual case.
        setServerMessages((current) => (sameTranscript(current, next) ? current : next));
      })();
    },
    [activeId, refreshConversations],
  );

  /**
   * Read ahead for a conversation the pointer is resting on.
   *
   * By the time a click lands the messages are usually already here, so the
   * open is a state change rather than a request. Skipped for anything held
   * or in flight, so hovering down a list costs one read per row at most.
   */
  const prefetchConversation = useCallback((id: string) => {
    if (!id || cache.current.has(id) || inFlight.current.has(id)) return;

    inFlight.current.add(id);
    void fetchMessages(id)
      .then((loaded) => {
        if (loaded) cache.current.set(id, loaded as Message[]);
      })
      .finally(() => inFlight.current.delete(id));
  }, []);

  /**
   * A turn just created or touched a conversation server-side.
   *
   * Called with what /api/chat returned, so the sidebar updates from the same
   * write that saved the message rather than from a second request.
   */
  const noteConversation = useCallback(
    (id: string, title: string | null) => {
      setActiveId((current) => current ?? id);

      setConversations((current) => {
        const at = current.findIndex((c) => c.id === id);
        const now = new Date().toISOString();

        if (at === -1) {
          return [
            {
              id: id as Conversation['id'],
              title,
              createdAt: now,
              lastMessageAt: now,
            },
            ...current,
          ];
        }

        // Most recent activity first, which means moving it to the top.
        const updated = {
          ...current[at],
          title: current[at].title ?? title,
          lastMessageAt: now,
        };
        return [updated, ...current.filter((_, i) => i !== at)];
      });
    },
    [],
  );

  const rename = useCallback(async (id: string, title: string) => {
    const updated = await renameConversationRequest(id, title);
    if (!updated) return;
    setConversations((current) =>
      current.map((c) => (c.id === id ? { ...c, title: updated.title } : c)),
    );
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const ok = await deleteConversationRequest(id);
      if (!ok) return;

      cache.current.delete(id);
      setConversations((current) => current.filter((c) => c.id !== id));
      // Deleting the conversation you are looking at leaves you looking at
      // nothing, so it starts a new one.
      if (activeId === id) {
        setActiveId(null);
        setViewKey(`new:${Date.now()}`);
        setServerMessages(EMPTY);
      }
    },
    [activeId],
  );

  const removeAll = useCallback(async () => {
    const ok = await deleteAllConversationsRequest();
    if (!ok) return;
    cache.current.clear();
    setConversations([]);
    setActiveId(null);
    setViewKey(`new:${Date.now()}`);
    setServerMessages(EMPTY);
  }, []);

  /* ---- locations --------------------------------------------------- */

  const addLocation = useCallback(
    async (input: { place: string } | { latitude: number; longitude: number }) => {
      const outcome = await addLocationRequest(input);
      if ('state' in outcome && outcome.state) {
        setLocations(outcome.state);
        setAlerts(outcome.state.alerts);
      }
      return outcome;
    },
    [],
  );

  const removeLocation = useCallback(async (id: string) => {
    const state = await removeLocationRequest(id);
    if (state) {
      setLocations(state);
      setAlerts(state.alerts);
    }
  }, []);

  /* ---- alerts ------------------------------------------------------ */

  /**
   * Turn notifications on.
   *
   * This is the ONLY caller of the permission prompt, and it runs because
   * someone pressed a control that says what it will do. Saving a place does
   * not reach here, and neither does granting location.
   */
  const enableAlerts = useCallback(async () => {
    const config = await fetchPushConfig();
    if (!config?.available || !config.vapidPublicKey) {
      return { ok: false, reason: 'unavailable' };
    }

    const result = await subscribeToPush(config.vapidPublicKey);
    setPermission(pushPermission());

    if (!result.ok) return { ok: false, reason: result.reason };

    const stored = localStorageLang();
    const status = await registerPush(result.subscription, stored);
    if (!status) return { ok: false, reason: 'failed' };

    setAlerts(status);
    // The districts the daemon polls changed with the first channel, so the
    // panel's "monitored" state is now stale.
    void refreshLocations();
    return { ok: true };
  }, [refreshLocations]);

  const disableAlerts = useCallback(async () => {
    const endpoint = (await unsubscribeFromPush()) ?? (await currentPushEndpoint());
    if (endpoint) {
      const status = await unregisterPush(endpoint);
      if (status) setAlerts(status);
    } else {
      setAlerts(NO_ALERTS);
    }
    void refreshLocations();
  }, [refreshLocations]);

  /* ---- account ----------------------------------------------------- */

  /**
   * Change one preference, leaving the other two exactly as they were.
   *
   * This is the whole "do not couple them" rule in one function: there is no
   * path here that writes a second field. Choosing a voice cannot move the
   * interface, and choosing an interface cannot move the assistant.
   *
   * Written to the browser always, and to the account when there is one, so a
   * guest keeps their choice and a signed-in person keeps it everywhere.
   */
  const setLanguage = useCallback(
    (which: keyof LanguagePreferences, value: LanguagePreference) => {
      const next = { ...preferences, [which]: value };

      writeLanguagesLocal(next);
      if (signedIn) {
        setAccountPreferences(next);
        void setAccountLanguages(next);
      }
    },
    [preferences, signedIn],
  );

  const signOut = useCallback(async () => {
    await signOutRequest();
    // Nothing of this account stays in memory for whoever signs in next —
    // including its language, which reverts to whatever this browser holds.
    cache.current.clear();
    setAccountPreferences(null);
    setUser(null);
    setConversations([]);
    setActiveId(null);
    setViewKey(`new:${Date.now()}`);
    setServerMessages(EMPTY);
    setLocations(NO_LOCATIONS);
    setAlerts(NO_ALERTS);
    setDrawerOpen(false);
    // Signing out leaves the conversation behind rather than carrying it into
    // a guest session it does not belong to.
    writeScrollback(EMPTY);
  }, []);

  const deleteAccount = useCallback(async () => {
    const result = await deleteAccountRequest();
    if (!result.ok) return result;
    await signOut();
    return { ok: true };
  }, [signOut]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      configured,
      user,
      signInError,
      conversations,
      activeId,
      viewKey,
      loadingConversation,
      messages,
      setMessages,
      locations,
      alerts,
      pushPermission: permission,
      pushAvailable,
      preferences,
      languages,
      t,
      setLanguage,
      drawerOpen,
      setDrawerOpen,
      newChat,
      openConversation,
      prefetchConversation,
      noteConversation,
      rename,
      remove,
      removeAll,
      addLocation,
      removeLocation,
      enableAlerts,
      disableAlerts,
      signOut,
      deleteAccount,
    }),
    [
      ready,
      configured,
      user,
      signInError,
      conversations,
      activeId,
      viewKey,
      loadingConversation,
      messages,
      setMessages,
      locations,
      alerts,
      permission,
      pushAvailable,
      preferences,
      languages,
      t,
      setLanguage,
      drawerOpen,
      newChat,
      openConversation,
      prefetchConversation,
      noteConversation,
      rename,
      remove,
      removeAll,
      addLocation,
      removeLocation,
      enableAlerts,
      disableAlerts,
      signOut,
      deleteAccount,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * Whether a background re-read actually changed anything.
 *
 * Compares what a transcript is made of rather than object identity — a fresh
 * fetch is always a new array, and swapping it in unchanged would re-render
 * the conversation and jump the scroll for nothing.
 */
function sameTranscript(a: Message[], b: Message[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((message, i) => message.id === b[i].id && message.text === b[i].text);
}

/**
 * The voice language, as the toggle stored it.
 *
 * Read directly rather than threaded through props: this is needed at exactly
 * one moment — registering a push channel — and the daemon has to know which
 * language to render the template catalogue in.
 */
function localStorageLang(): string {
  try {
    return localStorage.getItem('chaatak:voice-lang') ?? 'hi';
  } catch {
    return 'hi';
  }
}
