import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedSession, PERSONAS, MAVERICK_OFFER_CLOSE_ISO } from './seedData.ts';
import {
  advanceClockPastDeadline,
  applyFordScenario,
  canAccessClaimRoute,
  canAccessOrganizerRoute,
  canAccessSellerRoute,
  canManagePool,
  computePoolMetrics,
  confirmOffer,
  createPool,
  joinOrUpdatePool,
  leavePool,
  markBuyerFulfilled,
  normalizeCalendarDate,
  postDiscussionMessage,
  publishOrReviseSellerOffer,
  recalculatePoolDemand,
  requestSellerQuote,
  sanitizePoolForRole,
  simulateAnotherConfirmation,
  simulateSellerTermRevision,
  withdrawConfirmation,
} from './tallyEngine.ts';
import { formatCalendarDate } from '../lib/format.ts';

test('Gathering 7/8 -> Buyer joins -> becomes 8/8 and Ready for quote, while incompatible member stays excluded', () => {
  const session = createSeedSession('test-1', 'gathering-7-of-8');
  const pool = session.pools.find((p) => p.id === 'pool-maverick-xlt')!;

  const initialMetrics = computePoolMetrics(pool, session.demoNow);
  assert.equal(initialMetrics.effectiveStage, 'gathering');
  assert.equal(initialMetrics.eligibleInterestedUnits, 7);
  assert.equal(initialMetrics.excludedUnits, 1);

  const joinRes = joinOrUpdatePool(session, 'pool-maverick-xlt', PERSONAS.buyer, {
    quantity: 1,
    selectedOptions: {
      trim: 'XLT Hybrid AWD',
      color: 'Cactus Gray',
      delivery: 'Portland metro pickup',
    },
  });
  assert.equal(joinRes.ok, true);
  if (!joinRes.ok) return;

  assert.equal(joinRes.data.eligibility.eligible, true);
  const afterMetrics = computePoolMetrics(joinRes.data.pool, joinRes.state.demoNow);
  assert.equal(afterMetrics.eligibleInterestedUnits, 8);
  assert.equal(afterMetrics.excludedUnits, 1);
  assert.equal(afterMetrics.effectiveStage, 'ready_for_quote');

  // Leaving reverts back to 7/8 gathering
  const leaveRes = leavePool(joinRes.state, 'pool-maverick-xlt', PERSONAS.buyer);
  assert.equal(leaveRes.ok, true);
  if (!leaveRes.ok) return;
  const revertedMetrics = computePoolMetrics(leaveRes.data.pool, leaveRes.state.demoNow);
  assert.equal(revertedMetrics.eligibleInterestedUnits, 7);
  assert.equal(revertedMetrics.effectiveStage, 'gathering');
});

test('Incompatible buyer preferences are flagged and excluded from eligible demand', () => {
  const session = createSeedSession('test-2', 'gathering-7-of-8');
  const joinRes = joinOrUpdatePool(session, 'pool-maverick-xlt', PERSONAS.buyer, {
    quantity: 1,
    selectedOptions: {
      trim: 'Lariat EcoBoost (Excluded)',
      color: 'Oxford White',
      delivery: 'Out-of-state shipping',
    },
  });
  assert.equal(joinRes.ok, true);
  if (!joinRes.ok) return;
  assert.equal(joinRes.data.eligibility.eligible, false);
  assert.ok(joinRes.data.eligibility.reasons.length >= 2);

  const metrics = computePoolMetrics(joinRes.data.pool, joinRes.state.demoNow);
  assert.equal(metrics.eligibleInterestedUnits, 7);
  assert.equal(metrics.excludedUnits, 2);
  assert.equal(metrics.effectiveStage, 'gathering');
});

