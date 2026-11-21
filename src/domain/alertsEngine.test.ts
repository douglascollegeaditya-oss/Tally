import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAlertEquivalenceKey,
  createItemAlert,
  dispatchAlertsForNewPool,
  doesAlertCriteriaMatchPool,
  getViewerAlertsAndInbox,
  markAllNotificationsRead,
  markNotificationRead,
  migrateSessionState,
  updateItemAlert,
} from './alertsEngine.ts';
import { createSeedSession, MAVERICK_OFFER_CLOSE_ISO, PERSONAS } from './seedData.ts';
import {
  advanceClockPastDeadline,
  applyFordScenario,
  confirmOffer,
  createPool,
  publishOrReviseSellerOffer,
  requestSellerQuote,
} from './tallyEngine.ts';
import type { CreatePoolInput, DemoSessionState, Pool } from './types.ts';

function makePoolInput(overrides: Partial<CreatePoolInput> = {}): CreatePoolInput {
  return {
    title: '2026 Toyota RAV4 Hybrid XLE',
    subtitle: 'Clean local fleet pricing with zero dealer add-ons',
    category: 'Vehicles',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland metro pickup',
    unitSingular: 'vehicle',
    unitPlural: 'vehicles',
    minQuantity: 5,
    maxQuantity: 8,
    goalDate: '2026-12-28',
    organizerNote: 'Direct fleet desk quote in Portland.',
    sharedRequirements: ['Standard factory build'],
    categorySpecs: [{ label: 'Model', value: 'RAV4 Hybrid' }],
    primaryOptionLabel: 'Trim',
    primaryOptionValues: ['XLE AWD'],
    ...overrides,
  };
}

test('Matching: item query handles casing, extra whitespace, whole-word boundaries, structured options, and avoids descriptions', () => {
  const session = createSeedSession('alerts-match-1', 'gathering-7-of-8');
  const maverick = session.pools.find((p) => p.id === 'pool-maverick-xlt')!;

  // Case-insensitive + extra whitespace + reordered terms
  assert.equal(
    doesAlertCriteriaMatchPool({ query: '   xlt    MAVERICK  ', category: 'Vehicles' }, maverick),
    true
  );

  // Whole-word boundary check: XLT must NOT match EXLT or XLTS as arbitrary substrings
  const exltPool: Pool = {
    ...maverick,
    id: 'pool-exlt',
    title: '2026 Ford Maverick EXLT Custom',
    optionGroups: [
      {
        id: 'trim',
        label: 'Trim',
        required: true,
        allowedValues: ['XLTS Package'],
        allValues: ['XLTS Package'],
      },
    ],
  };
  assert.equal(doesAlertCriteriaMatchPool({ query: 'XLT' }, exltPool), false);
  assert.equal(doesAlertCriteriaMatchPool({ query: 'EXLT' }, exltPool), true);

  // Structured item options match (e.g. allowedValues contains "Cactus Gray" even though not in title)
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'maverick cactus' }, maverick),
    true
  );

  // Excluded option values (in allValues only) must NOT match
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'maverick lariat' }, maverick),
    false
  );

  // Description-only words (subtitle / organizerNote / sharedRequirements) must NOT match
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'VIN etching' }, maverick),
    false
  );
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'add-ons' }, maverick),
    false
  );
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'uniform baseline' }, maverick),
    false
  );

  // All query terms must match (partial term overlap fails)
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Ford Bronco' }, maverick),
    false
  );
});

