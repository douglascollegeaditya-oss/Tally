import assert from 'node:assert/strict';
import test from 'node:test';
import { createItemAlert } from './alertsEngine.ts';
import {
  findReferenceOnlyPoolsInSession,
  findSimilarPoolsInSession,
} from './competingPoolsEngine.ts';
import {
  buildPoolStructuredCorpus,
  damerauLevenshteinBounded,
  evaluateTypoMatch,
  extractAnnotatedTokens,
  matchStructuredQueryToPool,
  searchPoolsForExplore,
} from './searchMatcher.ts';
import { createSeedSession, PERSONAS } from './seedData.ts';
import { createPool } from './tallyEngine.ts';

test('damerauLevenshteinBounded and evaluateTypoMatch enforce strict safety bounds', () => {
  assert.equal(damerauLevenshteinBounded('maverik', 'maverick', 2), 1);
  assert.equal(damerauLevenshteinBounded('maevrick', 'maverick', 2), 1);
  assert.equal(damerauLevenshteinBounded('crednza', 'credenza', 2), 1);
  assert.equal(damerauLevenshteinBounded('couhc', 'couch', 2), 1);

  // Positive bounded typo/transposition matches
  assert.equal(evaluateTypoMatch('maverik', 'maverick').matched, true);
  assert.equal(evaluateTypoMatch('maevrick', 'maverick').matched, true);
  assert.equal(evaluateTypoMatch('crednza', 'credenza').matched, true);
  assert.equal(evaluateTypoMatch('burnisde', 'burnside').matched, true);
  assert.equal(evaluateTypoMatch('couhc', 'couch').matched, true);
  assert.equal(evaluateTypoMatch('talbe', 'table').matched, true);

  // Negative safety cases: short words, protected trims/drivetrains, numeric tokens, 5-letter substitutions
  assert.equal(evaluateTypoMatch('ford', 'fork').matched, false);
  assert.equal(evaluateTypoMatch('xl', 'xlt').matched, false);
  assert.equal(evaluateTypoMatch('xle', 'xlt').matched, false);
  assert.equal(evaluateTypoMatch('awd', 'fwd').matched, false);
  assert.equal(evaluateTypoMatch('rav4', 'rav5').matched, false);
  assert.equal(evaluateTypoMatch('2025', '2026').matched, false);
  assert.equal(evaluateTypoMatch('chair', 'chain').matched, false);
  assert.equal(evaluateTypoMatch('bench', 'bunch').matched, false);
  assert.equal(evaluateTypoMatch('truck', 'track').matched, false);
  assert.equal(evaluateTypoMatch('table', 'cable').matched, false);
  assert.equal(evaluateTypoMatch('lariat', 'hybrid').matched, false);
  assert.equal(evaluateTypoMatch('hybrid', 'hyrbid').matched, false); // protected powertrain
});

test('handles query typos, transpositions, punctuation, spacing, and accents across Explore and Competing Pools', () => {
  const state = createSeedSession('test-fuzzy-query-typos', 'gathering-7-of-8');

  for (const query of [
    'ford maverik',
    'FORD,  Maevrick!!',
    'ford mave rick',
    'ford ma verick',
    'mave rick',
    'Fórd Mäverik',
  ]) {
    const explore = searchPoolsForExplore(state.pools, { query });
    assert.equal(explore.results.length, 1, `Explore should find Maverick for "${query}"`);
    assert.equal(explore.results[0].pool.id, 'pool-maverick-xlt');
    assert.equal(explore.results[0].matchKind, 'approximate');
    assert.equal(explore.hasExactMatches, false);
    assert.equal(explore.hasApproximateMatches, true);
    assert.ok(explore.results[0].interpretations.length > 0);
    // Split-join queries reliably suggest joining into "maverick"; uncorroborated single-listing typos omit suggestion
    if (query.includes(' rick') || query.includes(' verick')) {
      assert.ok(explore.suggestedQuery && explore.suggestedQuery.includes('maverick'));
    } else {
      assert.equal(explore.suggestedQuery, undefined);
    }

    const compared = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
      title: query,
      includeUnavailable: true,
    });
    assert.equal(compared.length, 1, `Comparison should find Maverick for "${query}"`);
    assert.equal(compared[0].pool.id, 'pool-maverick-xlt');
    assert.equal(compared[0].matchLevel, 'possible_match');
    assert.match(compared[0].matchLabel, /Possible match/i);
    assert.equal(compared[0].isApproximateMatch, true);
    assert.ok((compared[0].approximateInterpretations ?? []).length > 0);
    // Original pool title is never mutated
    assert.equal(compared[0].pool.title, '2026 Ford Maverick XLT Hybrid AWD');
  }
});

