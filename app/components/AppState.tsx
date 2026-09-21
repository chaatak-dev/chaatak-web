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
  fetchAccount,
  fetchConversations,
  fetchLocations,
  fetchMessages,
  fetchPushConfig,
  importGuestConversation,
  registerPush,
  removeLocationRequest,
  renameConversationRequest,
  setAccountLang,
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

  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;

  newChat: () => void;
  openConversation: (id: string) => void;
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

  syncLang: (lang: string) => void;
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
      const account = await fetchAccount();
      if (cancelled) return;

      setConfigured(account.configured);
      setUser(account.user);
      setAlerts(account.alerts);
      setReady(true);

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

      if (!account.user) return;

      // Signed in: the conversation list and the places being watched.
      void refreshConversations();
      void refreshLocations();

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

      setActiveId(id);
      setViewKey(id);
      setServerMessages(EMPTY);
      setLoadingConversation(true);
      setDrawerOpen(false);

      void (async () => {
        const loaded = await fetchMessages(id);
        setLoadingConversation(false);
        // Null means the server does not have it — deleted in another tab, or
        // never this account's. Falling back to a new chat is the honest
        // outcome; showing an empty conversation that cannot be written to is
        // not.
        if (loaded === null) {
          setActiveId(null);
          setViewKey(`new:${Date.now()}`);
          void refreshConversations();
          return;
        }
        setServerMessages(loaded as Message[]);
      })();
    },
    [activeId, refreshConversations],
  );

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

  const syncLang = useCallback(
    (lang: string) => {
      // Only when there is an account to keep it on. A guest's preference
      // lives in their browser and has nowhere else to be.
      if (!signedIn) return;
      void setAccountLang(lang);
    },
    [signedIn],
  );

  const signOut = useCallback(async () => {
    await signOutRequest();
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
      drawerOpen,
      setDrawerOpen,
      newChat,
      openConversation,
      noteConversation,
      rename,
      remove,
      removeAll,
      addLocation,
      removeLocation,
      enableAlerts,
      disableAlerts,
      syncLang,
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
      drawerOpen,
      newChat,
      openConversation,
      noteConversation,
      rename,
      remove,
      removeAll,
      addLocation,
      removeLocation,
      enableAlerts,
      disableAlerts,
      syncLang,
      signOut,
      deleteAccount,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
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