test('Full flow: Ready -> Organizer requests quote -> Seller publishes -> Buyer confirms -> Unlock -> Fulfill', () => {
  let state = createSeedSession('test-3', 'ready-for-quote');

  // Buyer cannot request quote
  const badReq = requestSellerQuote(state, 'pool-maverick-xlt', PERSONAS.buyer);
  assert.equal(badReq.ok, false);
  if (!badReq.ok) assert.equal(badReq.error.code, 'FORBIDDEN_ROLE');

  // Organizer requests quote
  const reqRes = requestSellerQuote(state, 'pool-maverick-xlt', PERSONAS.organizer);
  assert.equal(reqRes.ok, true);
  if (!reqRes.ok) return;
  state = reqRes.state;
  assert.equal(reqRes.data.pool.stage, 'quote_requested');
  const token = reqRes.data.sellerToken;

  // Seller publishes Alder Motor Co. quote
  const pubRes = publishOrReviseSellerOffer(state, token, PERSONAS.seller, {
    sellerName: 'Alder Motor Co.',
    sellerLocation: 'Portland, OR',
    matchingScope: '2026 Ford Maverick XLT Hybrid AWD · Portland pickup',
    currency: 'USD',
    unitPrice: 27900,
    knownFees: 395,
    feeLabel: 'Dealer documentation fee',
    taxAndRegistrationNote: 'Excludes tax and registration.',
    minQuantity: 8,
    maxQuantity: 8,
    fulfillmentMethod: 'Direct pickup at Alder Motor Co.',
    closeAt: MAVERICK_OFFER_CLOSE_ISO,
    timezoneLabel: 'Pacific',
    claimByDate: '2026-12-20',
    privateClaimInstructions: 'SIMULATED: Show code at desk.',
  });
  assert.equal(pubRes.ok, true);
  if (!pubRes.ok) return;
  state = pubRes.state;
  assert.equal(pubRes.data.offer.subtotal, 28295);
  assert.equal(pubRes.data.offer.version, 1);

  // Buyer confirms v1 (1 of 8)
  const c1 = confirmOffer(state, 'pool-maverick-xlt', PERSONAS.buyer, 1);
  assert.equal(c1.ok, true);
  if (!c1.ok) return;
  state = c1.state;
  assert.equal(c1.data.unlockedNow, false);
  assert.equal(c1.data.metrics.confirmedUnits, 1);

  // Cannot access claim route before unlock
  const claimBefore = canAccessClaimRoute(c1.data.pool, 'buyer', PERSONAS.buyer.id, state.demoNow);
  assert.equal(claimBefore.allowed, false);

  // Repeat confirmation click is idempotent
  const repeatC1 = confirmOffer(state, 'pool-maverick-xlt', PERSONAS.buyer, 1);
  assert.equal(repeatC1.ok, true);
  if (!repeatC1.ok) return;
  assert.equal(repeatC1.data.metrics.confirmedUnits, 1);

  // Simulate remaining 7 confirmations
  for (let i = 0; i < 7; i++) {
    const sim = simulateAnotherConfirmation(state, 'pool-maverick-xlt');
    assert.equal(sim.ok, true);
    if (!sim.ok) return;
    state = sim.state;
    if (i === 6) {
      assert.equal(sim.data.unlockedNow, true);
      assert.equal(sim.data.metrics.effectiveStage, 'unlocked');
      assert.equal(sim.data.metrics.confirmedUnits, 8);
    }
  }

  // Confirmed and fulfilled are separate
  const unlockedPool = state.pools.find((p) => p.id === 'pool-maverick-xlt')!;
  const unlockedMetrics = computePoolMetrics(unlockedPool, state.demoNow);
  assert.equal(unlockedMetrics.confirmedUnits, 8);
  assert.equal(unlockedMetrics.fulfilledUnits, 0);

  // Cannot withdraw after unlock
  const withdrawAfter = withdrawConfirmation(state, 'pool-maverick-xlt', PERSONAS.buyer);
  assert.equal(withdrawAfter.ok, false);
  if (!withdrawAfter.ok) assert.equal(withdrawAfter.error.code, 'ALREADY_LOCKED');

  // Buyer can access claim and mark fulfilled
  const claimAfter = canAccessClaimRoute(unlockedPool, 'buyer', PERSONAS.buyer.id, state.demoNow);
  assert.equal(claimAfter.allowed, true);
  const fulfillRes = markBuyerFulfilled(state, 'pool-maverick-xlt', PERSONAS.buyer);
  assert.equal(fulfillRes.ok, true);
  if (!fulfillRes.ok) return;
  assert.equal(fulfillRes.data.metrics.fulfilledUnits, 1);
  assert.equal(fulfillRes.data.metrics.confirmedUnits, 8);
});

