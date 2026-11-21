import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityEvent,
  AlertNotification,
  CreateItemAlertInput,
  CreatePoolInput,
  DemoScenarioId,
  DomainActionError,
  JoinPoolInput,
  PersonaRole,
  Pool,
  PoolMetrics,
  PublishOfferInput,
  SavedItemAlert,
  SellerOffer,
  SimilarPoolCandidate,
  SimilarPoolQueryInput,
  SimilarPoolReference,
  UpdateItemAlertInput,
} from '../domain/types.ts';

export interface ClientPool extends Pool {
  metrics: PoolMetrics;
}

export interface SimilarPoolsResponse {
  candidates: SimilarPoolCandidate[];
  referencePools: SimilarPoolReference[];
  checkedPoolCount: number;
  checkedAt: string;
}

export interface ClientActor {
  id: string;
  role: PersonaRole;
  name: string;
  shortLabel: string;
  location: string;
}

export interface ClientSessionResponse {
  sessionId: string;
  scenarioId: DemoScenarioId;
  demoNow: string;
  role: PersonaRole;
  actor: ClientActor;
  pools: ClientPool[];
  activity: ActivityEvent[];
  alerts: SavedItemAlert[];
  notifications: AlertNotification[];
  unreadAlertCount: number;
  updatedAt: string;
}

export interface SellerPacketResponse {
  poolId: string;
  title: string;
  subtitle: string;
  category: Pool['category'];
  location: string;
  deliveryOrDestination: string;
  unitSingular: string;
  unitPlural: string;
  minQuantity: number;
  maxQuantity: number;
  goalDate: string;
  sharedRequirements: string[];
  categorySpecs: Pool['categorySpecs'];
  organizerName: string;
  organizerNote: string;
  quoteRequestedAt?: string;
  currentOffer?: SellerOffer;
  offerHistory: Pool['offerHistory'];
  metrics: PoolMetrics;
  demoNow: string;
}

export interface ClaimPassResponse {
  pool: ClientPool;
  member: Pool['members'][number];
  referenceCode: string;
  demoNow: string;
}

const STORAGE_SESSION_KEY = 'tally_demo_session_id_v1';
const STORAGE_ROLE_KEY = 'tally_demo_role_v1';
const SYNC_CHANNEL = 'tally-session-sync';

function generateSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `demo-${rand}`;
}

function resolveInitialSessionId(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('session')?.trim();
  if (fromUrl && /^[a-zA-Z0-9_-]{3,48}$/.test(fromUrl)) {
    window.localStorage.setItem(STORAGE_SESSION_KEY, fromUrl);
    return fromUrl;
  }
  const stored = window.localStorage.getItem(STORAGE_SESSION_KEY);
  if (stored && /^[a-zA-Z0-9_-]{3,48}$/.test(stored)) {
    return stored;
  }
  const created = generateSessionId();
  window.localStorage.setItem(STORAGE_SESSION_KEY, created);
  return created;
}

function resolveInitialRole(): PersonaRole {
  const stored = window.localStorage.getItem(STORAGE_ROLE_KEY);
  if (stored === 'buyer' || stored === 'organizer' || stored === 'seller') {
    return stored;
  }
  return 'buyer';
}

export class ApiRequestError extends Error {
  status: number;
  error: DomainActionError;
  constructor(status: number, error: DomainActionError) {
    super(error.message);
    this.status = status;
    this.error = error;
  }
}