test('works bidirectionally: clean buyer search finds misspelled or awkwardly spaced user-created listings', () => {
  let state = createSeedSession('test-fuzzy-reverse', 'gathering-7-of-8');

  // 1. User creates a listing with a spelling typo ("Nordic Oak Crednza")
  const typoPoolRes = createPool(state, PERSONAS.organizer, {
    title: 'Nordic Oak Crednza',
    category: 'Furniture',
    location: 'Portland metro',
    deliveryOrDestination: 'Local warehouse pickup',
    unitSingular: 'piece',
    unitPlural: 'pieces',
    minQuantity: 4,
    maxQuantity: 8,
    goalDate: '2027-01-20',
    organizerNote: 'Small batch workshop run',
    sharedRequirements: ['Natural matte oak finish'],
    categorySpecs: [{ label: 'Model', value: 'Nordic Oak Crednza 72-inch' }],
    primaryOptionLabel: 'Finish',
    primaryOptionValues: ['Natural matte oak'],
  });
  assert.equal(typoPoolRes.ok, true);
  state = typoPoolRes.state;
  const typoPoolId = typoPoolRes.data.pool.id;

  // Original misspelled listing title is preserved untouched
  assert.equal(typoPoolRes.data.pool.title, 'Nordic Oak Crednza');

  // Clean buyer search finds it in BOTH Explore and Competing-Pools comparison
  // and NEVER suggests searching the misspelled listing text ("nordic oak crednza")
  const exploreTypo = searchPoolsForExplore(state.pools, { query: 'Nordic Oak Credenza' });
  assert.equal(exploreTypo.results.length, 1);
  assert.equal(exploreTypo.results[0].pool.id, typoPoolId);
  assert.equal(exploreTypo.results[0].matchKind, 'approximate');
  assert.ok(exploreTypo.results[0].interpretations.some((i) => /credenza.*crednza/i.test(i)));
  assert.equal(exploreTypo.suggestedQuery, undefined);

  const compareTypo = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Furniture',
    title: 'Nordic Oak Credenza',
    location: 'Portland metro',
  });
  assert.equal(compareTypo.length, 1);
  assert.equal(compareTypo[0].pool.id, typoPoolId);
  assert.equal(compareTypo[0].matchLevel, 'possible_match');
  assert.equal(compareTypo[0].isApproximateMatch, true);
  assert.equal(compareTypo[0].suggestedQuery, undefined);

  // 2. User creates a listing with awkward split word ("Midcentury Mave Rick Shelving" -> split "cre denza" / "mave rick")
  const splitPoolRes = createPool(state, PERSONAS.organizer, {
    title: '2026 Ford Mave Rick XLT Hybrid AWD',
    category: 'Vehicles',
    location: 'Seattle metro',
    deliveryOrDestination: 'Seattle dealership pickup',
    unitSingular: 'vehicle',
    unitPlural: 'vehicles',
    minQuantity: 5,
    maxQuantity: 10,
    goalDate: '2027-01-15',
    organizerNote: 'Seattle area cohort',
    sharedRequirements: ['XLT Hybrid AWD'],
    categorySpecs: [
      { label: 'Model', value: '2026 Ford Mave Rick Hybrid' },
      { label: 'Trim', value: 'XLT Hybrid AWD' },
    ],
    primaryOptionLabel: 'Trim',
    primaryOptionValues: ['XLT Hybrid AWD'],
  });
  assert.equal(splitPoolRes.ok, true);
  state = splitPoolRes.state;
  const splitPoolId = splitPoolRes.data.pool.id;

  // Clean search "Ford Maverick" returns exact seed pool FIRST, then split-word user pool as approximate
  const exploreSplit = searchPoolsForExplore(state.pools, { query: 'Ford Maverick' });
  assert.equal(exploreSplit.results.length, 2);
  assert.equal(exploreSplit.results[0].pool.id, 'pool-maverick-xlt');
  assert.equal(exploreSplit.results[0].matchKind, 'exact');
  assert.equal(exploreSplit.results[1].pool.id, splitPoolId);
  assert.equal(exploreSplit.results[1].matchKind, 'approximate');
  assert.ok(exploreSplit.results[1].interpretations.some((i) => /maverick.*mave rick/i.test(i)));
  // Because an exact match exists, no rewrite suggestion is shown
  assert.equal(exploreSplit.suggestedQuery, undefined);

  // Clean joined compound query "heatpump" finds spaced "Heat Pump" pool
  const exploreHeatpump = searchPoolsForExplore(state.pools, { query: 'heatpump' });
  assert.equal(exploreHeatpump.results.length, 1);
  assert.equal(exploreHeatpump.results[0].pool.id, 'pool-heatpump-pdx');
  assert.equal(exploreHeatpump.results[0].matchKind, 'approximate');
  assert.ok(exploreHeatpump.results[0].interpretations.some((i) => /heatpump.*heat pump/i.test(i)));
  // Should NOT suggest splitting clean "heatpump" into "heat pump" only when pool_split? Verify clean behavior
  assert.equal(exploreHeatpump.suggestedQuery, undefined);
});