test('Matching: optional category is exact and optional city is whole-word against explicit pool location', () => {
  const session = createSeedSession('alerts-match-2', 'gathering-7-of-8');
  const maverick = session.pools.find((p) => p.id === 'pool-maverick-xlt')!;
  const hotel = session.pools.find((p) => p.id === 'pool-hood-hotel')!;
  const evSea = session.pools.find((p) => p.id === 'pool-ev-charger-sea')!;

  // Exact category
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Maverick XLT', category: 'Vehicles' }, maverick),
    true
  );
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Maverick XLT', category: 'Furniture' }, maverick),
    false
  );
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Maverick XLT' }, maverick),
    true
  );

  // City whole-word matching: Portland matches Portland metro, NOT Portlandia, and Port does NOT match Portland metro
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Maverick', city: 'Portland' }, maverick),
    true
  );
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Maverick', city: '  portland  ' }, maverick),
    true
  );
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Maverick', city: 'Port' }, maverick),
    false
  );
  const portlandiaPool: Pool = { ...maverick, location: 'Portlandia' };
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Maverick', city: 'Portland' }, portlandiaPool),
    false
  );
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Maverick', city: 'Seattle' }, maverick),
    false
  );

  // Multi-word city phrase
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Timberline Lodge', city: 'Hood River' }, hotel),
    true
  );
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'Timberline Lodge', city: 'River Hood' }, hotel),
    false
  );

  // Empty city means any city
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'EV Charger', city: '' }, evSea),
    true
  );
  assert.equal(
    doesAlertCriteriaMatchPool({ query: 'EV Charger' }, evSea),
    true
  );
});

