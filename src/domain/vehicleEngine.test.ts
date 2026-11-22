import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrustedPaidPlacement,
  buildTrustedTallyCertification,
  evaluateQuoteCompatibility,
  evaluateVehicleCompatibility,
  getPoolPlacementInfo,
  isAccessoryPool,
  migrateLegacyVehiclePool,
  normalizeQuoteItemizedFees,
  rankDiscoveryPools,
  stripUntrustedPlacementFields,
  validateVehicleSpecs,
} from './vehicleEngine.ts';
import { createSeedSession } from './seedData.ts';
import { createPool, publishOrReviseSellerOffer, setDemoPoolPlacement } from './tallyEngine.ts';
import { searchPoolsForExplore } from './searchMatcher.ts';
import {
  findReferenceOnlyPoolsInSession,
  findSimilarPoolsInSession,
} from './competingPoolsEngine.ts';
import { migrateSessionState } from './alertsEngine.ts';
import type { Pool, SellerOffer, VehicleSpecProfile } from './types.ts';

function getSeedPool(id: string): Pool {
  const session = createSeedSession('veh-test-seed', 'gathering-7-of-8');
  const pool = session.pools.find((p) => p.id === id);
  assert.ok(pool, `Expected seeded pool ${id} to exist`);
  return pool;
}

describe('vehicleEngine: non-destructive legacy migration & accessory separation', () => {
  it('classifies legacy EV charger pool as accessory and never as a motor vehicle', () => {
    const legacyCharger: Pool = {
      ...getSeedPool('pool-ev-charger-sea'),
      vehicleSpecs: undefined,
    };
    const migrated = migrateLegacyVehiclePool(legacyCharger);
    assert.equal(migrated.vehicleSpecs?.assetClass, 'accessory');
    assert.equal(migrated.vehicleSpecs?.vehicleType, undefined);
    assert.equal(isAccessoryPool(migrated), true);
  });

  it('migrates legacy custom vehicle pool non-destructively without inventing unspecified specs', () => {
    const legacyCustom: Pool = {
      ...getSeedPool('pool-maverick-xlt'),
      id: 'pool-legacy-custom-1',
      title: '2026 Toyota Camry Neighborhood Group',
      subtitle: 'Local Portland buyers',
      categorySpecs: [{ label: 'Model', value: '2026 Toyota Camry' }],
      optionGroups: [],
      vehicleSpecs: undefined,
      tallyCertification: undefined,
      paidPlacement: undefined,
    };
    const migrated = migrateLegacyVehiclePool(legacyCustom);
    assert.equal(migrated.vehicleSpecs?.assetClass, 'vehicle');
    assert.equal(migrated.vehicleSpecs?.year, 2026);
    assert.equal(migrated.vehicleSpecs?.make, 'Toyota');
    // Unspecified attributes MUST remain undefined (never invented!)
    assert.equal(migrated.vehicleSpecs?.condition, undefined);
    assert.equal(migrated.vehicleSpecs?.transmission, undefined);
    assert.equal(migrated.vehicleSpecs?.gvwr, undefined);
    assert.equal(migrated.vehicleSpecs?.axleConfiguration, undefined);
    assert.equal(migrated.vehicleSpecs?.seatingCapacity, undefined);
  });

  it('migrateSessionState preserves existing pools while applying non-destructive vehicle migration', () => {
    const session = createSeedSession('veh-mig-test', 'gathering-7-of-8');
    // Strip vehicleSpecs from EV charger to simulate legacy stored session JSON
    const charger = session.pools.find((p) => p.id === 'pool-ev-charger-sea')!;
    delete charger.vehicleSpecs;
    const migratedSession = migrateSessionState(session);
    const migratedCharger = migratedSession.pools.find((p) => p.id === 'pool-ev-charger-sea')!;
    assert.equal(migratedCharger.vehicleSpecs?.assetClass, 'accessory');
    assert.equal(migratedSession.pools.length, session.pools.length);
  });

  it('keeps EV charger strictly out of motor vehicle type filters on Explore', () => {
    const session = createSeedSession('veh-explore-acc', 'gathering-7-of-8');
    const motorTypes = ['passenger', 'pickup', 'commercial_van_truck', 'bus', 'semi_tractor'] as const;

    for (const vtype of motorTypes) {
      const res = searchPoolsForExplore(session.pools, {
        category: 'Vehicles',
        vehicleType: vtype,
      });
      const ids = res.results.map((r) => r.pool.id);
      assert.ok(
        !ids.includes('pool-ev-charger-sea'),
        `EV charger must NOT appear under vehicleType=${vtype}`
      );
      assert.ok(ids.length >= 1, `Expected at least 1 seeded pool for vehicleType=${vtype}`);
    }

    const accRes = searchPoolsForExplore(session.pools, {
      category: 'Vehicles',
      vehicleType: 'accessories',
    });
    const accIds = accRes.results.map((r) => r.pool.id);
    assert.deepEqual(accIds, ['pool-ev-charger-sea']);
  });
});

