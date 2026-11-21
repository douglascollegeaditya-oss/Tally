import assert from 'node:assert/strict';
import test from 'node:test';
import { createItemAlert } from './alertsEngine.ts';
import {
  buildQueryFromPool,
  findCompetingPoolCounts,
  findSimilarPoolsInSession,
} from './competingPoolsEngine.ts';
import { createSeedSession, PERSONAS } from './seedData.ts';
import { createPool } from './tallyEngine.ts';

test('same-item matching surfaces credible match with explainable reasons and normalized terms', () => {
  const state = createSeedSession('test-similar-1', 'gathering-7-of-8');

  const matches = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: '  2026 ford maverick hybrid xlt  ',
    location: 'Portland metro',
    goalDate: '2026-12-16',
    modelOrVariant: 'Hybrid AWD XLT',
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].pool.id, 'pool-maverick-xlt');
  assert.equal(matches[0].matchLevel, 'strong_match');
  assert.equal(matches[0].locationFit, 'match');
  assert.equal(matches[0].timingFit, 'close');
  assert.equal(matches[0].availability, 'joinable');
  assert.equal(matches[0].canQuickJoin, true);
  assert.equal(matches[0].quoteSummary.hasQuote, false);
  assert.equal(matches[0].quoteSummary.statusLabel, 'No quote published yet');
  assert.ok(matches[0].matchedTerms.includes('maverick'));
  assert.ok(matches[0].matchedTerms.includes('xlt'));
  assert.ok(matches[0].matchReasons.length >= 2);
});

test('category mismatch acts as an eligibility gate', () => {
  const state = createSeedSession('test-similar-cat', 'gathering-7-of-8');

  const wrongCat = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Furniture',
    title: '2026 Ford Maverick Hybrid XLT',
    location: 'Portland metro',
  });

  assert.equal(wrongCat.length, 0);
});

test('incompatible model, trim, powertrain, drivetrain, unit size, and SKU are gated out', () => {
  const state = createSeedSession('test-similar-variants', 'gathering-7-of-8');

  // Excluded powertrain (EcoBoost) on Maverick Hybrid pool
  const ecoBoost = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: '2026 Ford Maverick EcoBoost XLT',
    location: 'Portland metro',
  });
  assert.equal(ecoBoost.length, 0);

  // Conflicting trim (Lariat vs XLT)
  const lariat = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: '2026 Ford Maverick Hybrid Lariat',
    location: 'Portland metro',
  });
  assert.equal(lariat.length, 0);

  // Conflicting drivetrain (FWD vs AWD on pool-maverick-xlt)
  const fwd = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: '2026 Ford Maverick Hybrid XLT FWD',
    location: 'Portland metro',
  });
  assert.equal(fwd.length, 0);

  // Conflicting apartment unit size (Studio vs 1 Bedroom / 2 Bedroom allowed in Pearl Lofts)
  const studio = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Apartments',
    title: 'Pearl District Modern Lofts Lease Cohort',
    location: 'Portland metro',
    modelOrVariant: 'Studio',
  });
  assert.equal(studio.length, 0);

  // Conflicting explicit furniture SKU (SKU-OAK-84 vs WW-DT90)
  const wrongSku = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Furniture',
    title: 'Solid Walnut 8-Seat Dining Table',
    location: 'Portland metro',
    modelOrVariant: 'SKU-OAK-84',
    categorySpecs: [{ label: 'SKU / Model', value: 'SKU-OAK-84' }],
  });
  assert.equal(wrongSku.length, 0);

  // Matching SKU (WW-DT90) with "8-seat" hyphenated phrase STILL matches (8-seat is not misread as SKU)
  const rightSku = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Furniture',
    title: 'Solid Walnut 8-Seat Dining Table',
    location: 'Portland metro',
    modelOrVariant: 'WW-DT90',
    categorySpecs: [{ label: 'SKU / Model', value: 'WW-DT90' }],
  });
  assert.equal(rightSku.length, 1);
  assert.equal(rightSku[0].pool.id, 'pool-walnut-dining');
});

