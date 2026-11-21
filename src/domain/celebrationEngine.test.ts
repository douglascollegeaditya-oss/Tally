import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceCelebration,
  buildJoinCelebrationEvents,
  buildOfferUnlockCelebrationEvent,
  clearPoolJoinSeenKey,
  clearSessionCelebrationHistory,
  createInitialCelebrationState,
  dismissAllCelebrations,
  enqueueCelebrations,
  resolveCelebrationPresentation,
  type CelebrationPoolSnapshot,
} from './celebrationEngine.ts';
import { createSeedSession, PERSONAS } from './seedData.ts';
import {
  computePoolMetrics,
  confirmOffer,
  joinOrUpdatePool,
  leavePool,
  simulateAnotherConfirmation,
} from './tallyEngine.ts';

function toSnapshot(
  state: ReturnType<typeof createSeedSession>,
  poolId: string
): CelebrationPoolSnapshot {
  const pool = state.pools.find((p) => p.id === poolId);
  assert.ok(pool, `Expected pool ${poolId} to exist`);
  return {
    id: pool.id,
    title: pool.title,
    category: pool.category,
    location: pool.location,
    unitSingular: pool.unitSingular,
    unitPlural: pool.unitPlural,
    currentOffer: pool.currentOffer,
    metrics: computePoolMetrics(pool, state.demoNow),
  };
}

function defaultAllowedOptions(
  state: ReturnType<typeof createSeedSession>,
  poolId: string
): Record<string, string> {
  const pool = state.pools.find((p) => p.id === poolId);
  assert.ok(pool, `Expected pool ${poolId} to exist`);
  const opts: Record<string, string> = {};
  for (const g of pool.optionGroups) {
    opts[g.id] = g.allowedValues[0] || g.allValues[0];
  }
  return opts;
}