describe('vehicleEngine: structured compatibility across all 5 vehicle types & units', () => {
  it('blocks conflicting vehicle types (pickup vs semi_tractor, bus vs commercial_van_truck)', () => {
    const pickup: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'pickup',
      condition: 'new',
      make: 'Ford',
      model: 'Maverick',
      year: 2026,
    };
    const semi: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'semi_tractor',
      condition: 'new',
      make: 'Freightliner',
      model: 'Cascadia',
      year: 2026,
    };
    const compat = evaluateVehicleCompatibility(pickup, semi);
    assert.equal(compat.status, 'conflict');
    assert.equal(compat.compatible, false);
    assert.ok(compat.conflicts.some((c) => /type/i.test(c)));
  });

  it('blocks accessory vs motor vehicle compatibility', () => {
    const acc: VehicleSpecProfile = { assetClass: 'accessory' };
    const car: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'passenger',
      make: 'Subaru',
      model: 'Outback',
    };
    const compat = evaluateVehicleCompatibility(acc, car);
    assert.equal(compat.status, 'conflict');
    assert.equal(compat.compatible, false);
  });

  it('blocks condition conflicts (new vs used) and year range conflicts', () => {
    const query: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'pickup',
      condition: 'used',
      make: 'Ford',
      model: 'Maverick',
      yearMin: 2023,
      yearMax: 2025,
    };
    const poolSpec: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'pickup',
      condition: 'new',
      make: 'Ford',
      model: 'Maverick',
      year: 2026,
    };
    const compat = evaluateVehicleCompatibility(query, poolSpec);
    assert.equal(compat.status, 'conflict');
    assert.equal(compat.conflicts.length >= 2, true);
  });

  it('handles overlapping accepted year ranges cleanly', () => {
    const query: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'bus',
      condition: 'new',
      yearMin: 2025,
      yearMax: 2026,
      busType: 'Shuttle bus',
      seatingCapacity: 14,
      accessibilityRequirement: 'ADA wheelchair lift (2 positions)',
    };
    const poolSpec: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'bus',
      condition: 'new',
      year: 2026,
      busType: 'Shuttle bus',
      seatingCapacity: 14,
      accessibilityRequirement: 'ADA wheelchair lift (2 positions)',
    };
    const compat = evaluateVehicleCompatibility(query, poolSpec);
    assert.equal(compat.compatible, true);
    assert.equal(compat.conflicts.length, 0);
  });

  it('flags semi-tractor axle, trailer inclusion, and lbs↔kg weight conflicts', () => {
    const requiredTractor: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'semi_tractor',
      condition: 'new',
      make: 'Freightliner',
      model: 'Cascadia',
      year: 2026,
      axleConfiguration: '6x4',
      trailerInclusion: 'tractor_only',
      gcwr: { value: 80000, unit: 'lbs' },
      requiredFields: ['axleConfiguration', 'trailerInclusion', 'gcwr'],
    };

    const conflictingOffer: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'semi_tractor',
      condition: 'new',
      make: 'Freightliner',
      model: 'Cascadia',
      year: 2026,
      axleConfiguration: '4x2',
      trailerInclusion: 'includes_trailer',
      gcwr: { value: 25000, unit: 'kg' }, // ~55,115 lbs < 80,000 lbs
    };

    const compat = evaluateVehicleCompatibility(requiredTractor, conflictingOffer);
    assert.equal(compat.status, 'conflict');
    assert.ok(compat.conflicts.some((c) => /axle/i.test(c)));
    assert.ok(compat.conflicts.some((c) => /trailer/i.test(c)));
    assert.ok(compat.conflicts.some((c) => /GCWR/i.test(c)));
  });

  it('compares used vehicle mileage across mi and km accurately', () => {
    const buyerMax: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'pickup',
      condition: 'used',
      make: 'Toyota',
      model: 'Tacoma',
      maxMileage: { value: 30000, unit: 'mi' },
    };
    const highKmVehicle: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'pickup',
      condition: 'used',
      make: 'Toyota',
      model: 'Tacoma',
      mileage: { value: 80000, unit: 'km' }, // ~49,710 mi > 30,000 mi
    };
    const compat = evaluateVehicleCompatibility(buyerMax, highKmVehicle);
    assert.equal(compat.status, 'conflict');
    assert.ok(compat.conflicts.some((c) => /mileage/i.test(c)));
  });

  it('marks missing/unspecified attributes as possible_verify and never assumes exact fit', () => {
    const buyer: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'bus',
      condition: 'new',
      busType: 'Shuttle bus',
      seatingCapacity: 14,
      accessibilityRequirement: 'ADA wheelchair lift',
    };
    const sparsePool: VehicleSpecProfile = {
      assetClass: 'vehicle',
      vehicleType: 'bus',
      condition: 'new',
      // busType, seatingCapacity, accessibilityRequirement omitted
    };
    const compat = evaluateVehicleCompatibility(buyer, sparsePool);
    assert.equal(compat.status, 'possible_verify');
    assert.equal(compat.compatible, true);
    assert.ok(compat.unverifiedFields.length >= 2);
  });

  it('never lets fuzzy spelling override a structured conflict in competing-pool comparison', () => {
    const session = createSeedSession('veh-fuzzy-guard', 'gathering-7-of-8');
    // Typo in "Maverik" + explicit conflicting year 2024 + used condition
    const query = {
      category: 'Vehicles' as const,
      title: '2024 Ford Maverik Hybrid XLT',
      vehicleSpecs: {
        assetClass: 'vehicle' as const,
        vehicleType: 'pickup' as const,
        condition: 'used' as const,
        make: 'Ford',
        model: 'Maverick',
        year: 2024,
      },
    };
    const candidates = findSimilarPoolsInSession(session, query, 'buyer', 'buyer-maya');
    const referencePools = findReferenceOnlyPoolsInSession(
      session,
      query,
      new Set(candidates.map((c) => c.pool.id)),
      'buyer'
    );

    const compatIds = candidates.map((c) => c.pool.id);
    const refIds = referencePools.map((r) => r.pool.id);
    assert.ok(!compatIds.includes('pool-maverick-xlt'), 'Conflicting 2024 used Maverick must NOT be compatible');
    assert.ok(refIds.includes('pool-maverick-xlt'), 'Conflicting 2026 new Maverick should be Reference-only');
  });
});