interface TallyContextValue {
  sessionId: string;
  role: PersonaRole;
  session: ClientSessionResponse | null;
  loading: boolean;
  busy: boolean;
  loadError: string | null;
  banner: { kind: 'info' | 'success' | 'error'; text: string } | null;
  clearBanner: () => void;
  showBanner: (kind: 'info' | 'success' | 'error', text: string) => void;
  setRole: (role: PersonaRole) => void;
  switchSessionId: (nextId: string) => void;
  createIsolatedSession: () => void;
  refresh: () => Promise<void>;
  loadScenario: (scenarioId: DemoScenarioId) => Promise<void>;
  resetDemo: () => Promise<void>;
  findSimilarPoolsAction: (input: SimilarPoolQueryInput) => Promise<SimilarPoolsResponse>;
  createPoolAction: (input: CreatePoolInput) => Promise<string>;
  joinPoolAction: (poolId: string, input: JoinPoolInput) => Promise<void>;
  leavePoolAction: (poolId: string) => Promise<void>;
  postDiscussionAction: (
    poolId: string,
    body: string,
    isOrganizerUpdate?: boolean
  ) => Promise<void>;
  recalculateDemandAction: (poolId: string) => Promise<void>;
  requestSellerQuoteAction: (poolId: string) => Promise<string>;
  fetchSellerPacket: (token: string) => Promise<SellerPacketResponse>;
  publishSellerOfferAction: (
    token: string,
    input: PublishOfferInput
  ) => Promise<{ offer: SellerOffer; isRevision: boolean }>;
  confirmOfferAction: (
    poolId: string,
    offerVersion: number
  ) => Promise<{ unlockedNow: boolean; waitlisted: boolean }>;
  withdrawConfirmationAction: (poolId: string) => Promise<void>;
  passOfferAction: (poolId: string) => Promise<void>;
  fetchClaimPass: (poolId: string) => Promise<ClaimPassResponse>;
  markFulfilledAction: (poolId: string) => Promise<void>;
  toggleFollowAction: (poolId: string) => Promise<boolean>;
  createAlertAction: (input: CreateItemAlertInput) => Promise<SavedItemAlert>;
  updateAlertAction: (alertId: string, input: UpdateItemAlertInput) => Promise<SavedItemAlert>;
  markNotificationReadAction: (notificationId: string) => Promise<AlertNotification>;
  markAllNotificationsReadAction: () => Promise<number>;
  simulateConfirmAction: (poolId?: string) => Promise<{ unlockedNow: boolean; simulatedLabel: string }>;
  advanceClockAction: (poolId?: string) => Promise<void>;
  simulateRevisionAction: (poolId?: string) => Promise<SellerOffer>;
}

const TallyContext = createContext<TallyContextValue | null>(null);