test('supports unambiguous abbreviations and synonyms bidirectionally (1 br / 1 bedroom, apt / apartment, sofa / couch)', () => {
  let state = createSeedSession('test-fuzzy-abbr-syn', 'gathering-7-of-8');

  // 1. "1 br" finds East Burnside Lofts (1BR in title, 1 Bedroom in options) in both Explore and Comparison
  const explore1br = searchPoolsForExplore(state.pools, { query: '1 br' });
  assert.ok(explore1br.results.some((r) => r.pool.id === 'pool-burnside-apts'));
  const burnside1br = explore1br.results.find((r) => r.pool.id === 'pool-burnside-apts')!;
  assert.equal(burnside1br.matchKind, 'approximate');
  assert.ok(burnside1br.interpretations.some((i) => /1 br.*1 ?(br|bedroom)/i.test(i)));

  // Also explicitly verify "1 br" <-> "1 bedroom" against a listing written only with "1-Bedroom"
  const fullBedroomPoolRes = createPool(state, PERSONAS.organizer, {
    title: 'Division Street 1-Bedroom Lease Cohort',
    category: 'Apartments',
    location: 'Portland metro',
    deliveryOrDestination: 'SE Division St',
    unitSingular: 'lease',
    unitPlural: 'leases',
    minQuantity: 4,
    maxQuantity: 8,
    goalDate: '2027-02-01',
    organizerNote: 'Spring move-in group',
    sharedRequirements: ['12-month lease'],
    categorySpecs: [{ label: 'Unit size', value: '1-Bedroom' }],
    primaryOptionLabel: 'Unit size',
    primaryOptionValues: ['1-Bedroom'],
  });
  assert.equal(fullBedroomPoolRes.ok, true);
  const exploreDivision1br = searchPoolsForExplore(fullBedroomPoolRes.state.pools, {
    query: 'Division Street 1 br',
  });
  assert.equal(exploreDivision1br.results.length, 1);
  assert.equal(exploreDivision1br.results[0].pool.id, fullBedroomPoolRes.data.pool.id);
  assert.ok(exploreDivision1br.results[0].interpretations.some((i) => /1 br.*1 bedroom/i.test(i)));

  const compare1br = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Apartments',
    title: 'East Burnside 1 br',
    includeUnavailable: true,
  });
  assert.equal(compare1br.length, 1);
  assert.equal(compare1br[0].pool.id, 'pool-burnside-apts');
  assert.equal(compare1br[0].matchLevel, 'possible_match');
  assert.equal(compare1br[0].isApproximateMatch, true);

  // 2. "apt" finds Apartments listings
  const exploreApt = searchPoolsForExplore(state.pools, { query: 'apt' });
  assert.ok(exploreApt.results.some((r) => r.pool.id === 'pool-burnside-apts'));
  assert.ok(exploreApt.results.every((r) => r.pool.category === 'Apartments'));
  assert.ok(exploreApt.results[0].interpretations.some((i) => /apt.*apartments/i.test(i)));

  // 3. Reverse abbreviation: listing has "1 BR Apt", buyer searches "1 bedroom apartment"
  const abbrPoolRes = createPool(state, PERSONAS.organizer, {
    title: 'Hawthorne 1 BR Apt Lease Cohort',
    category: 'Apartments',
    location: 'Portland metro',
    deliveryOrDestination: 'SE Hawthorne Blvd',
    unitSingular: 'lease',
    unitPlural: 'leases',
    minQuantity: 4,
    maxQuantity: 8,
    goalDate: '2027-02-01',
    organizerNote: 'Spring move-in group',
    sharedRequirements: ['12-month lease'],
    categorySpecs: [{ label: 'Unit size', value: '1 BR' }],
    primaryOptionLabel: 'Unit size',
    primaryOptionValues: ['1 BR'],
  });
  assert.equal(abbrPoolRes.ok, true);
  state = abbrPoolRes.state;

  const reverseAptExplore = searchPoolsForExplore(state.pools, {
    query: 'Hawthorne 1 bedroom apartment',
  });
  assert.equal(reverseAptExplore.results.length, 1);
  assert.equal(reverseAptExplore.results[0].pool.id, abbrPoolRes.data.pool.id);
  assert.equal(reverseAptExplore.results[0].matchKind, 'approximate');

  // 4. Bidirectional synonym: "sofa" <-> "couch"
  const couchPoolRes = createPool(state, PERSONAS.organizer, {
    title: 'Linen Modular Sectional Couch',
    category: 'Furniture',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland warehouse pickup',
    unitSingular: 'couch',
    unitPlural: 'couches',
    minQuantity: 5,
    maxQuantity: 10,
    goalDate: '2027-02-10',
    organizerNote: 'Direct factory order',
    sharedRequirements: ['Performance linen weave'],
    categorySpecs: [{ label: 'Model', value: 'Linen Modular Sectional Couch' }],
    primaryOptionLabel: 'Configuration',
    primaryOptionValues: ['3-piece L-sectional'],
  });
  assert.equal(couchPoolRes.ok, true);
  state = couchPoolRes.state;

  const sofaSearchExplore = searchPoolsForExplore(state.pools, { query: 'Linen Sectional Sofa' });
  assert.equal(sofaSearchExplore.results.length, 1);
  assert.equal(sofaSearchExplore.results[0].pool.id, couchPoolRes.data.pool.id);
  assert.equal(sofaSearchExplore.results[0].matchKind, 'approximate');
  assert.ok(sofaSearchExplore.results[0].interpretations.some((i) => /sofa.*couch/i.test(i)));

  const sofaSearchCompare = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Furniture',
    title: 'Linen Sectional Sofa',
  });
  assert.equal(sofaSearchCompare.length, 1);
  assert.equal(sofaSearchCompare[0].pool.id, couchPoolRes.data.pool.id);
  assert.equal(sofaSearchCompare[0].matchLevel, 'possible_match');
  assert.equal(sofaSearchCompare[0].isApproximateMatch, true);
});