describe('vehicleEngine: numeric & unit validation', () => {
  it('rejects invalid years, inverted year ranges, negative weights, missing units, and invalid seating', () => {
    const bad = validateVehicleSpecs({
      assetClass: 'vehicle',
      vehicleType: 'bus',
      yearMin: 2027,
      yearMax: 2024,
      seatingCapacity: 0,
      gvwr: { value: -500, unit: 'lbs' },
      payloadCapacity: { value: 2000, unit: 'tons' as unknown as 'lbs' },
    });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.vehYearMax);
    assert.ok(bad.errors.vehSeatingCapacity);
    assert.ok(bad.errors.vehGvwrValue);
    assert.ok(bad.errors.vehPayloadValue);
  });

  it('accepts valid commercial semi-tractor specs with explicit units', () => {
    const ok = validateVehicleSpecs({
      assetClass: 'vehicle',
      vehicleType: 'semi_tractor',
      condition: 'new',
      make: 'Freightliner',
      model: 'Cascadia 126',
      year: 2026,
      axleConfiguration: '6x4',
      gcwr: { value: 80000, unit: 'lbs' },
      trailerInclusion: 'tractor_only',
    });
    assert.equal(ok.valid, true);
    assert.deepEqual(ok.errors, {});
  });
});

describe('vehicleEngine: dealer quotes — itemized/TBD fees, conflicts & versioning', () => {
  it('distinguishes fixed $0 fees from Unknown / TBD fees', () => {
    const zeroOnly = normalizeQuoteItemizedFees(
      [{ id: 'f1', label: 'Dealer doc fee', status: 'fixed', amount: 0 }],
      0,
      'Dealer doc fee'
    );
    assert.equal(zeroOnly.knownFeesTotal, 0);
    assert.equal(zeroOnly.hasUnknownFees, false);

    const mixed = normalizeQuoteItemizedFees(
      [
        { id: 'f1', label: 'Dealer doc & prep', status: 'fixed', amount: 650 },
        { id: 'f2', label: 'Regional delivery & upfit', status: 'unknown' },
      ],
      0,
      'Fees'
    );
    assert.equal(mixed.knownFeesTotal, 650);
    assert.equal(mixed.hasUnknownFees, true);
  });

  it('flags a dealer quote that conflicts with required semi-tractor specs and preserves versioning/reconfirmation', () => {
    const session = createSeedSession('veh-quote-conflict', 'gathering-7-of-8');
    const semiPool = session.pools.find((p) => p.id === 'pool-cascadia-semi')!;
    assert.ok(semiPool.currentOffer);

    // Seeded offer v1 should be compatible with the pool
    const v1Check = evaluateQuoteCompatibility(semiPool, semiPool.currentOffer);
    assert.equal(v1Check.compatible, true);
    assert.equal(semiPool.currentOffer.knownFeesUnknown, true);

    // Seller revises to v2 with conflicting 4x2 axle and wrong year 2025
    const prevConfirmed = semiPool.members.filter((m) => m.status === 'confirmed').length;
    assert.ok(prevConfirmed > 0);

    const res = publishOrReviseSellerOffer(session, semiPool.sellerToken!, {
      sellerName: semiPool.currentOffer.sellerName,
      sellerLocation: semiPool.currentOffer.sellerLocation,
      matchingScope: '2025 Freightliner Cascadia 4x2 Day Cab (revised)',
      currency: 'USD',
      unitPrice: 151000,
      knownFees: 650,
      knownFeesUnknown: true,
      feeLabel: 'Dealer doc fee + TBD delivery',
      itemizedFees: semiPool.currentOffer.itemizedFees,
      taxAndRegistrationNote: semiPool.currentOffer.taxAndRegistrationNote,
      quotedVehicle: {
        ...semiPool.currentOffer.quotedVehicle,
        assetClass: 'vehicle',
        vehicleType: 'semi_tractor',
        year: 2025,
        axleConfiguration: '4x2',
      },
      minQuantity: 3,
      maxQuantity: 6,
      fulfillmentMethod: semiPool.currentOffer.fulfillmentMethod,
      closeAt: semiPool.currentOffer.closeAt,
      timezoneLabel: 'Pacific',
      claimByDate: semiPool.currentOffer.claimByDate,
      privateClaimInstructions: semiPool.currentOffer.privateClaimInstructions,
      revisionSummary: 'Substituted 2025 4x2 stock units',
    });

    assert.equal(res.isRevision, true);
    assert.equal(res.offer.version, 2);
    assert.equal(semiPool.offerHistory.length, 1);
    // Prior confirmations cleared and marked needsReconfirmation
    assert.equal(semiPool.members.filter((m) => m.status === 'confirmed').length, 0);
    assert.ok(semiPool.members.some((m) => m.needsReconfirmation === true));

    // Conflict detector catches both year and axle mismatch!
    const v2Check = evaluateQuoteCompatibility(semiPool, res.offer);
    assert.equal(v2Check.compatible, false);
    assert.ok(v2Check.conflicts.some((c) => /year/i.test(c)));
    assert.ok(v2Check.conflicts.some((c) => /axle/i.test(c)));
  });
});

