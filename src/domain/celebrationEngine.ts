import type { Pool, PoolCategory, PoolMetrics } from './types.ts';

export type CelebrationKind = 'pool_joined' | 'target_reached';
export type TargetThresholdKind = 'gathering_minimum' | 'offer_unlocked';

export interface CelebrationEvent {
  id: string;
  dedupeKey: string;
  kind: CelebrationKind;
  thresholdKind?: TargetThresholdKind;
  poolId: string;
  poolTitle: string;
  category: PoolCategory;
  location: string;
  currentCount: number;
  targetMin: number;
  unitSingular: string;
  unitPlural: string;
  countVerb: 'interested' | 'confirmed';
  quantityJoined?: number;
  kicker: string;
  headline: string;
  subheadline: string;
  detail: string;
  primaryCtaLabel: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  stageLabel: string;
  announcement: string;
}

export interface CelebrationQueueState {
  active: CelebrationEvent | null;
  queue: CelebrationEvent[];
  seenKeys: string[];
}

export interface CelebrationPresentation {
  mode: 'animated' | 'reduced';
  enableMotion: boolean;
  particleCount: number;
  allowConfetti: boolean;
  allowBurstLines: boolean;
  allowStampBounce: boolean;
  headline: string;
  announcement: string;
  motionSummary: string;
}

export interface CelebrationPoolSnapshot {
  id: string;
  title: string;
  category: PoolCategory;
  location: string;
  unitSingular: string;
  unitPlural: string;
  currentOffer?: Pool['currentOffer'];
  metrics: PoolMetrics;
}

function formatUnitCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function createInitialCelebrationState(seenKeys: string[] = []): CelebrationQueueState {
  return {
    active: null,
    queue: [],
    seenKeys: Array.from(new Set(seenKeys)),
  };
}

export function buildJoinCelebrationEvents(params: {
  ok: boolean;
  sessionId: string;
  actorId: string;
  isNewJoin: boolean;
  eligible: boolean;
  targetReachedNow: boolean;
  quantityJoined: number;
  pool: CelebrationPoolSnapshot | null | undefined;
}): CelebrationEvent[] {
  const { ok, sessionId, actorId, isNewJoin, eligible, targetReachedNow, quantityJoined, pool } =
    params;
  if (!ok || !pool || !eligible) {
    return [];
  }

  const events: CelebrationEvent[] = [];
  const currentCount = pool.metrics.eligibleInterestedUnits;
  const targetMin = pool.metrics.targetMin;
  const addedLabel = formatUnitCount(quantityJoined, pool.unitSingular, pool.unitPlural);

  if (isNewJoin) {
    const dedupeKey = `${sessionId}:${pool.id}:pool_joined:${actorId}`;
    const remaining = Math.max(0, targetMin - currentCount);
    const progressSentence =
      remaining === 0
        ? `The group tally is now at ${currentCount} of ${targetMin} ${pool.unitPlural} interested.`
        : `The group tally is now at ${currentCount} of ${targetMin} ${pool.unitPlural} interested — ${formatUnitCount(remaining, pool.unitSingular, pool.unitPlural)} left to reach minimum.`;

    events.push({
      id: `${dedupeKey}:1`,
      dedupeKey,
      kind: 'pool_joined',
      poolId: pool.id,
      poolTitle: pool.title,
      category: pool.category,
      location: pool.location,
      currentCount,
      targetMin,
      unitSingular: pool.unitSingular,
      unitPlural: pool.unitPlural,
      countVerb: 'interested',
      quantityJoined,
      kicker: 'Spot recorded · Non-binding interest',
      headline: 'You’re in the pool',
      subheadline: pool.title,
      detail: `Recorded ${addedLabel} in the live tally. ${progressSentence}`,
      primaryCtaLabel: targetReachedNow ? 'Next: Target reached' : 'Continue',
      secondaryCtaLabel: 'Open pool',
      secondaryCtaHref: `/pools/${pool.id}`,
      stageLabel:
        pool.metrics.effectiveStage === 'ready_for_quote' ? 'Ready for quote' : 'Gathering interest',
      announcement: `Joined ${pool.title}. Recorded ${addedLabel}. ${progressSentence}`,
    });
  }

  if (targetReachedNow) {
    const dedupeKey = `${sessionId}:${pool.id}:target_reached:gathering_minimum`;
    events.push({
      id: `${dedupeKey}:1`,
      dedupeKey,
      kind: 'target_reached',
      thresholdKind: 'gathering_minimum',
      poolId: pool.id,
      poolTitle: pool.title,
      category: pool.category,
      location: pool.location,
      currentCount,
      targetMin,
      unitSingular: pool.unitSingular,
      unitPlural: pool.unitPlural,
      countVerb: 'interested',
      kicker: 'Minimum target reached',
      headline: 'Target hit · Ready for quote',
      subheadline: pool.title,
      detail: `${pool.title} crossed its ${targetMin}-${pool.unitSingular} minimum with ${currentCount} of ${targetMin} ${pool.unitPlural} interested. The organizer can now request a group seller quote.`,
      primaryCtaLabel: 'Continue',
      secondaryCtaLabel: 'View pool',
      secondaryCtaHref: `/pools/${pool.id}`,
      stageLabel: 'Ready for quote',
      announcement: `Target reached for ${pool.title}. ${currentCount} of ${targetMin} ${pool.unitPlural} interested. The pool is now ready for a seller quote.`,
    });
  }

  return events;
}