test('Duplicate active alert prevention blocks equivalent active searches while allowing paused/archived duplicates to stay safe', () => {
  let state = createSeedSession('alerts-dup-1', 'gathering-7-of-8');

  const first = createItemAlert(state, PERSONAS.buyer, {
    query: 'Ford Maverick XLT',
    category: 'Vehicles',
    city: 'Portland',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  state = first.state;

  // Equivalent with different casing, spacing, and term order -> rejected
  assert.equal(
    computeAlertEquivalenceKey('Ford Maverick XLT', 'Vehicles', 'Portland'),
    computeAlertEquivalenceKey('  xlt   ford   maverick ', 'Vehicles', ' portland ')
  );
  const dup = createItemAlert(state, PERSONAS.buyer, {
    query: '  xlt   ford   maverick ',
    category: 'Vehicles',
    city: ' portland ',
  });
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.error.code, 'DUPLICATE_ALERT');

  // Different city or category is allowed
  const diffCity = createItemAlert(state, PERSONAS.buyer, {
    query: 'Ford Maverick XLT',
    category: 'Vehicles',
    city: 'Seattle',
  });
  assert.equal(diffCity.ok, true);
  if (!diffCity.ok) return;
  state = diffCity.state;

  // Pause first alert -> now creating an equivalent active alert is allowed
  const paused = updateItemAlert(state, first.data.alert.id, PERSONAS.buyer, {
    status: 'paused',
  });
  assert.equal(paused.ok, true);
  if (!paused.ok) return;
  state = paused.state;

  const replacement = createItemAlert(state, PERSONAS.buyer, {
    query: 'Ford Maverick XLT',
    category: 'Vehicles',
    city: 'Portland',
  });
  assert.equal(replacement.ok, true);
  if (!replacement.ok) return;
  state = replacement.state;

  // Attempting to resume the older paused duplicate is blocked while replacement is active
  const blockedResume = updateItemAlert(state, first.data.alert.id, PERSONAS.buyer, {
    status: 'active',
  });
  assert.equal(blockedResume.ok, false);
  if (!blockedResume.ok) assert.equal(blockedResume.error.code, 'DUPLICATE_ALERT');
});

test('Prospectivity: no backfill on create/edit/pause/resume/archive/restore, and quote/stage/fixture changes do not notify', () => {
  let state = createSeedSession('alerts-prosp-1', 'ready-for-quote');

  // 1. Creating an alert matching an already-open seed pool ("Ford Maverick XLT" in Portland) must NOT backfill
  const a1 = createItemAlert(state, PERSONAS.buyer, {
    query: 'Ford Maverick XLT',
    category: 'Vehicles',
    city: 'Portland',
  });
  assert.equal(a1.ok, true);
  if (!a1.ok) return;
  state = a1.state;
  assert.equal(getViewerAlertsAndInbox(state, PERSONAS.buyer.id).notifications.length, 0);

  // 2. Quote request, offer publish, confirmation, deadline expiration, and fixture loads must NOT generate notifications
  const reqRes = requestSellerQuote(state, 'pool-maverick-xlt', PERSONAS.organizer);
  assert.equal(reqRes.ok, true);
  if (!reqRes.ok) return;
  state = reqRes.state;

  const offerRes = publishOrReviseSellerOffer(state, reqRes.data.sellerToken, PERSONAS.seller, {
    sellerName: 'Alder Motor Co.',
    sellerLocation: 'Portland, OR',
    matchingScope: '2026 Ford Maverick XLT Hybrid AWD',
    currency: 'USD',
    unitPrice: 27900,
    knownFees: 395,
    feeLabel: 'Doc fee',
    taxAndRegistrationNote: 'Excludes tax',
    minQuantity: 8,
    maxQuantity: 8,
    fulfillmentMethod: 'Local pickup',
    closeAt: MAVERICK_OFFER_CLOSE_ISO,
    timezoneLabel: 'Pacific',
    claimByDate: '2026-12-20',
    privateClaimInstructions: 'Demo instructions',
  });
  assert.equal(offerRes.ok, true);
  if (!offerRes.ok) return;
  state = offerRes.state;

  const confRes = confirmOffer(state, 'pool-maverick-xlt', PERSONAS.buyer, 1);
  assert.equal(confRes.ok, true);
  if (!confRes.ok) return;
  state = confRes.state;

  const expRes = advanceClockPastDeadline(state, 'pool-maverick-xlt');
  assert.equal(expRes.ok, true);
  if (!expRes.ok) return;
  state = expRes.state;

  state = applyFordScenario(state, 'gathering-7-of-8');
  assert.equal(getViewerAlertsAndInbox(state, PERSONAS.buyer.id).notifications.length, 0);

  // 3. Pause alert -> new matching pool opens while paused -> NO notification
  const pauseRes = updateItemAlert(state, a1.data.alert.id, PERSONAS.buyer, { status: 'paused' });
  assert.equal(pauseRes.ok, true);
  if (!pauseRes.ok) return;
  state = pauseRes.state;

  const whilePaused = createPool(
    state,
    PERSONAS.organizer,
    makePoolInput({
      title: '2027 Ford Maverick XLT Hybrid',
      category: 'Vehicles',
      location: 'Portland metro',
    })
  );
  assert.equal(whilePaused.ok, true);
  if (!whilePaused.ok) return;
  state = whilePaused.state;
  assert.equal(getViewerAlertsAndInbox(state, PERSONAS.buyer.id).notifications.length, 0);

  // 4. Resume alert -> still NO backfill for pool opened while paused
  const resumeRes = updateItemAlert(state, a1.data.alert.id, PERSONAS.buyer, { status: 'active' });
  assert.equal(resumeRes.ok, true);
  if (!resumeRes.ok) return;
  state = resumeRes.state;
  assert.equal(getViewerAlertsAndInbox(state, PERSONAS.buyer.id).notifications.length, 0);

  // 5. Pool opened AFTER resume DOES generate 1 notification
  const afterResume = createPool(
    state,
    PERSONAS.organizer,
    makePoolInput({
      title: '2027 Ford Maverick XLT AWD Fleet Group',
      category: 'Vehicles',
      location: 'Portland, OR',
    })
  );
  assert.equal(afterResume.ok, true);
  if (!afterResume.ok) return;
  state = afterResume.state;
  const inboxAfter = getViewerAlertsAndInbox(state, PERSONAS.buyer.id);
  assert.equal(inboxAfter.notifications.length, 1);
  assert.equal(inboxAfter.unreadAlertCount, 1);
  assert.equal(inboxAfter.notifications[0].poolId, afterResume.data.pool.id);

  // 6. Edit alert to match already-open Walnut Dining Table -> NO backfill, and historical notification stays intact
  const editRes = updateItemAlert(state, a1.data.alert.id, PERSONAS.buyer, {
    query: 'Walnut Dining Table',
    category: 'Furniture',
    city: null,
  });
  assert.equal(editRes.ok, true);
  if (!editRes.ok) return;
  state = editRes.state;
  const inboxAfterEdit = getViewerAlertsAndInbox(state, PERSONAS.buyer.id);
  assert.equal(inboxAfterEdit.notifications.length, 1);
  assert.equal(inboxAfterEdit.notifications[0].poolId, afterResume.data.pool.id);
  assert.ok(inboxAfterEdit.notifications[0].matchedAlertSummary.includes('Ford Maverick XLT'));

  // 7. Archive alert -> historical inbox item stays intact, new matching pools do not notify
  const archRes = updateItemAlert(state, a1.data.alert.id, PERSONAS.buyer, { status: 'archived' });
  assert.equal(archRes.ok, true);
  if (!archRes.ok) return;
  state = archRes.state;

  const afterArchive = createPool(
    state,
    PERSONAS.organizer,
    makePoolInput({
      title: 'Handmade Walnut Dining Table Group',
      category: 'Furniture',
      location: 'Portland metro',
    })
  );
  assert.equal(afterArchive.ok, true);
  if (!afterArchive.ok) return;
  state = afterArchive.state;
  assert.equal(getViewerAlertsAndInbox(state, PERSONAS.buyer.id).notifications.length, 1);
});

test('Overlap deduplication, retried createPool idempotency, and self-created pool exclusion', () => {
  let state = createSeedSession('alerts-dedup-1', 'gathering-7-of-8');

  // Buyer creates two overlapping active alerts (non-equivalent criteria, both will match the same pool)
  const broadAlert = createItemAlert(state, PERSONAS.buyer, {
    query: 'Espresso Grinder',
    category: 'Other',
  });
  assert.equal(broadAlert.ok, true);
  if (!broadAlert.ok) return;
  state = broadAlert.state;

  const narrowAlert = createItemAlert(state, PERSONAS.buyer, {
    query: 'Niche Espresso Grinder',
    city: 'Portland',
  });
  assert.equal(narrowAlert.ok, true);
  if (!narrowAlert.ok) return;
  state = narrowAlert.state;

  // Buyer creates a matching pool herself -> self-exclusion: 0 notifications for Buyer
  const selfPool = createPool(
    state,
    PERSONAS.buyer,
    makePoolInput({
      title: 'Niche Zero Espresso Grinder Buy',
      category: 'Other',
      location: 'Portland metro',
      unitSingular: 'grinder',
      unitPlural: 'grinders',
    })
  );
  assert.equal(selfPool.ok, true);
  if (!selfPool.ok) return;
  state = selfPool.state;
  assert.equal(getViewerAlertsAndInbox(state, PERSONAS.buyer.id).notifications.length, 0);

  // Organizer creates a matching pool with a clientRequestId -> Buyer gets strictly ONE notification
  const orgInput = makePoolInput({
    clientRequestId: 'req-grinder-001',
    title: 'Niche Duo Espresso Grinder Cohort',
    category: 'Other',
    location: 'Portland metro',
    unitSingular: 'grinder',
    unitPlural: 'grinders',
  });
  const orgPool1 = createPool(state, PERSONAS.organizer, orgInput);
  assert.equal(orgPool1.ok, true);
  if (!orgPool1.ok) return;
  state = orgPool1.state;

  // Retry the exact same request -> deduplicated, still 1 pool and 1 notification
  const orgPoolRetry = createPool(state, PERSONAS.organizer, orgInput);
  assert.equal(orgPoolRetry.ok, true);
  if (!orgPoolRetry.ok) return;
  assert.equal(orgPoolRetry.data.deduplicated, true);
  assert.equal(orgPoolRetry.data.pool.id, orgPool1.data.pool.id);
  state = orgPoolRetry.state;

  // Even a direct repeated dispatch call for the same pool will not duplicate
  const dupDispatch = dispatchAlertsForNewPool(state, orgPool1.data.pool, PERSONAS.organizer.id);
  assert.equal(dupDispatch.length, 0);

  const buyerInbox = getViewerAlertsAndInbox(state, PERSONAS.buyer.id);
  assert.equal(buyerInbox.notifications.length, 1);
  assert.equal(buyerInbox.notifications[0].matchedAlertIds.length, 2);
  assert.ok(buyerInbox.notifications[0].matchedAlertSummary.includes('+1 more alert'));
});

test('Read state persistence, owner authorization, session isolation, and legacy snapshot migration', () => {
  // Legacy snapshot without alerts/notifications arrays
  const baseSeed = createSeedSession('legacy-sess', 'gathering-7-of-8');
  const legacyRaw = {
    sessionId: baseSeed.sessionId,
    scenarioId: baseSeed.scenarioId,
    demoNow: baseSeed.demoNow,
    pools: baseSeed.pools,
    activity: baseSeed.activity,
    createdAt: baseSeed.createdAt,
    updatedAt: baseSeed.updatedAt,
  };
  const migrated = migrateSessionState(legacyRaw);
  assert.equal(Array.isArray(migrated.alerts), true);
  assert.equal(Array.isArray(migrated.notifications), true);
  assert.equal(migrated.pools.length, baseSeed.pools.length);

  // Two isolated sessions
  let sessionA = migrated;
  const sessionB = createSeedSession('other-sess', 'gathering-7-of-8');

  // Buyer creates alert in sessionA
  const alertRes = createItemAlert(sessionA, PERSONAS.buyer, {
    query: 'Standing Desk',
    category: 'Furniture',
    city: 'Portland',
  });
  assert.equal(alertRes.ok, true);
  if (!alertRes.ok) return;
  sessionA = alertRes.state;

  // Organizer cannot edit or archive Buyer's alert
  const forbiddenEdit = updateItemAlert(sessionA, alertRes.data.alert.id, PERSONAS.organizer, {
    status: 'paused',
  });
  assert.equal(forbiddenEdit.ok, false);
  if (!forbiddenEdit.ok) assert.equal(forbiddenEdit.error.code, 'FORBIDDEN_ROLE');

  // Organizer opens matching pool in sessionA
  const poolRes = createPool(
    sessionA,
    PERSONAS.organizer,
    makePoolInput({
      title: 'Uplift V2 Standing Desk Group Buy',
      category: 'Furniture',
      location: 'Portland metro',
      unitSingular: 'desk',
      unitPlural: 'desks',
    })
  );
  assert.equal(poolRes.ok, true);
  if (!poolRes.ok) return;
  sessionA = poolRes.state;

  // Buyer has 1 unread notification in sessionA; Organizer & Seller have 0; sessionB has 0
  assert.equal(getViewerAlertsAndInbox(sessionA, PERSONAS.buyer.id).unreadAlertCount, 1);
  assert.equal(getViewerAlertsAndInbox(sessionA, PERSONAS.organizer.id).unreadAlertCount, 0);
  assert.equal(getViewerAlertsAndInbox(sessionA, PERSONAS.seller.id).unreadAlertCount, 0);
  assert.equal(getViewerAlertsAndInbox(sessionB, PERSONAS.buyer.id).unreadAlertCount, 0);

  const notifId = getViewerAlertsAndInbox(sessionA, PERSONAS.buyer.id).notifications[0].id;

  // Organizer cannot mark Buyer's notification read
  const forbiddenRead = markNotificationRead(sessionA, notifId, PERSONAS.organizer);
  assert.equal(forbiddenRead.ok, false);
  if (!forbiddenRead.ok) assert.equal(forbiddenRead.error.code, 'FORBIDDEN_ROLE');

  // Buyer marks notification read -> persists across JSON round-trip
  const readRes = markNotificationRead(sessionA, notifId, PERSONAS.buyer);
  assert.equal(readRes.ok, true);
  if (!readRes.ok) return;
  sessionA = readRes.state;

  const reloaded = migrateSessionState(JSON.parse(JSON.stringify(sessionA)) as DemoSessionState);
  const reloadedInbox = getViewerAlertsAndInbox(reloaded, PERSONAS.buyer.id);
  assert.equal(reloadedInbox.unreadAlertCount, 0);
  assert.equal(reloadedInbox.notifications.length, 1);
  assert.ok(Boolean(reloadedInbox.notifications[0].readAt));

  // Mark all read on already-read inbox is idempotent (0 newly marked)
  const markAll = markAllNotificationsRead(reloaded, PERSONAS.buyer);
  assert.equal(markAll.ok, true);
  if (markAll.ok) assert.equal(markAll.data.markedCount, 0);
});