export function TallyProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string>(() => resolveInitialSessionId());
  const [role, setRoleState] = useState<PersonaRole>(() => resolveInitialRole());
  const [session, setSession] = useState<ClientSessionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(
    null
  );
  const channelRef = useRef<BroadcastChannel | null>(null);

  const showBanner = useCallback((kind: 'info' | 'success' | 'error', text: string) => {
    setBanner({ kind, text });
  }, []);

  const clearBanner = useCallback(() => setBanner(null), []);

  const broadcastSync = useCallback(
    (sid: string) => {
      try {
        channelRef.current?.postMessage({ type: 'SESSION_UPDATED', sessionId: sid, at: Date.now() });
      } catch {
        // Ignore if BroadcastChannel unavailable
      }
    },
    []
  );

  const apiFetch = useCallback(
    async <T,>(
      url: string,
      options?: { method?: string; body?: unknown; sid?: string; r?: PersonaRole }
    ): Promise<T> => {
      const sid = options?.sid ?? sessionId;
      const activeRole = options?.r ?? role;
      const res = await fetch(url, {
        method: options?.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-tally-session': sid,
          'x-tally-role': activeRole,
        },
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const errObj: DomainActionError = payload?.error ?? {
          code: 'VALIDATION_ERROR',
          message: `Request failed (${res.status}).`,
        };
        throw new ApiRequestError(res.status, errObj);
      }
      return payload as T;
    },
    [sessionId, role]
  );

  const fetchSession = useCallback(
    async (sid = sessionId, activeRole = role, quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const data = await apiFetch<ClientSessionResponse>('/api/session', {
          sid,
          r: activeRole,
        });
        setSession(data);
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Unable to load Tally workspace.');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [apiFetch, sessionId, role]
  );

  useEffect(() => {
    void fetchSession(sessionId, role);
  }, [fetchSession, sessionId, role]);

  // Same-origin cross-tab synchronization
  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(SYNC_CHANNEL);
      channelRef.current = ch;
      ch.onmessage = (ev) => {
        if (ev.data?.type === 'SESSION_UPDATED' && ev.data?.sessionId === sessionId) {
          void fetchSession(sessionId, role, true);
        }
      };
      return () => {
        ch.close();
        channelRef.current = null;
      };
    }
    return undefined;
  }, [fetchSession, sessionId, role]);

  const setRole = useCallback((nextRole: PersonaRole) => {
    window.localStorage.setItem(STORAGE_ROLE_KEY, nextRole);
    setRoleState(nextRole);
  }, []);

  const switchSessionId = useCallback((nextId: string) => {
    const clean = nextId.trim();
    if (!/^[a-zA-Z0-9_-]{3,48}$/.test(clean)) return;
    window.localStorage.setItem(STORAGE_SESSION_KEY, clean);
    setSessionId(clean);
  }, []);

  const createIsolatedSession = useCallback(() => {
    const fresh = generateSessionId();
    window.localStorage.setItem(STORAGE_SESSION_KEY, fresh);
    setSessionId(fresh);
    showBanner('info', `Started isolated demo session ${fresh}.`);
  }, [showBanner]);

  const runMutation = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      setBusy(true);
      try {
        const result = await fn();
        broadcastSync(sessionId);
        return result;
      } finally {
        setBusy(false);
      }
    },
    [broadcastSync, sessionId]
  );

  const loadScenario = useCallback(
    async (scenarioId: DemoScenarioId) => {
      await runMutation(async () => {
        const next = await apiFetch<ClientSessionResponse>('/api/session/scenario', {
          method: 'POST',
          body: { scenarioId },
        });
        setSession(next);
        showBanner('info', `Loaded deterministic scenario: ${scenarioId}.`);
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const resetDemo = useCallback(async () => {
    await runMutation(async () => {
      const next = await apiFetch<ClientSessionResponse>('/api/session/reset', {
        method: 'POST',
      });
      setSession(next);
      showBanner('info', `Reset session ${sessionId} back to its clean seed state.`);
    });
  }, [apiFetch, runMutation, sessionId, showBanner]);

  const findSimilarPoolsAction = useCallback(
    async (input: SimilarPoolQueryInput) => {
      return apiFetch<SimilarPoolsResponse>('/api/pools/similar', {
        method: 'POST',
        body: input,
      });
    },
    [apiFetch]
  );

  const createPoolAction = useCallback(
    async (input: CreatePoolInput) => {
      return runMutation(async () => {
        const res = await apiFetch<{ poolId: string; session: ClientSessionResponse }>('/api/pools', {
          method: 'POST',
          body: input,
        });
        setSession(res.session);
        return res.poolId;
      });
    },
    [apiFetch, runMutation]
  );

  const joinPoolAction = useCallback(
    async (poolId: string, input: JoinPoolInput) => {
      await runMutation(async () => {
        const res = await apiFetch<{
          eligibility: { eligible: boolean; reasons: string[] };
          session: ClientSessionResponse;
        }>(`/api/pools/${encodeURIComponent(poolId)}/join`, {
          method: 'POST',
          body: input,
        });
        setSession(res.session);
        if (res.eligibility.eligible) {
          showBanner('success', 'Your compatible commitment is recorded in the live tally.');
        } else {
          showBanner(
            'error',
            `Saved, but excluded from eligible demand: ${res.eligibility.reasons[0] || 'Incompatible options.'}`
          );
        }
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const leavePoolAction = useCallback(
    async (poolId: string) => {
      await runMutation(async () => {
        const res = await apiFetch<{ session: ClientSessionResponse }>(
          `/api/pools/${encodeURIComponent(poolId)}/leave`,
          { method: 'POST' }
        );
        setSession(res.session);
        showBanner('info', 'You left the pool and the tally has been updated.');
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const postDiscussionAction = useCallback(
    async (poolId: string, body: string, isOrganizerUpdate = false) => {
      await runMutation(async () => {
        const res = await apiFetch<{ session: ClientSessionResponse }>(
          `/api/pools/${encodeURIComponent(poolId)}/discussion`,
          { method: 'POST', body: { body, isOrganizerUpdate } }
        );
        setSession(res.session);
      });
    },
    [apiFetch, runMutation]
  );

  const recalculateDemandAction = useCallback(
    async (poolId: string) => {
      await runMutation(async () => {
        const res = await apiFetch<{ session: ClientSessionResponse }>(
          `/api/pools/${encodeURIComponent(poolId)}/organize/recalculate`,
          { method: 'POST' }
        );
        setSession(res.session);
        showBanner('info', 'Recalculated eligible demand across current pool members.');
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const requestSellerQuoteAction = useCallback(
    async (poolId: string) => {
      return runMutation(async () => {
        const res = await apiFetch<{ sellerToken: string; session: ClientSessionResponse }>(
          `/api/pools/${encodeURIComponent(poolId)}/organize/request-quote`,
          { method: 'POST' }
        );
        setSession(res.session);
        showBanner('success', 'Private seller request link created. Buyers now see waiting-for-quote.');
        return res.sellerToken;
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const fetchSellerPacket = useCallback(
    async (token: string) => {
      return apiFetch<SellerPacketResponse>(`/api/seller/${encodeURIComponent(token)}`);
    },
    [apiFetch]
  );

  const publishSellerOfferAction = useCallback(
    async (token: string, input: PublishOfferInput) => {
      return runMutation(async () => {
        const res = await apiFetch<{
          offer: SellerOffer;
          isRevision: boolean;
          session: ClientSessionResponse;
        }>(`/api/seller/${encodeURIComponent(token)}/offer`, {
          method: 'POST',
          body: input,
        });
        setSession(res.session);
        showBanner(
          'success',
          res.isRevision
            ? `Published revised Offer v${res.offer.version}. Buyers must reconfirm.`
            : `Published Offer v${res.offer.version} for buyer review.`
        );
        return { offer: res.offer, isRevision: res.isRevision };
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const confirmOfferAction = useCallback(
    async (poolId: string, offerVersion: number) => {
      return runMutation(async () => {
        const res = await apiFetch<{
          unlockedNow: boolean;
          waitlisted: boolean;
          session: ClientSessionResponse;
        }>(`/api/pools/${encodeURIComponent(poolId)}/offer/confirm`, {
          method: 'POST',
          body: { offerVersion },
        });
        setSession(res.session);
        if (res.unlockedNow) {
          showBanner('success', 'Minimum reached — your group price is unlocked!');
        } else if (res.waitlisted) {
          showBanner('info', 'Offer cap reached. You have been added to the waitlist.');
        } else {
          showBanner('success', 'Confirmation recorded for the current offer version.');
        }
        return { unlockedNow: res.unlockedNow, waitlisted: res.waitlisted };
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const withdrawConfirmationAction = useCallback(
    async (poolId: string) => {
      await runMutation(async () => {
        const res = await apiFetch<{ session: ClientSessionResponse }>(
          `/api/pools/${encodeURIComponent(poolId)}/offer/withdraw`,
          { method: 'POST' }
        );
        setSession(res.session);
        showBanner('info', 'Confirmation withdrawn. You can still confirm before the deadline.');
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const passOfferAction = useCallback(
    async (poolId: string) => {
      await runMutation(async () => {
        const res = await apiFetch<{ session: ClientSessionResponse }>(
          `/api/pools/${encodeURIComponent(poolId)}/offer/pass`,
          { method: 'POST' }
        );
        setSession(res.session);
        showBanner('info', 'Recorded your Pass on this offer.');
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const fetchClaimPass = useCallback(
    async (poolId: string) => {
      return apiFetch<ClaimPassResponse>(`/api/pools/${encodeURIComponent(poolId)}/claim`);
    },
    [apiFetch]
  );

  const markFulfilledAction = useCallback(
    async (poolId: string) => {
      await runMutation(async () => {
        const res = await apiFetch<{ session: ClientSessionResponse }>(
          `/api/pools/${encodeURIComponent(poolId)}/claim/fulfill`,
          { method: 'POST' }
        );
        setSession(res.session);
        showBanner('success', 'Purchase marked as fulfilled in your Tally record.');
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const toggleFollowAction = useCallback(
    async (poolId: string) => {
      return runMutation(async () => {
        const res = await apiFetch<{ following: boolean; session: ClientSessionResponse }>(
          `/api/pools/${encodeURIComponent(poolId)}/follow`,
          { method: 'POST' }
        );
        setSession(res.session);
        showBanner(
          'info',
          res.following
            ? 'Following — you will see an alert if a follow-up pool opens.'
            : 'Removed from your followed pools.'
        );
        return res.following;
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const createAlertAction = useCallback(
    async (input: CreateItemAlertInput) => {
      return runMutation(async () => {
        const res = await apiFetch<{ alert: SavedItemAlert; session: ClientSessionResponse }>(
          '/api/alerts',
          { method: 'POST', body: input }
        );
        setSession(res.session);
        return res.alert;
      });
    },
    [apiFetch, runMutation]
  );

  const updateAlertAction = useCallback(
    async (alertId: string, input: UpdateItemAlertInput) => {
      return runMutation(async () => {
        const res = await apiFetch<{ alert: SavedItemAlert; session: ClientSessionResponse }>(
          `/api/alerts/${encodeURIComponent(alertId)}`,
          { method: 'PATCH', body: input }
        );
        setSession(res.session);
        return res.alert;
      });
    },
    [apiFetch, runMutation]
  );

  const markNotificationReadAction = useCallback(
    async (notificationId: string) => {
      return runMutation(async () => {
        const res = await apiFetch<{
          notification: AlertNotification;
          session: ClientSessionResponse;
        }>(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
          method: 'POST',
        });
        setSession(res.session);
        return res.notification;
      });
    },
    [apiFetch, runMutation]
  );

  const markAllNotificationsReadAction = useCallback(async () => {
    return runMutation(async () => {
      const res = await apiFetch<{ markedCount: number; session: ClientSessionResponse }>(
        '/api/notifications/read-all',
        { method: 'POST' }
      );
      setSession(res.session);
      return res.markedCount;
    });
  }, [apiFetch, runMutation]);

  const simulateConfirmAction = useCallback(
    async (poolId = 'pool-maverick-xlt') => {
      return runMutation(async () => {
        const res = await apiFetch<{
          unlockedNow: boolean;
          simulatedLabel: string;
          session: ClientSessionResponse;
        }>('/api/demo/simulate-confirm', {
          method: 'POST',
          body: { poolId },
        });
        setSession(res.session);
        showBanner(
          'info',
          res.unlockedNow
            ? `[Simulated] ${res.simulatedLabel} confirmed — group price unlocked!`
            : `[Simulated] Added 1 eligible confirmation (${res.simulatedLabel}).`
        );
        return { unlockedNow: res.unlockedNow, simulatedLabel: res.simulatedLabel };
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const advanceClockAction = useCallback(
    async (poolId = 'pool-maverick-xlt') => {
      await runMutation(async () => {
        const res = await apiFetch<{ newDemoNow: string; session: ClientSessionResponse }>(
          '/api/demo/advance-clock',
          { method: 'POST', body: { poolId } }
        );
        setSession(res.session);
        showBanner('info', '[Simulated clock] Advanced past the offer close deadline.');
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const simulateRevisionAction = useCallback(
    async (poolId = 'pool-maverick-xlt') => {
      return runMutation(async () => {
        const res = await apiFetch<{ offer: SellerOffer; session: ClientSessionResponse }>(
          '/api/demo/simulate-revision',
          { method: 'POST', body: { poolId } }
        );
        setSession(res.session);
        showBanner(
          'info',
          `[Simulated seller update] Published Offer v${res.offer.version}. Prior confirmations now require reconfirmation.`
        );
        return res.offer;
      });
    },
    [apiFetch, runMutation, showBanner]
  );

  const value = useMemo<TallyContextValue>(
    () => ({
      sessionId,
      role,
      session,
      loading,
      busy,
      loadError,
      banner,
      clearBanner,
      showBanner,
      setRole,
      switchSessionId,
      createIsolatedSession,
      refresh: () => fetchSession(sessionId, role, true),
      loadScenario,
      resetDemo,
      findSimilarPoolsAction,
      createPoolAction,
      joinPoolAction,
      leavePoolAction,
      postDiscussionAction,
      recalculateDemandAction,
      requestSellerQuoteAction,
      fetchSellerPacket,
      publishSellerOfferAction,
      confirmOfferAction,
      withdrawConfirmationAction,
      passOfferAction,
      fetchClaimPass,
      markFulfilledAction,
      toggleFollowAction,
      createAlertAction,
      updateAlertAction,
      markNotificationReadAction,
      markAllNotificationsReadAction,
      simulateConfirmAction,
      advanceClockAction,
      simulateRevisionAction,
    }),
    [
      sessionId,
      role,
      session,
      loading,
      busy,
      loadError,
      banner,
      clearBanner,
      showBanner,
      setRole,
      switchSessionId,
      createIsolatedSession,
      fetchSession,
      loadScenario,
      resetDemo,
      findSimilarPoolsAction,
      createPoolAction,
      joinPoolAction,
      leavePoolAction,
      postDiscussionAction,
      recalculateDemandAction,
      requestSellerQuoteAction,
      fetchSellerPacket,
      publishSellerOfferAction,
      confirmOfferAction,
      withdrawConfirmationAction,
      passOfferAction,
      fetchClaimPass,
      markFulfilledAction,
      toggleFollowAction,
      createAlertAction,
      updateAlertAction,
      markNotificationReadAction,
      markAllNotificationsReadAction,
      simulateConfirmAction,
      advanceClockAction,
      simulateRevisionAction,
    ]
  );

  return React.createElement(TallyContext.Provider, { value }, children);
}

export function useTally(): TallyContextValue {
  const ctx = useContext(TallyContext);
  if (!ctx) throw new Error('useTally must be used inside TallyProvider');
  return ctx;
}