test('Reviewing 6/8 -> Buyer confirms -> 7/8 pending -> revision requires reconfirmation & rejects stale version', () => {
  let state = createSeedSession('test-4', 'reviewing-6-of-8');

  // Buyer confirms v1 -> 7 of 8
  const c1 = confirmOffer(state, 'pool-maverick-xlt', PERSONAS.buyer, 1);
  assert.equal(c1.ok, true);
  if (!c1.ok) return;
  state = c1.state;
  assert.equal(c1.data.metrics.confirmedUnits, 7);
  assert.equal(c1.data.metrics.remainingToMinimum, 1);

  // Can withdraw before unlock -> back to 6 of 8
  const w1 = withdrawConfirmation(state, 'pool-maverick-xlt', PERSONAS.buyer);
  assert.equal(w1.ok, true);
  if (!w1.ok) return;
  assert.equal(w1.data.metrics.confirmedUnits, 6);

  // Re-confirm v1 -> 7 of 8
  const c2 = confirmOffer(w1.state, 'pool-maverick-xlt', PERSONAS.buyer, 1);
  assert.equal(c2.ok, true);
  if (!c2.ok) return;
  state = c2.state;

  // Seller revises offer to v2
  const rev = simulateSellerTermRevision(state, 'pool-maverick-xlt', PERSONAS.seller);
  assert.equal(rev.ok, true);
  if (!rev.ok) return;
  state = rev.state;

  assert.equal(rev.data.offer.version, 2);
  assert.equal(rev.data.pool.offerHistory.length, 1);
  assert.equal(rev.data.pool.offerHistory[0].version, 1);
  const postRevMetrics = computePoolMetrics(rev.data.pool, state.demoNow);
  assert.equal(postRevMetrics.confirmedUnits, 0);

  // Confirming stale v1 is rejected
  const stale = confirmOffer(state, 'pool-maverick-xlt', PERSONAS.buyer, 1);
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.error.code, 'STALE_OFFER_VERSION');
    assert.equal(stale.error.currentVersion, 2);
  }

  // Confirming current v2 succeeds
  const fresh = confirmOffer(state, 'pool-maverick-xlt', PERSONAS.buyer, 2);
  assert.equal(fresh.ok, true);
  if (!fresh.ok) return;
  assert.equal(fresh.data.metrics.confirmedUnits, 1);
});

test('Missed deadline 7/8 expires cleanly, rejects late confirmations, and blocks claim access', () => {
  let state = createSeedSession('test-5', 'reviewing-6-of-8');
  const c1 = confirmOffer(state, 'pool-maverick-xlt', PERSONAS.buyer, 1);
  assert.equal(c1.ok, true);
  if (!c1.ok) return;
  state = c1.state;

  const adv = advanceClockPastDeadline(state, 'pool-maverick-xlt');
  assert.equal(adv.ok, true);
  if (!adv.ok) return;
  state = adv.state;

  assert.equal(adv.data.metrics.effectiveStage, 'expired');
  assert.equal(adv.data.metrics.confirmedUnits, 7);

  // Late confirmation rejected
  const late = confirmOffer(state, 'pool-maverick-xlt', PERSONAS.organizer, 1);
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.error.code, 'OFFER_EXPIRED');

  // Claim blocked
  const claim = canAccessClaimRoute(adv.data.pool, 'buyer', PERSONAS.buyer.id, state.demoNow);
  assert.equal(claim.allowed, false);
});