test('exact normalized matches ALWAYS rank strictly above approximate candidates in both Explore and Comparison', () => {
  let state = createSeedSession('test-fuzzy-ranking', 'gathering-7-of-8');

  // Add a typo listing in the same category/city so both an exact pool and an approximate pool exist
  const approxPoolRes = createPool(state, PERSONAS.organizer, {
    title: '2026 Ford Maverik XLT Hybrid AWD',
    category: 'Vehicles',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland pickup',
    unitSingular: 'vehicle',
    unitPlural: 'vehicles',
    minQuantity: 6,
    maxQuantity: 12,
    goalDate: '2026-12-16',
    organizerNote: 'Local cohort',
    sharedRequirements: ['XLT Hybrid AWD'],
    categorySpecs: [
      { label: 'Model', value: '2026 Ford Maverik Hybrid' },
      { label: 'Trim', value: 'XLT Hybrid AWD' },
    ],
    primaryOptionLabel: 'Trim',
    primaryOptionValues: ['XLT Hybrid AWD'],
  });
  assert.equal(approxPoolRes.ok, true);
  state = approxPoolRes.state;

  // Query "2026 Ford Maverick XLT Hybrid AWD" -> exact seed pool #1 (strong_match), typo pool #2 (possible_match)
  const exploreRanked = searchPoolsForExplore(state.pools, {
    query: '2026 Ford Maverick XLT Hybrid AWD',
  });
  assert.equal(exploreRanked.results.length, 2);
  assert.equal(exploreRanked.results[0].pool.id, 'pool-maverick-xlt');
  assert.equal(exploreRanked.results[0].matchKind, 'exact');
  assert.equal(exploreRanked.results[1].pool.id, approxPoolRes.data.pool.id);
  assert.equal(exploreRanked.results[1].matchKind, 'approximate');
  assert.equal(exploreRanked.hasExactMatches, true);
  assert.equal(exploreRanked.suggestedQuery, undefined);

  const compareRanked = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: '2026 Ford Maverick XLT Hybrid AWD',
    location: 'Portland metro',
    goalDate: '2026-12-16',
  });
  assert.equal(compareRanked.length, 2);
  assert.equal(compareRanked[0].pool.id, 'pool-maverick-xlt');
  assert.equal(compareRanked[0].matchLevel, 'strong_match');
  assert.equal(compareRanked[0].isApproximateMatch, false);
  assert.equal(compareRanked[1].pool.id, approxPoolRes.data.pool.id);
  assert.equal(compareRanked[1].matchLevel, 'possible_match');
  assert.equal(compareRanked[1].isApproximateMatch, true);
});