test('successful eligible join below target emits only pool_joined celebration with accurate pool info', () => {
  const seed = createSeedSession('test-join-only', 'gathering-7-of-8');
  const vinylBefore = toSnapshot(seed, 'pool-vinyl-box');
  // pool-vinyl-box starts below its 20-copy target
  const outcome = joinOrUpdatePool(seed, 'pool-vinyl-box', PERSONAS.buyer, {
    quantity: 1,
    selectedOptions: defaultAllowedOptions(seed, 'pool-vinyl-box'),
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.data.isNewJoin, true);
  assert.equal(outcome.data.eligibility.eligible, true);
  assert.equal(outcome.data.targetReachedNow, false);

  const expectedCount = vinylBefore.metrics.eligibleInterestedUnits + 1;
  const events = buildJoinCelebrationEvents({
    ok: true,
    sessionId: seed.sessionId,
    actorId: PERSONAS.buyer.id,
    isNewJoin: outcome.data.isNewJoin,
    eligible: outcome.data.eligibility.eligible,
    targetReachedNow: outcome.data.targetReachedNow,
    quantityJoined: 1,
    pool: toSnapshot(outcome.state, 'pool-vinyl-box'),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'pool_joined');
  assert.equal(events[0].poolId, 'pool-vinyl-box');
  assert.equal(events[0].poolTitle, outcome.data.pool.title);
  assert.equal(events[0].currentCount, expectedCount);
  assert.equal(events[0].targetMin, vinylBefore.metrics.targetMin);
  assert.ok(events[0].announcement.includes(`${expectedCount} of ${vinylBefore.metrics.targetMin}`));
});

test('failed, duplicate, and excluded/incompatible joins do NOT fire join celebration', () => {
  const seed = createSeedSession('test-join-guards', 'gathering-7-of-8');
  const vinylOpts = defaultAllowedOptions(seed, 'pool-vinyl-box');

  // 1) Failed join (seller role)
  const sellerAttempt = joinOrUpdatePool(seed, 'pool-vinyl-box', PERSONAS.seller, {
    quantity: 1,
    selectedOptions: vinylOpts,
  });
  assert.equal(sellerAttempt.ok, false);
  assert.deepEqual(
    buildJoinCelebrationEvents({
      ok: false,
      sessionId: seed.sessionId,
      actorId: PERSONAS.seller.id,
      isNewJoin: true,
      eligible: true,
      targetReachedNow: false,
      quantityJoined: 1,
      pool: toSnapshot(seed, 'pool-vinyl-box'),
    }),
    []
  );

  // 2) Failed join (invalid quantity)
  const invalidQty = joinOrUpdatePool(seed, 'pool-vinyl-box', PERSONAS.buyer, {
    quantity: 0,
    selectedOptions: vinylOpts,
  });
  assert.equal(invalidQty.ok, false);

  // 3) Incompatible / excluded join (does not celebrate & does not obscure exclusion error)
  const excludedJoin = joinOrUpdatePool(seed, 'pool-maverick-xlt', PERSONAS.buyer, {
    quantity: 1,
    selectedOptions: {
      trim: 'Lariat EcoBoost (Excluded)',
      delivery: 'Portland metro pickup',
    },
  });
  assert.equal(excludedJoin.ok, true);
  if (!excludedJoin.ok) return;
  assert.equal(excludedJoin.data.eligibility.eligible, false);
  assert.equal(excludedJoin.data.targetReachedNow, false);
  const excludedEvents = buildJoinCelebrationEvents({
    ok: true,
    sessionId: seed.sessionId,
    actorId: PERSONAS.buyer.id,
    isNewJoin: excludedJoin.data.isNewJoin,
    eligible: excludedJoin.data.eligibility.eligible,
    targetReachedNow: excludedJoin.data.targetReachedNow,
    quantityJoined: 1,
    pool: toSnapshot(excludedJoin.state, 'pool-maverick-xlt'),
  });
  assert.equal(excludedEvents.length, 0);

  // 4) Duplicate join / preference edit below target does NOT replay pool_joined
  const firstJoin = joinOrUpdatePool(seed, 'pool-vinyl-box', PERSONAS.buyer, {
    quantity: 1,
    selectedOptions: vinylOpts,
  });
  assert.equal(firstJoin.ok, true);
  if (!firstJoin.ok) return;

  const duplicateEdit = joinOrUpdatePool(firstJoin.state, 'pool-vinyl-box', PERSONAS.buyer, {
    quantity: 2,
    selectedOptions: vinylOpts,
  });
  assert.equal(duplicateEdit.ok, true);
  if (!duplicateEdit.ok) return;
  assert.equal(duplicateEdit.data.isNewJoin, false);
  assert.equal(duplicateEdit.data.targetReachedNow, false);
  const dupEvents = buildJoinCelebrationEvents({
    ok: true,
    sessionId: seed.sessionId,
    actorId: PERSONAS.buyer.id,
    isNewJoin: duplicateEdit.data.isNewJoin,
    eligible: duplicateEdit.data.eligibility.eligible,
    targetReachedNow: duplicateEdit.data.targetReachedNow,
    quantityJoined: 2,
    pool: toSnapshot(duplicateEdit.state, 'pool-vinyl-box'),
  });
  assert.equal(dupEvents.length, 0);

  // 5) Fixing an excluded join to compatible options crosses 7/8 -> 8/8: fires ONLY target_reached (not duplicate join)
  const fixToCompatible = joinOrUpdatePool(excludedJoin.state, 'pool-maverick-xlt', PERSONAS.buyer, {
    quantity: 1,
    selectedOptions: {
      trim: 'XLT Hybrid AWD',
      delivery: 'Portland metro pickup',
    },
  });
  assert.equal(fixToCompatible.ok, true);
  if (!fixToCompatible.ok) return;
  assert.equal(fixToCompatible.data.isNewJoin, false);
  assert.equal(fixToCompatible.data.eligibility.eligible, true);
  assert.equal(fixToCompatible.data.targetReachedNow, true);
  const fixEvents = buildJoinCelebrationEvents({
    ok: true,
    sessionId: seed.sessionId,
    actorId: PERSONAS.buyer.id,
    isNewJoin: fixToCompatible.data.isNewJoin,
    eligible: fixToCompatible.data.eligibility.eligible,
    targetReachedNow: fixToCompatible.data.targetReachedNow,
    quantityJoined: 1,
    pool: toSnapshot(fixToCompatible.state, 'pool-maverick-xlt'),
  });
  assert.equal(fixEvents.length, 1);
  assert.equal(fixEvents[0].kind, 'target_reached');
  assert.equal(fixEvents[0].thresholdKind, 'gathering_minimum');
});

test('simultaneous join + target crossing queues BOTH distinct moments in order without duplicate joins', () => {
  const seed = createSeedSession('test-simultaneous', 'gathering-7-of-8');
  // pool-maverick-xlt starts at 7 of 8 vehicles interested (gathering)
  const outcome = joinOrUpdatePool(seed, 'pool-maverick-xlt', PERSONAS.buyer, {
    quantity: 1,
    selectedOptions: {
      trim: 'XLT Hybrid AWD',
      delivery: 'Portland metro pickup',
    },
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.data.isNewJoin, true);
  assert.equal(outcome.data.eligibility.eligible, true);
  assert.equal(outcome.data.targetReachedNow, true);
  assert.equal(outcome.data.previousEligibleUnits, 7);
  assert.equal(outcome.data.currentEligibleUnits, 8);
  assert.equal(outcome.data.targetMin, 8);

  // Confirm member count did not duplicate
  const buyerEntries = outcome.data.pool.members.filter((m) => m.userId === PERSONAS.buyer.id);
  assert.equal(buyerEntries.length, 1);

  const events = buildJoinCelebrationEvents({
    ok: true,
    sessionId: seed.sessionId,
    actorId: PERSONAS.buyer.id,
    isNewJoin: outcome.data.isNewJoin,
    eligible: outcome.data.eligibility.eligible,
    targetReachedNow: outcome.data.targetReachedNow,
    quantityJoined: 1,
    pool: toSnapshot(outcome.state, 'pool-maverick-xlt'),
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'pool_joined');
  assert.equal(events[1].kind, 'target_reached');
  assert.equal(events[1].thresholdKind, 'gathering_minimum');
  assert.notEqual(events[0].headline, events[1].headline);
  assert.notEqual(events[0].kicker, events[1].kicker);

  // Walk through queue state machine cleanly
  let queueState = createInitialCelebrationState();
  queueState = enqueueCelebrations(queueState, events);
  assert.equal(queueState.active?.kind, 'pool_joined');
  assert.equal(queueState.queue.length, 1);
  assert.equal(queueState.queue[0].kind, 'target_reached');

  // Advancing reveals distinct target_reached moment
  queueState = advanceCelebration(queueState);
  assert.equal(queueState.active?.kind, 'target_reached');
  assert.equal(queueState.queue.length, 0);

  // Advancing again clears cleanly
  queueState = advanceCelebration(queueState);
  assert.equal(queueState.active, null);

  // Re-enqueuing same events (e.g. duplicate dispatch or revisit) does NOT replay
  const afterReplayAttempt = enqueueCelebrations(queueState, events);
  assert.equal(afterReplayAttempt.active, null);
  assert.equal(afterReplayAttempt.queue.length, 0);
});

test('already-reached pool does NOT fire target_reached when revisiting, editing, or adding another join', () => {
  const seed = createSeedSession('test-already-reached', 'ready-for-quote');
  // In ready-for-quote scenario, pool-maverick-xlt is already 8/8 and Maya is already a member
  const editOutcome = joinOrUpdatePool(seed, 'pool-maverick-xlt', PERSONAS.buyer, {
    quantity: 2,
    selectedOptions: {
      trim: 'XLT Hybrid AWD',
      delivery: 'Portland metro pickup',
    },
  });

  assert.equal(editOutcome.ok, true);
  if (!editOutcome.ok) return;
  assert.equal(editOutcome.data.isNewJoin, false);
  assert.equal(editOutcome.data.targetReachedNow, false);

  const editEvents = buildJoinCelebrationEvents({
    ok: true,
    sessionId: seed.sessionId,
    actorId: PERSONAS.buyer.id,
    isNewJoin: editOutcome.data.isNewJoin,
    eligible: editOutcome.data.eligibility.eligible,
    targetReachedNow: editOutcome.data.targetReachedNow,
    quantityJoined: 2,
    pool: toSnapshot(editOutcome.state, 'pool-maverick-xlt'),
  });
  assert.equal(editEvents.length, 0);

  // Even if Maya leaves and re-joins an already-target-met pool (when still >= target or after target seen),
  // seen target key never replays target_reached!
  let queueState = createInitialCelebrationState([
    `${seed.sessionId}:pool-maverick-xlt:target_reached:gathering_minimum`,
  ]);
  const left = leavePool(seed, 'pool-maverick-xlt', PERSONAS.buyer);
  assert.equal(left.ok, true);
  if (!left.ok) return;
  queueState = clearPoolJoinSeenKey(queueState, seed.sessionId, 'pool-maverick-xlt', PERSONAS.buyer.id);

  const rejoined = joinOrUpdatePool(left.state, 'pool-maverick-xlt', PERSONAS.buyer, {
    quantity: 1,
    selectedOptions: {
      trim: 'XLT Hybrid AWD',
      delivery: 'Portland metro pickup',
    },
  });
  assert.equal(rejoined.ok, true);
  if (!rejoined.ok) return;

  const rejoinEvents = buildJoinCelebrationEvents({
    ok: true,
    sessionId: seed.sessionId,
    actorId: PERSONAS.buyer.id,
    isNewJoin: rejoined.data.isNewJoin,
    eligible: rejoined.data.eligibility.eligible,
    targetReachedNow: rejoined.data.targetReachedNow,
    quantityJoined: 1,
    pool: toSnapshot(rejoined.state, 'pool-maverick-xlt'),
  });
  queueState = enqueueCelebrations(queueState, rejoinEvents);
  // Only pool_joined should fire; target_reached is deduplicated and does NOT replay
  assert.equal(queueState.active?.kind, 'pool_joined');
  assert.equal(queueState.queue.length, 0);
});

test('offer confirmation unlock crosses offer target threshold once and never replays on repeat confirmation', () => {
  const seed = createSeedSession('test-offer-unlock', 'reviewing-6-of-8');
  // Bring 6/8 -> 7/8 with simulated confirm (not unlocked yet)
  const step1 = simulateAnotherConfirmation(seed, 'pool-maverick-xlt');
  assert.equal(step1.ok, true);
  if (!step1.ok) return;
  assert.equal(step1.data.unlockedNow, false);
  const step1Ev = buildOfferUnlockCelebrationEvent({
    ok: true,
    sessionId: seed.sessionId,
    unlockedNow: step1.data.unlockedNow,
    pool: toSnapshot(step1.state, 'pool-maverick-xlt'),
  });
  assert.equal(step1Ev, null);

  // Maya confirms 7/8 -> 8/8 (authoritative unlock crossing!)
  const step2 = confirmOffer(step1.state, 'pool-maverick-xlt', PERSONAS.buyer, 1);
  assert.equal(step2.ok, true);
  if (!step2.ok) return;
  assert.equal(step2.data.unlockedNow, true);

  const unlockEv = buildOfferUnlockCelebrationEvent({
    ok: true,
    sessionId: seed.sessionId,
    unlockedNow: step2.data.unlockedNow,
    waitlisted: step2.data.waitlisted,
    pool: toSnapshot(step2.state, 'pool-maverick-xlt'),
    canOpenClaimPass: true,
  });
  assert.ok(unlockEv);
  assert.equal(unlockEv.kind, 'target_reached');
  assert.equal(unlockEv.thresholdKind, 'offer_unlocked');
  assert.equal(unlockEv.currentCount, 8);
  assert.equal(unlockEv.targetMin, 8);
  assert.equal(unlockEv.secondaryCtaHref, '/pools/pool-maverick-xlt/claim');

  let queueState = createInitialCelebrationState();
  queueState = enqueueCelebrations(queueState, [unlockEv]);
  assert.equal(queueState.active?.kind, 'target_reached');

  queueState = dismissAllCelebrations(queueState);
  assert.equal(queueState.active, null);

  // Idempotent repeat confirm does NOT unlock again or replay celebration
  const repeat = confirmOffer(step2.state, 'pool-maverick-xlt', PERSONAS.buyer, 1);
  assert.equal(repeat.ok, true);
  if (!repeat.ok) return;
  assert.equal(repeat.data.unlockedNow, false);
  assert.equal(
    buildOfferUnlockCelebrationEvent({
      ok: true,
      sessionId: seed.sessionId,
      unlockedNow: repeat.data.unlockedNow,
      pool: toSnapshot(repeat.state, 'pool-maverick-xlt'),
    }),
    null
  );

  // Explicit demo reset clears session celebration history cleanly
  const cleared = clearSessionCelebrationHistory(queueState, seed.sessionId);
  assert.equal(cleared.seenKeys.length, 0);
});

test('reduced-motion presentation disables particles and motion while keeping distinct accessible announcements', () => {
  const seed = createSeedSession('test-reduced-motion', 'gathering-7-of-8');
  const outcome = joinOrUpdatePool(seed, 'pool-maverick-xlt', PERSONAS.buyer, {
    quantity: 1,
    selectedOptions: {
      trim: 'XLT Hybrid AWD',
      delivery: 'Portland metro pickup',
    },
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const [joinEv, targetEv] = buildJoinCelebrationEvents({
    ok: true,
    sessionId: seed.sessionId,
    actorId: PERSONAS.buyer.id,
    isNewJoin: outcome.data.isNewJoin,
    eligible: outcome.data.eligibility.eligible,
    targetReachedNow: outcome.data.targetReachedNow,
    quantityJoined: 1,
    pool: toSnapshot(outcome.state, 'pool-maverick-xlt'),
  });

  const joinReduced = resolveCelebrationPresentation(joinEv, true);
  assert.equal(joinReduced.mode, 'reduced');
  assert.equal(joinReduced.enableMotion, false);
  assert.equal(joinReduced.particleCount, 0);
  assert.equal(joinReduced.allowConfetti, false);
  assert.equal(joinReduced.allowBurstLines, false);
  assert.equal(joinReduced.allowStampBounce, false);
  assert.ok(joinReduced.announcement.includes(joinEv.poolTitle));

  const targetReduced = resolveCelebrationPresentation(targetEv, true);
  assert.equal(targetReduced.mode, 'reduced');
  assert.equal(targetReduced.enableMotion, false);
  assert.equal(targetReduced.particleCount, 0);
  assert.equal(targetReduced.allowConfetti, false);
  assert.equal(targetReduced.allowBurstLines, false);
  assert.notEqual(joinReduced.headline, targetReduced.headline);
  assert.notEqual(joinReduced.announcement, targetReduced.announcement);
  assert.notEqual(joinReduced.motionSummary, targetReduced.motionSummary);

  const targetAnimated = resolveCelebrationPresentation(targetEv, false);
  assert.equal(targetAnimated.mode, 'animated');
  assert.equal(targetAnimated.enableMotion, true);
  assert.ok(targetAnimated.particleCount > 0);
  assert.equal(targetAnimated.allowConfetti, true);
  assert.equal(targetAnimated.allowBurstLines, true);
});