test('Privacy & role guards strip member contact details and protect organizer/seller/claim routes', () => {
  const session = createSeedSession('test-6', 'just-unlocked');
  const pool = session.pools.find((p) => p.id === 'pool-maverick-xlt')!;

  const buyerView = sanitizePoolForRole(pool, 'buyer', PERSONAS.buyer.id, session.demoNow);
  assert.equal(buyerView.sellerToken, undefined);
  assert.ok(buyerView.currentOffer!.privateClaimInstructions.length > 0);
  for (const m of buyerView.members) {
    assert.equal(m.privateEmail, undefined);
    assert.equal(m.privatePhone, undefined);
  }

  const sellerView = sanitizePoolForRole(pool, 'seller', PERSONAS.seller.id, session.demoNow);
  for (const m of sellerView.members) {
    assert.equal(m.privateEmail, undefined);
    assert.equal(m.privatePhone, undefined);
  }

  assert.equal(canAccessOrganizerRoute('organizer'), true);
  assert.equal(canAccessOrganizerRoute('buyer'), false);
  assert.equal(canAccessSellerRoute('seller'), true);
  assert.equal(canAccessSellerRoute('buyer'), false);
  assert.equal(canAccessClaimRoute(pool, 'seller', PERSONAS.seller.id, session.demoNow).allowed, false);
});

test('Creating a new pool validates input and publishes into session pools', () => {
  const session = createSeedSession('test-7', 'gathering-7-of-8');

  const bad = createPool(session, PERSONAS.buyer, {
    title: 'ab',
    category: 'Other',
    location: '',
    deliveryOrDestination: '',
    unitSingular: 'unit',
    unitPlural: 'units',
    minQuantity: 1,
    goalDate: 'invalid',
    organizerNote: '',
    sharedRequirements: [],
    categorySpecs: [],
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.error.code, 'VALIDATION_ERROR');
    assert.ok(bad.error.fieldErrors?.title);
  }

  const good = createPool(session, PERSONAS.buyer, {
    title: 'Neighborhood Cedar Raised Garden Beds',
    category: 'Other',
    location: 'Portland metro',
    deliveryOrDestination: 'SE Portland drop-off',
    unitSingular: 'bed',
    unitPlural: 'beds',
    minQuantity: 6,
    maxQuantity: 10,
    goalDate: '2026-12-28',
    organizerNote: 'Local lumber yard bulk cut.',
    sharedRequirements: ['4ft x 8ft western red cedar, 2in thick'],
    categorySpecs: [{ label: 'Unit', value: 'bed / beds' }],
  });
  assert.equal(good.ok, true);
  if (!good.ok) return;
  assert.equal(good.state.pools[0].title, 'Neighborhood Cedar Raised Garden Beds');
  assert.equal(good.state.pools[0].goalDate, '2026-12-28');
  assert.equal(formatCalendarDate(good.state.pools[0].goalDate), 'Dec 28');
  assert.equal(good.state.pools[0].members.length, 1);
});