export function buildOfferUnlockCelebrationEvent(params: {
  ok: boolean;
  sessionId: string;
  unlockedNow: boolean;
  waitlisted?: boolean;
  pool: CelebrationPoolSnapshot | null | undefined;
  canOpenClaimPass?: boolean;
}): CelebrationEvent | null {
  const { ok, sessionId, unlockedNow, waitlisted = false, pool, canOpenClaimPass = false } = params;
  if (!ok || !unlockedNow || waitlisted || !pool || !pool.currentOffer) {
    return null;
  }

  const version = pool.currentOffer.version;
  const currentCount = pool.metrics.confirmedUnits;
  const targetMin = pool.metrics.targetMin;
  const dedupeKey = `${sessionId}:${pool.id}:target_reached:offer_unlocked:v${version}`;

  return {
    id: `${dedupeKey}:1`,
    dedupeKey,
    kind: 'target_reached',
    thresholdKind: 'offer_unlocked',
    poolId: pool.id,
    poolTitle: pool.title,
    category: pool.category,
    location: pool.location,
    currentCount,
    targetMin,
    unitSingular: pool.unitSingular,
    unitPlural: pool.unitPlural,
    countVerb: 'confirmed',
    kicker: `Group target reached · Offer v${version}`,
    headline: 'Group price unlocked',
    subheadline: pool.title,
    detail: `${pool.title} reached ${currentCount} of ${targetMin} ${pool.unitPlural} confirmed before the deadline. Confirmed buyers can now open private claim instructions and purchase directly from the seller.`,
    primaryCtaLabel: 'Continue',
    secondaryCtaLabel: canOpenClaimPass ? 'Open claim pass' : 'View pool',
    secondaryCtaHref: canOpenClaimPass ? `/pools/${pool.id}/claim` : `/pools/${pool.id}`,
    stageLabel: 'Unlocked',
    announcement: `Target reached and group price unlocked for ${pool.title}. ${currentCount} of ${targetMin} ${pool.unitPlural} confirmed.`,
  };
}

export function enqueueCelebrations(
  state: CelebrationQueueState,
  incoming: CelebrationEvent[]
): CelebrationQueueState {
  if (incoming.length === 0) return state;

  const seenSet = new Set(state.seenKeys);
  const queuedKeys = new Set<string>();
  if (state.active) queuedKeys.add(state.active.dedupeKey);
  for (const item of state.queue) {
    queuedKeys.add(item.dedupeKey);
  }

  const accepted: CelebrationEvent[] = [];
  for (const ev of incoming) {
    if (seenSet.has(ev.dedupeKey) || queuedKeys.has(ev.dedupeKey)) {
      continue;
    }
    seenSet.add(ev.dedupeKey);
    queuedKeys.add(ev.dedupeKey);
    accepted.push(ev);
  }

  if (accepted.length === 0) return state;

  const nextSeen = Array.from(seenSet);
  if (!state.active) {
    return {
      active: accepted[0],
      queue: [...state.queue, ...accepted.slice(1)],
      seenKeys: nextSeen,
    };
  }

  return {
    active: state.active,
    queue: [...state.queue, ...accepted],
    seenKeys: nextSeen,
  };
}

export function advanceCelebration(state: CelebrationQueueState): CelebrationQueueState {
  if (!state.active && state.queue.length === 0) return state;
  if (state.queue.length === 0) {
    return {
      ...state,
      active: null,
    };
  }
  const [nextActive, ...rest] = state.queue;
  return {
    ...state,
    active: nextActive,
    queue: rest,
  };
}

export function dismissAllCelebrations(state: CelebrationQueueState): CelebrationQueueState {
  if (!state.active && state.queue.length === 0) return state;
  return {
    ...state,
    active: null,
    queue: [],
  };
}

export function clearPoolJoinSeenKey(
  state: CelebrationQueueState,
  sessionId: string,
  poolId: string,
  actorId: string
): CelebrationQueueState {
  const joinKey = `${sessionId}:${poolId}:pool_joined:${actorId}`;
  if (!state.seenKeys.includes(joinKey)) return state;
  return {
    ...state,
    seenKeys: state.seenKeys.filter((k) => k !== joinKey),
  };
}

export function clearSessionCelebrationHistory(
  state: CelebrationQueueState,
  sessionId: string
): CelebrationQueueState {
  const prefix = `${sessionId}:`;
  return {
    active: null,
    queue: [],
    seenKeys: state.seenKeys.filter((k) => !k.startsWith(prefix)),
  };
}

export function resolveCelebrationPresentation(
  event: CelebrationEvent,
  prefersReducedMotion: boolean
): CelebrationPresentation {
  if (prefersReducedMotion) {
    return {
      mode: 'reduced',
      enableMotion: false,
      particleCount: 0,
      allowConfetti: false,
      allowBurstLines: false,
      allowStampBounce: false,
      headline: event.headline,
      announcement: event.announcement,
      motionSummary:
        event.kind === 'target_reached'
          ? 'Static target-reached editorial announcement (reduced motion)'
          : 'Static pool-joined editorial confirmation (reduced motion)',
    };
  }

  return {
    mode: 'animated',
    enableMotion: true,
    particleCount: event.kind === 'target_reached' ? 26 : 18,
    allowConfetti: true,
    allowBurstLines: event.kind === 'target_reached',
    allowStampBounce: true,
    headline: event.headline,
    announcement: event.announcement,
    motionSummary:
      event.kind === 'target_reached'
        ? 'Full-screen marigold target-reached broadsheet takeover'
        : 'Full-screen spruce & parchment ledger-stamp celebration',
  };
}