test('negative safety cases: incompatible trims, unit sizes, SKUs, categories, years, and descriptions are strictly protected', () => {
  const state = createSeedSession('test-fuzzy-safety', 'gathering-7-of-8');

  // 1. Typo in model + incompatible trim (XL vs XLT) -> 0 compatible in BOTH Explore and Comparison, surfaced ONLY as reference-only
  const xlExplore = searchPoolsForExplore(state.pools, { query: 'ford maverik xl' });
  assert.equal(xlExplore.results.length, 0);

  const xlCompare = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: 'ford maverik xl',
  });
  assert.equal(xlCompare.length, 0);

  const xlRefs = findReferenceOnlyPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Vehicles',
    title: 'ford maverik xl',
  });
  assert.equal(xlRefs.length, 1);
  assert.equal(xlRefs[0].pool.id, 'pool-maverick-xlt');
  assert.equal(xlRefs[0].referenceKind, 'incompatible_variant');

  // 2. Incompatible drivetrain with model typo (FWD vs AWD) -> 0 compatible
  assert.equal(searchPoolsForExplore(state.pools, { query: 'ford maverik fwd' }).results.length, 0);
  assert.equal(
    findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
      category: 'Vehicles',
      title: 'ford maverik fwd',
    }).length,
    0
  );

  // 3. Incompatible powertrain with model typo (EcoBoost vs Hybrid) -> 0 compatible
  assert.equal(
    searchPoolsForExplore(state.pools, { query: 'ford maverik ecoboost' }).results.length,
    0
  );

  // 4. Incompatible unit size (2 br vs 1-Bedroom on East Burnside Lofts) -> 0 compatible, reference-only surfaced
  assert.equal(
    searchPoolsForExplore(state.pools, { query: 'East Burnside 2 br' }).results.length,
    0
  );
  assert.equal(
    findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
      category: 'Apartments',
      title: 'East Burnside 2 br',
    }).length,
    0
  );
  const apt2brRefs = findReferenceOnlyPoolsInSession(state, 'buyer', 'buyer-maya', {
    category: 'Apartments',
    title: 'East Burnside 2 br',
  });
  assert.equal(apt2brRefs.length, 1);
  assert.equal(apt2brRefs[0].pool.id, 'pool-burnside-apts');

  // 5. Category boundary never crossed even with typos
  assert.equal(
    searchPoolsForExplore(state.pools, { query: 'ford maverik', category: 'Furniture' }).results
      .length,
    0
  );
  assert.equal(
    findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
      category: 'Furniture',
      title: 'ford maverik',
    }).length,
    0
  );
  assert.equal(
    findReferenceOnlyPoolsInSession(state, 'buyer', 'buyer-maya', {
      category: 'Furniture',
      title: 'ford maverik',
    }).length,
    0
  );

  // 6. Conflicting SKU codes (WW-DT91 vs WW-DT90) strictly gated out despite 1-digit edit distance
  assert.equal(
    searchPoolsForExplore(state.pools, { query: 'Solid Walnut Dining Table WW-DT91' }).results
      .length,
    0
  );
  assert.equal(
    findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
      category: 'Furniture',
      title: 'Solid Walnut Dining Table',
      modelOrVariant: 'WW-DT91',
      categorySpecs: [{ label: 'SKU / Model', value: 'WW-DT91' }],
    }).length,
    0
  );

  // 7. Explicit model year conflict (2025 vs 2026-only pool) is strictly gated out in BOTH Explore and Comparison
  // (including with spelling typos like "2025 ford maverik") and surfaced ONLY as reference-only with exact year diff
  for (const query of ['2025 ford maverick', '2025 ford maverik', '2025 Ford Maverick XLT Hybrid AWD']) {
    const exploreWrongYear = searchPoolsForExplore(state.pools, { query });
    assert.equal(exploreWrongYear.results.length, 0, `Explore must exclude 2026-only pool for "${query}"`);

    const compareWrongYear = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
      title: query,
      includeUnavailable: true,
    });
    assert.equal(compareWrongYear.length, 0, `Comparison must exclude 2026-only pool for "${query}"`);

    const yearRefs = findReferenceOnlyPoolsInSession(state, 'buyer', 'buyer-maya', {
      title: query,
      includeUnavailable: true,
    });
    assert.equal(yearRefs.length, 1, `Reference-only should surface 2026 pool for "${query}"`);
    assert.equal(yearRefs[0].pool.id, 'pool-maverick-xlt');
    assert.equal(yearRefs[0].referenceKind, 'incompatible_variant');
    assert.match(yearRefs[0].explanation, /Model year differs \(2026 vs 2025\)/i);
  }

  // 8. Description-only and generic noise words return 0 in BOTH Explore and Comparison
  for (const noise of ['VIN etching', 'uniform baseline', 'Local Neighborhood Group Buy']) {
    assert.equal(searchPoolsForExplore(state.pools, { query: noise }).results.length, 0);
    assert.equal(
      findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', { title: noise }).length,
      0
    );
  }

  // 9. Unrelated products return 0
  assert.equal(
    searchPoolsForExplore(state.pools, { query: 'Herman Miller Aeron Chair' }).results.length,
    0
  );
});