test('whole-word boundary matching rejects substring matches for items and cities', () => {
  const state = createSeedSession('test-similar-bounds', 'gathering-7-of-8');

  // Substring item term EXLT must not match XLT
  const badTrim = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: 'EXLT',
  });
  assert.equal(badTrim.length, 0);

  // Substring city "Portlandia" must not be treated as a Portland location match
  const partialCity = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: '2026 Ford Maverick Hybrid XLT AWD',
    location: 'Portlandia',
    goalDate: '2026-12-16',
  });
  assert.equal(partialCity.length, 1);
  assert.equal(partialCity[0].locationFit, 'different');
  assert.equal(partialCity[0].matchLevel, 'same_item_different_terms');
  assert.ok(partialCity[0].differences.some((d) => /Location differs/i.test(d)));
});

test('description-only text and generic vague words never trigger false matches', () => {
  const state = createSeedSession('test-similar-desc', 'gathering-7-of-8');

  // "VIN etching" appears only in sharedRequirements, not item title or options
  const descOnly = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: 'VIN etching nitrogen tires',
  });
  assert.equal(descOnly.length, 0);

  // Purely generic boilerplate words
  const genericNoise = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    title: '2026 Local Neighborhood Group Buy Pool',
  });
  assert.equal(genericNoise.length, 0);
});

test('uncertain or broad matches are labeled possible_match rather than strong_match', () => {
  const state = createSeedSession('test-similar-possible', 'gathering-7-of-8');

  // Single broad token without trim/model specifics
  const broad = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: 'Maverick',
    location: 'Portland metro',
  });
  assert.equal(broad.length, 1);
  assert.equal(broad[0].matchLevel, 'possible_match');
  assert.match(broad[0].matchLabel, /Possible match/i);

  // Model year mismatch (2025 vs 2026)
  const wrongYear = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: '2025 Ford Maverick Hybrid XLT AWD',
    location: 'Portland metro',
    goalDate: '2026-12-16',
  });
  assert.equal(wrongYear.length, 1);
  assert.equal(wrongYear[0].matchLevel, 'possible_match');
  assert.ok(wrongYear[0].differences.some((d) => d.includes('Model year differs')));
});

test('location and timing rank candidates deterministically and downgrade distant or badly timed pools', () => {
  let state = createSeedSession('test-similar-rank', 'gathering-7-of-8');

  // Create a distant Seattle Maverick pool with a far-out timing window
  const distantRes = createPool(state, PERSONAS.organizer, {
    title: '2026 Ford Maverick XLT Hybrid AWD',
    category: 'Vehicles',
    location: 'Seattle metro',
    deliveryOrDestination: 'Seattle dealership pickup',
    unitSingular: 'vehicle',
    unitPlural: 'vehicles',
    minQuantity: 6,
    maxQuantity: 10,
    goalDate: '2027-03-15',
    organizerNote: 'Seattle group buy',
    sharedRequirements: ['XLT Hybrid AWD only'],
    categorySpecs: [
      { label: 'Model', value: '2026 Ford Maverick Hybrid' },
      { label: 'Trim', value: 'XLT Hybrid AWD' },
    ],
    primaryOptionLabel: 'Trim',
    primaryOptionValues: ['XLT Hybrid AWD'],
  });
  assert.equal(distantRes.ok, true);
  state = distantRes.state;

  const ranked = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: '2026 Ford Maverick XLT Hybrid AWD',
    location: 'Portland metro',
    goalDate: '2026-12-16',
  });

  assert.equal(ranked.length, 2);
  // Local + close timing ranks #1 as strong_match
  assert.equal(ranked[0].pool.id, 'pool-maverick-xlt');
  assert.equal(ranked[0].matchLevel, 'strong_match');
  assert.equal(ranked[0].locationFit, 'match');
  assert.equal(ranked[0].timingFit, 'close');

  // Distant Seattle + 89 days later ranks #2 as same_item_different_terms (never strong_match)
  assert.equal(ranked[1].pool.location, 'Seattle metro');
  assert.equal(ranked[1].matchLevel, 'same_item_different_terms');
  assert.equal(ranked[1].locationFit, 'different');
  assert.equal(ranked[1].timingFit, 'far');
  assert.ok(ranked[1].differences.some((d) => /Location differs/i.test(d)));
  assert.ok(ranked[1].differences.some((d) => /Target timing differs/i.test(d)));
});