test('Finding 1: Loading Ford Maverick scenarios preserves custom pools, unrelated pools, and custom activity', () => {
  let state = createSeedSession('test-8', 'gathering-7-of-8');

  const created = createPool(state, PERSONAS.buyer, {
    title: 'Synthetic Test Bench',
    category: 'Furniture',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland metro local delivery',
    unitSingular: 'furniture unit',
    unitPlural: 'furniture units',
    minQuantity: 2,
    maxQuantity: 6,
    goalDate: '2026-12-28',
    organizerNote: 'Regression fixture bench.',
    sharedRequirements: ['Solid maple top 60x30'],
    categorySpecs: [{ label: 'SKU', value: 'BENCH-60' }],
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  state = created.state;
  const customPoolId = created.data.pool.id;

  // Apply Ready for quote and Reviewing (6/8) Ford scenarios
  state = applyFordScenario(state, 'ready-for-quote');
  assert.ok(state.pools.some((p) => p.id === customPoolId && p.title === 'Synthetic Test Bench'));
  assert.ok(state.activity.some((ev) => ev.poolId === customPoolId && ev.kind === 'created'));
  const maverickReady = state.pools.find((p) => p.id === 'pool-maverick-xlt')!;
  assert.equal(computePoolMetrics(maverickReady, state.demoNow).effectiveStage, 'ready_for_quote');

  state = applyFordScenario(state, 'reviewing-6-of-8');
  assert.ok(state.pools.some((p) => p.id === customPoolId && p.title === 'Synthetic Test Bench'));
  assert.ok(state.activity.some((ev) => ev.poolId === customPoolId && ev.kind === 'created'));
  const maverickOffer = state.pools.find((p) => p.id === 'pool-maverick-xlt')!;
  assert.equal(computePoolMetrics(maverickOffer, state.demoNow).confirmedUnits, 6);
});

test('Finding 2: Calendar date-only values never lose a day across parsing and formatting', () => {
  assert.equal(normalizeCalendarDate('2026-12-28'), '2026-12-28');
  assert.equal(normalizeCalendarDate('2026-02-31'), null);
  assert.equal(formatCalendarDate('2026-12-28'), 'Dec 28');
  assert.equal(formatCalendarDate('2026-12-28', { includeYear: true }), 'Dec 28, 2026');
  assert.equal(formatCalendarDate('2027-01-22'), 'Jan 22');
  // Legacy midnight-UTC guard
  assert.equal(formatCalendarDate('2026-12-28T00:00:00.000Z'), 'Dec 28');
});

test('Finding 3: Buyer creator can manage and request quotes for their own pool without switching persona, while Ford organizer route stays restricted', () => {
  let state = createSeedSession('test-10', 'gathering-7-of-8');
  const created = createPool(state, PERSONAS.buyer, {
    title: 'Buyer Owned Workbench Pool',
    category: 'Furniture',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland metro pickup',
    unitSingular: 'bench',
    unitPlural: 'benches',
    minQuantity: 2,
    maxQuantity: 4,
    goalDate: '2026-12-28',
    organizerNote: 'Direct mill order.',
    sharedRequirements: ['Hard maple 72in top'],
    categorySpecs: [{ label: 'SKU', value: 'WB-72' }],
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  state = created.state;
  const customPool = created.data.pool;

  // Buyer owns custom pool but NOT Ford Maverick
  assert.equal(canManagePool(customPool, PERSONAS.buyer.id), true);
  const fordPool = state.pools.find((p) => p.id === 'pool-maverick-xlt')!;
  assert.equal(canManagePool(fordPool, PERSONAS.buyer.id), false);
  assert.equal(canManagePool(fordPool, PERSONAS.organizer.id), true);

  // Buyer can recalculate & post organizer update on own pool
  const recalc = recalculatePoolDemand(state, customPool.id, PERSONAS.buyer);
  assert.equal(recalc.ok, true);
  if (!recalc.ok) return;
  state = recalc.state;

  const updatePost = postDiscussionMessage(
    state,
    customPool.id,
    PERSONAS.buyer,
    'Reached out to local woodshop for quote.',
    true
  );
  assert.equal(updatePost.ok, true);
  if (!updatePost.ok) return;
  state = updatePost.state;

  // Another participant joins so eligible demand reaches min (2)
  const secondJoin = joinOrUpdatePool(state, customPool.id, PERSONAS.organizer, {
    quantity: 1,
    selectedOptions: { primary: 'Matches shared spec' },
  });
  assert.equal(secondJoin.ok, true);
  if (!secondJoin.ok) return;
  state = secondJoin.state;

  // Buyer creator can request seller quote directly and sees sellerToken in sanitized view
  const quoteReq = requestSellerQuote(state, customPool.id, PERSONAS.buyer);
  assert.equal(quoteReq.ok, true);
  if (!quoteReq.ok) return;
  state = quoteReq.state;
  assert.ok(quoteReq.data.sellerToken.length > 4);
  const sanitizedOwn = sanitizePoolForRole(
    quoteReq.data.pool,
    'buyer',
    PERSONAS.buyer.id,
    state.demoNow
  );
  assert.equal(sanitizedOwn.sellerToken, quoteReq.data.sellerToken);

  // Buyer is still blocked from Ford Maverick organizer actions
  const blockedFord = recalculatePoolDemand(state, 'pool-maverick-xlt', PERSONAS.buyer);
  assert.equal(blockedFord.ok, false);
  if (!blockedFord.ok) assert.equal(blockedFord.error.code, 'FORBIDDEN_ROLE');
});