test('explicit multi-year structured pool scope accepts requested year while 2026-only stays reference-only', () => {
  let state = createSeedSession('test-multiyear-scope', 'gathering-7-of-8');

  // Create a pool whose structured scope explicitly accepts both 2025 and 2026
  const multiYearRes = createPool(state, PERSONAS.organizer, {
    title: '2025/2026 Ford Maverick XLT Hybrid AWD',
    category: 'Vehicles',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland pickup',
    unitSingular: 'vehicle',
    unitPlural: 'vehicles',
    minQuantity: 5,
    maxQuantity: 10,
    goalDate: '2027-01-15',
    organizerNote: 'Dealer allows either 2025 or 2026 model year inventory.',
    sharedRequirements: ['XLT Hybrid AWD'],
    categorySpecs: [
      { label: 'Model', value: '2025 / 2026 Ford Maverick Hybrid' },
      { label: 'Trim', value: 'XLT Hybrid AWD' },
    ],
    primaryOptionLabel: 'Model Year',
    primaryOptionValues: ['2025', '2026'],
  });
  assert.equal(multiYearRes.ok, true);
  state = multiYearRes.state;

  // Searching "2025 ford maverick" matches ONLY the multi-year pool as compatible,
  // while the 2026-only seed pool appears strictly in referencePools
  const explore2025 = searchPoolsForExplore(state.pools, { query: '2025 ford maverick' });
  assert.equal(explore2025.results.length, 1);
  assert.equal(explore2025.results[0].pool.id, multiYearRes.data.pool.id);

  const compare2025 = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    title: '2025 ford maverick',
    includeUnavailable: true,
  });
  assert.equal(compare2025.length, 1);
  assert.equal(compare2025[0].pool.id, multiYearRes.data.pool.id);

  const refs2025 = findReferenceOnlyPoolsInSession(state, 'buyer', 'buyer-maya', {
    title: '2025 ford maverick',
    includeUnavailable: true,
  });
  assert.equal(refs2025.length, 1);
  assert.equal(refs2025[0].pool.id, 'pool-maverick-xlt');
  assert.match(refs2025[0].explanation, /Model year differs \(2026 vs 2025\)/i);

  // Also verify multi-pool corroboration: now that 2 distinct pools contain "maverick",
  // searching "ford maverik" reliably suggests "ford maverick"
  const corroboratedExplore = searchPoolsForExplore(state.pools, { query: 'ford maverik' });
  assert.equal(corroboratedExplore.results.length, 2);
  assert.equal(corroboratedExplore.suggestedQuery, 'ford maverick');
});