describe('vehicleEngine: Tally Certified & Paid Featured placement ordering and tamper resistance', () => {
  it('ranks Paid Featured > Tally Certified > Organic AFTER filters, with both-flagged in Paid tier displaying both badges', () => {
    const session = createSeedSession('veh-rank-test', 'gathering-7-of-8');
    const vehiclesOnly = searchPoolsForExplore(session.pools, {
      category: 'Vehicles',
      vehicleType: 'all',
    });
    const ranked = rankDiscoveryPools(vehiclesOnly.results.map((r) => r.pool));
    const tiers = ranked.orderedPools.map((p) => ({
      id: p.id,
      info: getPoolPlacementInfo(p),
    }));

    // Cascadia (Both Paid + Certified) and Isuzu (Paid) must come before Subaru (Certified), which must come before organic Maverick / Bus / EV Charger
    const firstCertifiedIdx = tiers.findIndex((t) => t.info.tier === 'tally_certified');
    const lastPaidIdx = tiers.reduce(
      (acc, t, idx) => (t.info.tier === 'paid_featured' ? idx : acc),
      -1
    );
    const firstOrganicIdx = tiers.findIndex((t) => t.info.tier === 'organic');

    assert.ok(lastPaidIdx >= 0 && firstCertifiedIdx > lastPaidIdx);
    assert.ok(firstOrganicIdx > firstCertifiedIdx);

    const cascadia = tiers.find((t) => t.id === 'pool-cascadia-semi')!;
    assert.equal(cascadia.info.tier, 'paid_featured');
    assert.equal(cascadia.info.hasBothBadges, true);
    assert.equal(cascadia.info.isPaidFeatured, true);
    assert.equal(cascadia.info.isTallyCertified, true);
  });

  it('never elevates unavailable (unlocked/expired/closed) listings even if flagged paid or certified', () => {
    const session = createSeedSession('veh-unavail-rank', 'gathering-7-of-8');
    const organic = getSeedPool('pool-shuttle-bus-ada');
    const endedPaid: Pool = {
      ...getSeedPool('pool-isuzu-box-truck-paid'),
      id: 'pool-ended-paid',
      stage: 'expired',
      paidPlacement: buildTrustedPaidPlacement({ sponsorName: 'Test Sponsor' }),
      tallyCertification: buildTrustedTallyCertification({}),
    };

    const ranked = rankDiscoveryPools([endedPaid, organic]);
    assert.equal(ranked.orderedPools[0].id, organic.id);
    assert.equal(getPoolPlacementInfo(endedPaid).eligibleForBoost, false);
    assert.equal(getPoolPlacementInfo(endedPaid).tier, 'organic');
  });

  it('keeps exact text matches ahead of approximate matches even if approximate pool is Paid Featured', () => {
    const paidApprox = getSeedPool('pool-isuzu-box-truck-paid');
    const organicExact = getSeedPool('pool-shuttle-bus-ada');
    const matchKinds = new Map<string, 'all' | 'exact' | 'approximate'>([
      [paidApprox.id, 'approximate'],
      [organicExact.id, 'exact'],
    ]);
    const ranked = rankDiscoveryPools([paidApprox, organicExact], { matchKindByPoolId: matchKinds });
    assert.equal(ranked.orderedPools[0].id, organicExact.id);
  });

  it('strips untrusted placement fields on public pool creation and never grants badges from titles', () => {
    const stripped = stripUntrustedPlacementFields({
      title: 'Tally Certified Sponsored 2026 Ford Maverick',
      tallyCertification: { certified: true },
      paidPlacement: { featured: true },
    });
    assert.equal('tallyCertification' in stripped, false);
    assert.equal('paidPlacement' in stripped, false);

    const session = createSeedSession('veh-tamper-test', 'gathering-7-of-8');
    const maliciousInput = {
      title: 'Tally Certified Bulk Deal Sponsored Featured 2026 Honda Civic',
      category: 'Vehicles' as const,
      location: 'Portland, OR',
      unitSingular: 'vehicle',
      unitPlural: 'vehicles',
      minQuantity: 4,
      maxQuantity: 8,
      goalDate: '2026-12-20',
      sharedRequirements: ['Factory new only'],
      categorySpecs: [],
      vehicleSpecs: {
        assetClass: 'vehicle' as const,
        vehicleType: 'passenger' as const,
        condition: 'new' as const,
        make: 'Honda',
        model: 'Civic',
        year: 2026,
      },
      // Attempted client tamper injection:
      tallyCertification: buildTrustedTallyCertification({}),
      paidPlacement: buildTrustedPaidPlacement({}),
    };

    const created = createPool(session, 'buyer', maliciousInput as Parameters<typeof createPool>[2]);
    const info = getPoolPlacementInfo(created.pool);
    assert.equal(info.isTallyCertified, false);
    assert.equal(info.isPaidFeatured, false);
    assert.equal(info.tier, 'organic');

    // Demo-only trusted server toggle CAN set & clear flags cleanly
    setDemoPoolPlacement(session, created.pool.id, { tallyCertified: true, paidFeatured: false });
    assert.equal(getPoolPlacementInfo(created.pool).isTallyCertified, true);
    assert.equal(getPoolPlacementInfo(created.pool).isPaidFeatured, false);
    setDemoPoolPlacement(session, created.pool.id, { tallyCertified: false });
    assert.equal(getPoolPlacementInfo(created.pool).isTallyCertified, false);
  });
});