test('distinguishes interested vs confirmed progress and displays published seller quotes honestly', () => {
  const offerState = createSeedSession('test-similar-quote', 'reviewing-6-of-8');

  const matches = findSimilarPoolsInSession(offerState, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: '2026 Ford Maverick XLT Hybrid AWD',
    location: 'Portland metro',
    goalDate: '2026-12-20',
  });

  assert.equal(matches.length, 1);
  const candidate = matches[0];
  assert.equal(candidate.pool.metrics.effectiveStage, 'offer_open');
  assert.equal(candidate.availability, 'offer_review_only');
  assert.equal(candidate.canQuickJoin, false);
  // Distinguishes confirmed vs interested units
  assert.equal(candidate.pool.metrics.confirmedUnits, 6);
  assert.ok(candidate.pool.metrics.eligibleInterestedUnits >= 8);
  // Real published quote data preserved without invented savings
  assert.equal(candidate.quoteSummary.hasQuote, true);
  assert.equal(candidate.quoteSummary.version, 1);
  assert.equal(candidate.quoteSummary.sellerName, 'Alder Motor Co.');
  assert.equal(candidate.quoteSummary.unitPrice, 27900);
  assert.equal(candidate.quoteSummary.knownFees, 395);
  assert.equal(candidate.quoteSummary.subtotal, 28295);
  assert.ok(candidate.quoteSummary.matchingScope?.includes('XLT'));
});

test('ended and unlocked pools are labeled honestly and ranked below open pools', () => {
  let state = createSeedSession('test-similar-unavailable', 'gathering-7-of-8');

  // Closed past cohort in seedData: pool-heatpump-pdx ("Ductless Mini-Split Heat Pump Group Install")
  const closedOnly = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Other',
    title: 'Ductless Mini-Split Heat Pump',
    location: 'Portland metro',
  });
  assert.equal(closedOnly.length, 1);
  assert.equal(closedOnly[0].pool.id, 'pool-heatpump-pdx');
  assert.equal(closedOnly[0].availability, 'ended');
  assert.equal(closedOnly[0].canQuickJoin, false);
  assert.match(closedOnly[0].matchLabel, /no longer open/i);
  assert.ok(closedOnly[0].differences.some((d) => /no longer accepting/i.test(d)));

  // Now create a fresh open pool for the same Heat Pump — open pool must rank ahead of closed cohort
  const openRes = createPool(state, PERSONAS.organizer, {
    title: 'Ductless Mini-Split Heat Pump Winter Cohort',
    category: 'Other',
    location: 'Portland metro',
    deliveryOrDestination: 'Eastside Portland installation',
    unitSingular: 'home',
    unitPlural: 'homes',
    minQuantity: 8,
    maxQuantity: 15,
    goalDate: '2027-01-15',
    organizerNote: 'Second wave cohort',
    sharedRequirements: ['18,000 BTU cold-climate mini-split'],
    categorySpecs: [{ label: 'Unit label', value: 'home / homes' }],
    primaryOptionLabel: 'Mount style',
    primaryOptionValues: ['Standard wall mount'],
  });
  assert.equal(openRes.ok, true);
  state = openRes.state;

  const both = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Other',
    title: 'Ductless Mini-Split Heat Pump',
    location: 'Portland metro',
  });
  assert.equal(both.length, 2);
  assert.equal(both[0].availability, 'joinable');
  assert.equal(both[1].pool.id, 'pool-heatpump-pdx');
  assert.equal(both[1].availability, 'ended');
});

test('no-match behavior returns empty array for genuinely distinct items', () => {
  const state = createSeedSession('test-similar-none', 'gathering-7-of-8');

  const none = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Furniture',
    title: 'Herman Miller Aeron Ergonomic Office Chair',
    location: 'Portland metro',
    goalDate: '2027-01-10',
  });
  assert.equal(none.length, 0);
});