test('omits misleading correction suggestions for listing-specific misspellings (Birchside walnut credenza vs crednza)', () => {
  let state = createSeedSession('test-birchside-suggestion', 'gathering-7-of-8');

  const birchsideRes = createPool(state, PERSONAS.organizer, {
    title: 'Birchside walnut crednza',
    category: 'Furniture',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland workshop pickup',
    unitSingular: 'piece',
    unitPlural: 'pieces',
    minQuantity: 4,
    maxQuantity: 8,
    goalDate: '2027-02-01',
    organizerNote: 'Direct studio batch',
    sharedRequirements: ['Solid American walnut'],
    categorySpecs: [{ label: 'Model', value: 'Birchside walnut crednza' }],
    primaryOptionLabel: 'Finish',
    primaryOptionValues: ['Natural oil'],
  });
  assert.equal(birchsideRes.ok, true);
  state = birchsideRes.state;

  // Buyer types correct "Birchside walnut credenza" -> finds possible match with clear spelling explanation,
  // and MUST NOT suggest searching the misspelled listing text "birchside walnut crednza"
  const explore = searchPoolsForExplore(state.pools, { query: 'Birchside walnut credenza' });
  assert.equal(explore.results.length, 1);
  assert.equal(explore.results[0].pool.id, birchsideRes.data.pool.id);
  assert.equal(explore.results[0].matchKind, 'approximate');
  assert.ok(explore.results[0].interpretations.some((i) => /credenza.*crednza/i.test(i)));
  assert.equal(explore.suggestedQuery, undefined);

  const compared = findSimilarPoolsInSession(state, 'buyer', 'buyer-maya', {
    title: 'Birchside walnut credenza',
    includeUnavailable: true,
  });
  assert.equal(compared.length, 1);
  assert.equal(compared[0].pool.id, birchsideRes.data.pool.id);
  assert.equal(compared[0].matchLevel, 'possible_match');
  assert.equal(compared[0].isApproximateMatch, true);
  assert.ok(
    (compared[0].approximateInterpretations ?? []).some((i) => /credenza.*crednza/i.test(i))
  );
  assert.equal(compared[0].suggestedQuery, undefined);
});