test('separate-pool override succeeds after strong match, preserves alerts, and enables mutual comparison', () => {
  let state = createSeedSession('test-similar-override', 'gathering-7-of-8');

  // Buyer Maya has an active saved alert for Maverick
  const alertRes = createItemAlert(state, PERSONAS.buyer, {
    query: 'Ford Maverick XLT',
    category: 'Vehicles',
    city: 'Portland',
  });
  assert.equal(alertRes.ok, true);
  state = alertRes.state;

  // Organizer Devon checks for similar pools -> finds existing pool-maverick-xlt
  const preCheck = findSimilarPoolsInSession(state, 'organizer', PERSONAS.organizer.id, {
    category: 'Vehicles',
    title: '2026 Ford Maverick XLT Hybrid AWD Spring Delivery',
    location: 'Portland metro',
    goalDate: '2027-02-01',
  });
  assert.equal(preCheck.length, 1);
  assert.equal(preCheck[0].pool.id, 'pool-maverick-xlt');

  // Organizer explicitly proceeds to create a separate pool anyway (not hard-blocked)
  const createRes = createPool(state, PERSONAS.organizer, {
    title: '2026 Ford Maverick XLT Hybrid AWD Spring Delivery',
    category: 'Vehicles',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland pickup',
    unitSingular: 'vehicle',
    unitPlural: 'vehicles',
    minQuantity: 6,
    maxQuantity: 10,
    goalDate: '2027-02-01',
    organizerNote: 'Spring delivery window for buyers who cannot buy in December.',
    sharedRequirements: ['2026 Maverick XLT Hybrid AWD'],
    categorySpecs: [
      { label: 'Model', value: '2026 Ford Maverick Hybrid' },
      { label: 'Trim', value: 'XLT Hybrid AWD' },
    ],
    primaryOptionLabel: 'Trim',
    primaryOptionValues: ['XLT Hybrid AWD'],
  });
  assert.equal(createRes.ok, true);
  state = createRes.state;

  // Saved item alert still dispatched to Maya on the real creation path
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].ownerId, PERSONAS.buyer.id);
  assert.equal(state.notifications[0].poolId, createRes.data.pool.id);

  // Both Maverick pools now detect each other as competing pools
  const counts = findCompetingPoolCounts(state.pools, state.demoNow);
  assert.equal(counts['pool-maverick-xlt'], 1);
  assert.equal(counts[createRes.data.pool.id], 1);

  const comparedFromOriginal = findSimilarPoolsInSession(
    state,
    'buyer',
    PERSONAS.buyer.id,
    buildQueryFromPool(state.pools.find((p) => p.id === 'pool-maverick-xlt')!)
  );
  assert.equal(comparedFromOriginal.length, 1);
  assert.equal(comparedFromOriginal[0].pool.id, createRes.data.pool.id);
});

test('matching respects session isolation and strips private fields per viewer role', () => {
  const sessionA = createSeedSession('session-a', 'just-unlocked');
  const sessionB = createSeedSession('session-b', 'gathering-7-of-8');

  // Create a custom pool only in session B
  const createdB = createPool(sessionB, PERSONAS.organizer, {
    title: 'Bambu Lab X1C 3D Printer Group Buy',
    category: 'Other',
    location: 'Portland metro',
    deliveryOrDestination: 'Local warehouse pickup',
    unitSingular: 'printer',
    unitPlural: 'printers',
    minQuantity: 5,
    maxQuantity: 10,
    goalDate: '2027-01-20',
    organizerNote: 'Batch order',
    sharedRequirements: ['X1C Combo unit'],
    categorySpecs: [{ label: 'Model', value: 'Bambu Lab X1C' }],
    primaryOptionLabel: 'Model',
    primaryOptionValues: ['Bambu Lab X1C Combo'],
  });
  assert.equal(createdB.ok, true);

  // Session A cannot see Session B's pool
  const crossCheck = findSimilarPoolsInSession(sessionA, 'buyer', 'buyer-maya', {
    category: 'Other',
    title: 'Bambu Lab X1C 3D Printer',
  });
  assert.equal(crossCheck.length, 0);

  // Unlocked pool in Session A strips private fields for an unconfirmed stranger viewer
  const sanitized = findSimilarPoolsInSession(sessionA, 'buyer', 'buyer-stranger', {
    category: 'Vehicles',
    title: '2026 Ford Maverick XLT Hybrid AWD',
    location: 'Portland metro',
  });
  assert.equal(sanitized.length, 1);
  const returnedPool = sanitized[0].pool;
  assert.equal(returnedPool.sellerToken, undefined);
  assert.equal(returnedPool.currentOffer?.privateClaimInstructions, '');
  assert.equal(returnedPool.currentOffer?.privateReferencePrefix, '');
  for (const m of returnedPool.members) {
    assert.equal(m.privateEmail, undefined);
    assert.equal(m.privatePhone, undefined);
  }
});