test('approximate matching preserves privacy stripping, separate-pool override, and existing saved alerts', () => {
  let state = createSeedSession('test-fuzzy-privacy-alerts', 'just-unlocked');

  // Privacy fields remain stripped on approximate comparison hits
  const approxMatches = findSimilarPoolsInSession(state, 'buyer', 'buyer-stranger', {
    category: 'Vehicles',
    title: 'ford maverik',
    includeUnavailable: true,
  });
  assert.equal(approxMatches.length, 1);
  assert.equal(approxMatches[0].isApproximateMatch, true);
  assert.equal(approxMatches[0].pool.sellerToken, undefined);
  assert.equal(approxMatches[0].pool.currentOffer?.privateClaimInstructions, '');
  assert.equal(approxMatches[0].pool.currentOffer?.privateReferencePrefix, '');
  for (const m of approxMatches[0].pool.members) {
    assert.equal(m.privateEmail, undefined);
    assert.equal(m.privatePhone, undefined);
  }

  // Existing saved alert behavior remains exact normalized whole-word (no noisy fuzzy false triggers)
  const alertRes = createItemAlert(state, PERSONAS.buyer, {
    query: 'Nordic Oak Credenza',
    category: 'Furniture',
    city: 'Portland',
  });
  assert.equal(alertRes.ok, true);
  state = alertRes.state;

  // Publishing a pool with a typo does not falsely trigger exact-match saved alert, while exact match does
  const typoCreate = createPool(state, PERSONAS.organizer, {
    title: 'Nordic Oak Crednza',
    category: 'Furniture',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland pickup',
    unitSingular: 'piece',
    unitPlural: 'pieces',
    minQuantity: 4,
    maxQuantity: 8,
    goalDate: '2027-02-01',
    organizerNote: 'Workshop run',
    sharedRequirements: ['Natural oak'],
    categorySpecs: [{ label: 'Model', value: 'Nordic Oak Crednza' }],
    primaryOptionLabel: 'Finish',
    primaryOptionValues: ['Natural oak'],
  });
  assert.equal(typoCreate.ok, true);
  assert.equal(typoCreate.state.notifications.length, 0);

  const exactCreate = createPool(typoCreate.state, PERSONAS.organizer, {
    title: 'Nordic Oak Credenza',
    category: 'Furniture',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland pickup',
    unitSingular: 'piece',
    unitPlural: 'pieces',
    minQuantity: 4,
    maxQuantity: 8,
    goalDate: '2027-02-15',
    organizerNote: 'Second batch',
    sharedRequirements: ['Natural oak'],
    categorySpecs: [{ label: 'Model', value: 'Nordic Oak Credenza' }],
    primaryOptionLabel: 'Finish',
    primaryOptionValues: ['Natural oak'],
  });
  assert.equal(exactCreate.ok, true);
  assert.equal(exactCreate.state.notifications.length, 1);
  assert.equal(exactCreate.state.notifications[0].poolId, exactCreate.data.pool.id);
});

test('extractAnnotatedTokens and matchStructuredQueryToPool enforce bounded length caps gracefully', () => {
  const longQuery = 'ford maverik '.repeat(40);
  const tokens = extractAnnotatedTokens(longQuery);
  assert.ok(tokens.length <= 48);

  const state = createSeedSession('test-fuzzy-bounds', 'gathering-7-of-8');
  const maverickPool = state.pools.find((p) => p.id === 'pool-maverick-xlt')!;
  const corpus = buildPoolStructuredCorpus(maverickPool, ['XLT Hybrid AWD'], ['2026 Ford Maverick Hybrid']);
  const res = matchStructuredQueryToPool(longQuery, corpus);
  assert.equal(res.matched, true);
  assert.ok(res.totalQueryUnits <= 16);
});
