import { containsContiguousTokens, normalizeMatchTokens } from './alertsEngine.ts';
import {
  buildCorroboratedTokenSet,
  buildPoolStructuredCorpus,
  extractApartmentUnitSize,
  extractModelYears,
  extractPoolModelYears,
  extractSkuCodes,
  extractSubstantiveItemTokens,
  ITEM_SPEC_LABEL_RE,
  matchStructuredQueryToPool,
  VEHICLE_DRIVETRAIN_FAMILY,
  VEHICLE_POWERTRAIN_FAMILY,
  VEHICLE_TRIM_FAMILY,
} from './searchMatcher.ts';
import {
  computePoolMetrics,
  normalizeCalendarDate,
  sanitizePoolForRole,
} from './tallyEngine.ts';
import {
  POOL_CATEGORIES,
  type DemoSessionState,
  type PersonaRole,
  type Pool,
  type PoolCategory,
  type PoolMetrics,
  type SimilarPoolAvailability,
  type SimilarPoolCandidate,
  type SimilarPoolMatchLevel,
  type SimilarPoolQueryInput,
  type SimilarPoolQuoteSummary,
  type SimilarPoolReference,
  type VehicleSpecProfile,
} from './types.ts';
import {
  evaluateQuoteCompatibility,
  evaluateVehicleCompatibility,
  formatYearRequirement,
  getVehicleTypeLabel,
  inferVehicleSignalsFromText,
} from './vehicleEngine.ts';

export { extractSubstantiveItemTokens };

const VALID_CATEGORY_SET = new Set<string>(POOL_CATEGORIES);

function collectPoolStructuredItemText(pool: Pool): {
  titleText: string;
  allowedOptionTexts: string[];
  excludedOptionTexts: string[];
  itemSpecTexts: string[];
  fullItemText: string;
} {
  const allowedOptionTexts: string[] = [];
  const excludedOptionTexts: string[] = [];

  if (Array.isArray(pool.optionGroups)) {
    for (const group of pool.optionGroups) {
      if (group.id === 'delivery') continue;
      const allowedSet = new Set(group.allowedValues ?? []);
      for (const val of group.allowedValues ?? []) {
        if (typeof val === 'string' && !val.toLowerCase().includes('(excluded)')) {
          allowedOptionTexts.push(val);
        }
      }
      for (const val of group.allValues ?? []) {
        if (typeof val !== 'string') continue;
        if (!allowedSet.has(val) || val.toLowerCase().includes('(excluded)')) {
          excludedOptionTexts.push(val.replace(/\(excluded\)/gi, '').trim());
        }
      }
    }
  }

  const itemSpecTexts: string[] = [];
  if (Array.isArray(pool.categorySpecs)) {
    for (const spec of pool.categorySpecs) {
      if (
        spec &&
        typeof spec.label === 'string' &&
        typeof spec.value === 'string' &&
        ITEM_SPEC_LABEL_RE.test(spec.label.trim())
      ) {
        itemSpecTexts.push(spec.value);
      }
    }
  }
  if (pool.category === 'Vehicles' && pool.vehicleSpecs) {
    const vs = pool.vehicleSpecs;
    for (const val of [
      vs.assetClass === 'accessory'
        ? 'accessory'
        : vs.vehicleType
          ? getVehicleTypeLabel(vs.vehicleType, true)
          : undefined,
      vs.make,
      vs.model,
      formatYearRequirement(vs),
      vs.trim,
      vs.powertrain,
      vs.drivetrain,
      vs.transmission,
      vs.bodyConfiguration,
      vs.axleConfiguration,
      vs.cabOrSleeper,
      vs.busType,
      vs.accessibilityRequirement,
    ]) {
      if (typeof val === 'string' && val.trim()) {
        itemSpecTexts.push(val.trim());
      }
    }
  }

  const fullItemText = [pool.title, ...allowedOptionTexts, ...itemSpecTexts].join(' ');
  return {
    titleText: pool.title,
    allowedOptionTexts,
    excludedOptionTexts,
    itemSpecTexts,
    fullItemText,
  };
}

function collectQueryStructuredItemText(input: SimilarPoolQueryInput): {
  titleText: string;
  variantTexts: string[];
  fullItemText: string;
} {
  const variantTexts: string[] = [];
  if (typeof input.modelOrVariant === 'string' && input.modelOrVariant.trim()) {
    variantTexts.push(input.modelOrVariant.trim());
  }
  if (Array.isArray(input.primaryOptionValues)) {
    for (const v of input.primaryOptionValues) {
      if (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'matches shared spec') {
        variantTexts.push(v.trim());
      }
    }
  }
  if (Array.isArray(input.categorySpecs)) {
    for (const spec of input.categorySpecs) {
      if (
        spec &&
        typeof spec.label === 'string' &&
        typeof spec.value === 'string' &&
        spec.value.trim() &&
        ITEM_SPEC_LABEL_RE.test(spec.label.trim())
      ) {
        variantTexts.push(spec.value.trim());
      }
    }
  }
  if (input.vehicleSpecs) {
    const vs = input.vehicleSpecs;
    for (const val of [
      vs.make,
      vs.model,
      formatYearRequirement(vs),
      vs.trim,
      vs.powertrain,
      vs.drivetrain,
      vs.transmission,
      vs.bodyConfiguration,
      vs.axleConfiguration,
      vs.cabOrSleeper,
      vs.busType,
      vs.accessibilityRequirement,
    ]) {
      if (typeof val === 'string' && val.trim()) {
        variantTexts.push(val.trim());
      }
    }
  }

  const titleText = typeof input.title === 'string' ? input.title.trim() : '';
  const fullItemText = [titleText, ...variantTexts].join(' ');
  return { titleText, variantTexts, fullItemText };
}

function getFamilyConflictDetail(
  queryTokens: Set<string>,
  poolTokens: Set<string>,
  family: ReadonlySet<string>
): { queryValues: string[]; poolValues: string[] } | null {
  const qInFamily = Array.from(queryTokens).filter((t) => family.has(t));
  const pInFamily = Array.from(poolTokens).filter((t) => family.has(t));
  if (qInFamily.length === 0 || pInFamily.length === 0) return null;
  if (qInFamily.some((t) => pInFamily.includes(t))) return null;
  return { queryValues: qInFamily, poolValues: pInFamily };
}

function getIncompatibilityReason(
  queryText: string,
  queryTokens: Set<string>,
  queryVariantTexts: string[],
  pool: Pool,
  poolStructured: ReturnType<typeof collectPoolStructuredItemText>,
  poolTokens: Set<string>,
  queryVehicleSpecs?: VehicleSpecProfile
): string | null {
  // 1. Check explicitly excluded option values on the candidate pool
  for (const excl of poolStructured.excludedOptionTexts) {
    const exclTokens = extractSubstantiveItemTokens(excl).filter((t) => !poolTokens.has(t));
    if (exclTokens.length > 0 && exclTokens.some((t) => queryTokens.has(t))) {
      return `Incompatible option — this pool explicitly excludes "${excl}".`;
    }
  }

  // 2. Category-specific structured compatibility gates
  if (pool.category === 'Vehicles') {
    const reqVeh = inferVehicleSignalsFromText(queryText, queryVehicleSpecs);
    const poolVeh = inferVehicleSignalsFromText(poolStructured.fullItemText, pool.vehicleSpecs);
    const vehCompat = evaluateVehicleCompatibility(reqVeh, poolVeh, {
      mode: 'pool_comparison',
    });
    if (!vehCompat.compatible && vehCompat.conflicts.length > 0) {
      return vehCompat.conflicts[0];
    }

    const trimConflict = getFamilyConflictDetail(queryTokens, poolTokens, VEHICLE_TRIM_FAMILY);
    if (trimConflict) {
      return `Different trim — this pool is for ${trimConflict.poolValues
        .map((v) => v.toUpperCase())
        .join('/')}, not ${trimConflict.queryValues.map((v) => v.toUpperCase()).join('/')}.`;
    }
    const powerConflict = getFamilyConflictDetail(
      queryTokens,
      poolTokens,
      VEHICLE_POWERTRAIN_FAMILY
    );
    if (powerConflict) {
      return `Different powertrain — this pool requires ${powerConflict.poolValues.join(
        '/'
      )}, not ${powerConflict.queryValues.join('/')}.`;
    }
    const driveConflict = getFamilyConflictDetail(
      queryTokens,
      poolTokens,
      VEHICLE_DRIVETRAIN_FAMILY
    );
    if (driveConflict) {
      return `Different drivetrain — this pool requires ${driveConflict.poolValues
        .map((v) => v.toUpperCase())
        .join('/')}, not ${driveConflict.queryValues.map((v) => v.toUpperCase()).join('/')}.`;
    }
  }

  if (pool.category === 'Apartments') {
    const qSize = extractApartmentUnitSize(queryText);
    const pSize = extractApartmentUnitSize(poolStructured.fullItemText);
    if (qSize && pSize && qSize !== pSize) {
      const formatSize = (s: string) =>
        s === 'studio' ? 'Studio' : s.replace('br', ' Bedroom');
      return `Different unit size — this pool covers ${formatSize(
        pSize
      )}, not ${formatSize(qSize)}.`;
    }
  }

  // 3. Explicit hyphenated SKU mismatch when both sides provide a structured SKU code
  const querySkus = extractSkuCodes([queryText, ...queryVariantTexts]);
  const poolSkus = extractSkuCodes([
    poolStructured.titleText,
    ...poolStructured.allowedOptionTexts,
    ...poolStructured.itemSpecTexts,
  ]);
  if (querySkus.size > 0 && poolSkus.size > 0) {
    const hasOverlap = Array.from(querySkus).some((code) => poolSkus.has(code));
    if (!hasOverlap) {
      return `Different item SKU — this pool specifies ${Array.from(poolSkus)
        .map((s) => s.toUpperCase())
        .join(', ')}, not ${Array.from(querySkus)
        .map((s) => s.toUpperCase())
        .join(', ')}.`;
    }
  }

  // 4. Explicit model year mismatch when buyer requests a year and pool scope excludes it
  const queryYears = extractModelYears(queryText);
  const poolYears = extractPoolModelYears(pool, poolStructured.itemSpecTexts);
  if (queryYears.size > 0 && poolYears.size > 0) {
    const sharesYear = Array.from(queryYears).some((y) => poolYears.has(y));
    if (!sharesYear) {
      return `Model year differs (${Array.from(poolYears).join('/')} vs ${Array.from(
        queryYears
      ).join('/')}) — this pool is scoped to ${Array.from(poolYears).join(
        '/'
      )}, not ${Array.from(queryYears).join('/')}.`;
    }
  }

  return null;
}

function evaluateLocationFit(
  queryLocation: string | undefined,
  poolLocation: string
): { fit: 'match' | 'nationwide' | 'different' | 'unspecified'; reason?: string; diff?: string } {
  const cleanQuery = (queryLocation ?? '').trim();
  if (!cleanQuery) {
    return { fit: 'unspecified' };
  }

  const qTokens = normalizeMatchTokens(cleanQuery);
  const pTokens = normalizeMatchTokens(poolLocation || '');
  if (qTokens.length === 0) return { fit: 'unspecified' };

  const poolIsNationwide =
    pTokens.includes('nationwide') ||
    (pTokens.includes('ships') && pTokens.includes('nationwide'));
  const queryIsNationwide = qTokens.includes('nationwide');

  // Remove generic trailing qualifier "metro" or "area" when comparing city names cleanly
  const stripAreaQualifiers = (tokens: string[]) =>
    tokens.filter((t) => t !== 'metro' && t !== 'area' && t !== 'pickup' && t !== 'delivery');
  const qCityTokens = stripAreaQualifiers(qTokens);
  const pCityTokens = stripAreaQualifiers(pTokens);

  const directMatch =
    containsContiguousTokens(pTokens, qTokens) ||
    containsContiguousTokens(qTokens, pTokens) ||
    (qCityTokens.length > 0 &&
      pCityTokens.length > 0 &&
      (containsContiguousTokens(pCityTokens, qCityTokens) ||
        containsContiguousTokens(qCityTokens, pCityTokens)));

  if (directMatch) {
    return {
      fit: 'match',
      reason: `Same area (${poolLocation})`,
    };
  }

  if (poolIsNationwide || queryIsNationwide) {
    return {
      fit: 'nationwide',
      reason: `Ships nationwide (${poolLocation})`,
      diff:
        !queryIsNationwide && poolIsNationwide
          ? `Ships nationwide rather than local ${cleanQuery}`
          : undefined,
    };
  }

  return {
    fit: 'different',
    diff: `Location differs (${poolLocation} vs ${cleanQuery})`,
  };
}

function calendarDateToUtcDayMs(dateStr: string): number | null {
  const normalized = normalizeCalendarDate(dateStr);
  if (!normalized) return null;
  const [y, m, d] = normalized.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatCalendarShort(dateStr: string): string {
  const normalized = normalizeCalendarDate(dateStr);
  if (!normalized) return dateStr;
  const [y, m, d] = normalized.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
}

function evaluateTimingFit(
  queryGoalDate: string | undefined,
  pool: Pool
): {
  fit: 'close' | 'moderate' | 'far' | 'unspecified';
  deltaDays: number | null;
  reason?: string;
  diff?: string;
} {
  if (!queryGoalDate) return { fit: 'unspecified', deltaDays: null };
  const qMs = calendarDateToUtcDayMs(queryGoalDate);
  const pDateStr = pool.currentOffer?.claimByDate || pool.goalDate;
  const pMs = calendarDateToUtcDayMs(pDateStr);
  if (qMs === null || pMs === null) return { fit: 'unspecified', deltaDays: null };

  const deltaDays = Math.round((pMs - qMs) / (24 * 60 * 60 * 1000));
  const absDays = Math.abs(deltaDays);

  if (absDays <= 7) {
    return {
      fit: 'close',
      deltaDays,
      reason:
        absDays === 0
          ? `Same target date (${formatCalendarShort(pDateStr)})`
          : `Timing aligns closely (${absDays} ${absDays === 1 ? 'day' : 'days'} ${
              deltaDays > 0 ? 'later' : 'earlier'
            })`,
    };
  }
  if (absDays <= 21) {
    return {
      fit: 'moderate',
      deltaDays,
      reason: `Within 3 weeks of your target (${formatCalendarShort(pDateStr)})`,
    };
  }
  return {
    fit: 'far',
    deltaDays,
    diff: `Target timing differs by ${absDays} days (${formatCalendarShort(pDateStr)} vs ${formatCalendarShort(
      queryGoalDate
    )})`,
  };
}

function buildQuoteSummary(pool: Pool): SimilarPoolQuoteSummary {
  const offer = pool.currentOffer;
  if (!offer) {
    return {
      hasQuote: false,
      statusLabel: 'No quote published yet',
    };
  }
  const quoteCompat = evaluateQuoteCompatibility(pool, offer);
  return {
    hasQuote: true,
    statusLabel: `Seller quote v${offer.version} published`,
    version: offer.version,
    sellerName: offer.sellerName,
    sellerLocation: offer.sellerLocation,
    unitPrice: offer.unitPrice,
    knownFees: offer.knownFees,
    knownFeesUnknown: offer.knownFeesUnknown,
    feeLabel: offer.feeLabel,
    subtotal: offer.subtotal,
    minQuantity: offer.minQuantity,
    maxQuantity: offer.maxQuantity,
    matchingScope: offer.matchingScope,
    fulfillmentMethod: offer.fulfillmentMethod,
    taxAndRegistrationNote: offer.taxAndRegistrationNote,
    closeAt: offer.closeAt,
    timezoneLabel: offer.timezoneLabel,
    claimByDate: offer.claimByDate,
    hasSpecConflicts: !quoteCompat.compatible,
    specConflicts: quoteCompat.conflicts.length > 0 ? quoteCompat.conflicts : undefined,
  };
}

function classifyAvailability(stage: PoolMetrics['effectiveStage']): SimilarPoolAvailability {
  if (stage === 'gathering' || stage === 'ready_for_quote' || stage === 'quote_requested') {
    return 'joinable';
  }
  if (stage === 'offer_open') {
    return 'offer_review_only';
  }
  if (stage === 'unlocked') {
    return 'unlocked';
  }
  return 'ended';
}

function matchLevelOrder(level: SimilarPoolMatchLevel): number {
  switch (level) {
    case 'strong_match':
      return 3;
    case 'same_item_different_terms':
      return 2;
    case 'possible_match':
      return 1;
  }
}

function availabilityOrder(avail: SimilarPoolAvailability): number {
  switch (avail) {
    case 'joinable':
    case 'offer_review_only':
      return 2;
    case 'unlocked':
      return 1;
    case 'ended':
      return 0;
  }
}

function evaluateSpecVerification(
  queryStructured: { titleText: string; variantTexts: string[]; fullItemText: string },
  queryTerms: string[],
  queryTermSet: Set<string>,
  queryYears: Set<string>,
  rawPool: Pool,
  poolStructured: {
    titleText: string;
    allowedOptionTexts: string[];
    excludedOptionTexts: string[];
    itemSpecTexts: string[];
    fullItemText: string;
  },
  poolTermSet: Set<string>,
  matchedTitleTerms: string[],
  poolTitleTerms: string[],
  queryVehicleSpecs?: VehicleSpecProfile
): {
  specFit: 'verified' | 'unverified';
  verifiedReasons: string[];
  unverifiedNotes: string[];
} {
  const verifiedReasons: string[] = [];
  const unverifiedNotes: string[] = [];
  let specFit: 'verified' | 'unverified' = 'verified';

  const poolTitleCoverage =
    poolTitleTerms.length > 0 ? matchedTitleTerms.length / poolTitleTerms.length : 0;

  const requiredNonDeliveryGroups = (rawPool.optionGroups ?? []).filter(
    (g) => g.id !== 'delivery' && g.required && (g.allowedValues?.length ?? 0) > 0
  );

  // 1. Vehicle specs verification (unified compatibility + trim/powertrain/drivetrain/commercial specs)
  if (rawPool.category === 'Vehicles') {
    const reqVeh = inferVehicleSignalsFromText(queryStructured.fullItemText, queryVehicleSpecs);
    const poolVeh = inferVehicleSignalsFromText(poolStructured.fullItemText, rawPool.vehicleSpecs);
    const vehCompat = evaluateVehicleCompatibility(reqVeh, poolVeh, { mode: 'pool_comparison' });

    for (const reason of vehCompat.verifiedMatches) {
      if (!verifiedReasons.includes(reason)) verifiedReasons.push(reason);
    }

    for (const note of vehCompat.unverifiedFields) {
      // Soft reminders (condition/year omitted in free-text search) appear in unspecifiedChecks;
      // core spec omissions (vehicleType, axle, cab, trailer, bus seating/ADA, capacities, mileage, or explicit queryVehicleSpecs gaps)
      // downgrade specFit to 'unverified' so missing specs never look like an assumed exact fit.
      const isSoftTextReminder =
        !queryVehicleSpecs &&
        (/Condition is /i.test(note) || /Model year /i.test(note));
      if (!unverifiedNotes.includes(note)) {
        unverifiedNotes.push(note);
      }
      if (!isSoftTextReminder) {
        specFit = 'unverified';
      }
    }

    const families: { name: string; set: ReadonlySet<string> }[] = [
      { name: 'trim', set: VEHICLE_TRIM_FAMILY },
      { name: 'powertrain', set: VEHICLE_POWERTRAIN_FAMILY },
      { name: 'drivetrain', set: VEHICLE_DRIVETRAIN_FAMILY },
    ];
    const missingFamilies: string[] = [];
    const matchedFamilies: string[] = [];
    for (const fam of families) {
      const poolVals = Array.from(poolTermSet).filter((t) => fam.set.has(t));
      if (poolVals.length === 0) continue;
      const queryVals = Array.from(queryTermSet).filter((t) => fam.set.has(t));
      if (queryVals.length === 0) {
        missingFamilies.push(fam.name);
      } else {
        matchedFamilies.push(fam.name);
      }
    }

    if (missingFamilies.length > 0) {
      specFit = 'unverified';
      const trimGroup = requiredNonDeliveryGroups[0];
      const expectedSpec = trimGroup
        ? trimGroup.allowedValues.join(', ')
        : rawPool.title;
      unverifiedNotes.push(
        `Specs not specified (${missingFamilies.join(', ')}) — verify ${expectedSpec}`
      );
    } else if (matchedFamilies.length > 0) {
      verifiedReasons.push(`Verified vehicle specs (${matchedFamilies.join(', ')})`);
    }
  }

  // 2. Apartment unit size verification
  if (rawPool.category === 'Apartments') {
    const poolSize = extractApartmentUnitSize(poolStructured.fullItemText);
    const querySize = extractApartmentUnitSize(queryStructured.fullItemText);
    if (poolSize && !querySize) {
      specFit = 'unverified';
      const sizeGroup = requiredNonDeliveryGroups.find((g) => /size|unit|bed/i.test(g.label));
      const expectedSize = sizeGroup ? sizeGroup.allowedValues.join(', ') : poolSize.toUpperCase();
      unverifiedNotes.push(`Unit size not specified — verify ${expectedSize}`);
    } else if (poolSize && querySize && poolSize === querySize) {
      verifiedReasons.push('Verified apartment unit size');
    }
  }

  // 3. Explicit SKU verification when pool specifies a structured SKU
  const poolSkus = extractSkuCodes([
    ...poolStructured.allowedOptionTexts,
    ...poolStructured.itemSpecTexts,
    poolStructured.titleText,
  ]);
  const querySkus = extractSkuCodes([queryStructured.titleText, ...queryStructured.variantTexts]);
  if (poolSkus.size > 0) {
    if (querySkus.size > 0) {
      verifiedReasons.push('Verified item SKU');
    } else if (poolTitleCoverage < 0.75) {
      specFit = 'unverified';
      unverifiedNotes.push('Item SKU/variant not specified — verify exact model before joining');
    }
  }

  // 4. General required option & broad-query specificity check (for non-Vehicles/Apartments or custom pools)
  if (specFit === 'verified' && rawPool.category !== 'Vehicles' && rawPool.category !== 'Apartments') {
    for (const group of requiredNonDeliveryGroups) {
      const groupTokens = extractSubstantiveItemTokens(group.allowedValues.join(' '));
      if (groupTokens.length === 0) continue;
      const matchedAnyOption = groupTokens.some((t) => queryTermSet.has(t));
      if (!matchedAnyOption && poolTitleCoverage < 0.75) {
        specFit = 'unverified';
        unverifiedNotes.push(
          `${group.label} not specified — verify ${group.allowedValues.join(', ')}`
        );
      }
    }
  }

  if (
    specFit === 'verified' &&
    queryTerms.length <= 2 &&
    poolTitleTerms.length >= 4 &&
    poolTitleCoverage < 0.6
  ) {
    specFit = 'unverified';
    unverifiedNotes.push('Broad search — verify exact model, variant, and options before joining');
  }

  // 5. Model year omitted when the pool explicitly targets a specific year
  const poolYears = extractPoolModelYears(rawPool, poolStructured.itemSpecTexts);
  if (poolYears.size > 0 && queryYears.size === 0) {
    unverifiedNotes.push(`Model year not specified (pool targets ${Array.from(poolYears).join('/')})`);
  }

  return { specFit, verifiedReasons, unverifiedNotes };
}

/**
 * Finds and ranks credible competing/similar pools inside the current demo session,
 * sanitized strictly for the active viewer role and identity.
 */
export function findSimilarPoolsInSession(
  state: DemoSessionState,
  role: PersonaRole,
  actorId: string,
  input: SimilarPoolQueryInput
): SimilarPoolCandidate[] {
  const category =
    input.category && VALID_CATEGORY_SET.has(input.category)
      ? (input.category as PoolCategory)
      : undefined;

  const queryStructured = collectQueryStructuredItemText(input);
  if (normalizeMatchTokens(queryStructured.fullItemText).length === 0) {
    return [];
  }

  const queryTerms = extractSubstantiveItemTokens(queryStructured.fullItemText);
  const queryTermSet = new Set(queryTerms);
  const queryYears = extractModelYears(queryStructured.fullItemText);
  const includeUnavailable = input.includeUnavailable !== false;
  const corroboratedTokens = buildCorroboratedTokenSet(state.pools);

  const candidates: SimilarPoolCandidate[] = [];

  for (const rawPool of state.pools) {
    if (input.excludePoolId && rawPool.id === input.excludePoolId) continue;

    // Gate 1: Category eligibility gate when category is specified
    if (category && rawPool.category !== category) continue;

    const metrics = computePoolMetrics(rawPool, state.demoNow);
    const availability = classifyAvailability(metrics.effectiveStage);
    if (!includeUnavailable && (availability === 'unlocked' || availability === 'ended')) {
      continue;
    }

    const poolStructured = collectPoolStructuredItemText(rawPool);
    const poolTerms = extractSubstantiveItemTokens(poolStructured.fullItemText);
    const poolTermSet = new Set(poolTerms);
    if (poolTerms.length === 0) continue;

    // Gate 2: Incompatible model / year / variant / SKU / excluded option gate (strictly exact)
    if (
      getIncompatibilityReason(
        queryStructured.fullItemText,
        queryTermSet,
        queryStructured.variantTexts,
        rawPool,
        poolStructured,
        poolTermSet,
        input.vehicleSpecs
      ) !== null
    ) {
      continue;
    }

    const corpus = buildPoolStructuredCorpus(
      rawPool,
      poolStructured.allowedOptionTexts,
      poolStructured.itemSpecTexts
    );
    const matchResult = matchStructuredQueryToPool(queryStructured.fullItemText, corpus, {
      corroboratedTokens,
    });
    if (!matchResult.matched) continue;

    const matchedTerms = matchResult.matchedTerms;
    const queryCoverage = matchResult.queryCoverage;
    const poolTitleTerms = extractSubstantiveItemTokens(poolStructured.titleText);
    const matchedTitleTerms = matchResult.details
      .filter((d) => d.inTitle)
      .map((d) => d.canonicalTerm);

    const locationEval = evaluateLocationFit(input.location, rawPool.location);
    const timingEval = evaluateTimingFit(input.goalDate, rawPool);

    const specEval = evaluateSpecVerification(
      queryStructured,
      queryTerms.length > 0 ? queryTerms : matchedTerms,
      queryTermSet,
      queryYears,
      rawPool,
      poolStructured,
      poolTermSet,
      matchedTitleTerms,
      poolTitleTerms,
      input.vehicleSpecs
    );

    const unspecifiedChecks: string[] = [];
    if (!category) {
      unspecifiedChecks.push(`Category not specified (pool is in ${rawPool.category})`);
    }
    unspecifiedChecks.push(...specEval.unverifiedNotes);
    if (locationEval.fit === 'unspecified') {
      unspecifiedChecks.push(`Location not specified (pool is in ${rawPool.location})`);
    }
    if (timingEval.fit === 'unspecified') {
      unspecifiedChecks.push(
        `Purchase timing not specified (target ${formatCalendarShort(rawPool.goalDate)})`
      );
    }

    const isApproximateMatch = matchResult.isApproximate;

    // Approximate spelling/spacing/abbreviation/synonym matches are ALWAYS possible_match — never strong_match
    const isUncertainItemMatch =
      isApproximateMatch ||
      matchResult.totalQueryUnits === 1 ||
      queryCoverage < 0.75 ||
      specEval.specFit === 'unverified';

    const hasLocationOrTimingMismatch =
      locationEval.fit === 'different' || timingEval.fit === 'far';

    const isUnavailablePool = availability === 'unlocked' || availability === 'ended';

    let matchLevel: SimilarPoolMatchLevel;
    let matchLabel: string;
    if (isUnavailablePool) {
      matchLevel = isUncertainItemMatch ? 'possible_match' : 'same_item_different_terms';
      matchLabel = isUncertainItemMatch
        ? 'Possible match · no longer open'
        : 'Same item · no longer open';
    } else if (isApproximateMatch) {
      matchLevel = 'possible_match';
      matchLabel =
        specEval.specFit === 'unverified'
          ? 'Possible match · approximate text & verify specs'
          : 'Possible match · approximate text match';
    } else if (isUncertainItemMatch) {
      matchLevel = 'possible_match';
      matchLabel = 'Possible match · verify specs';
    } else if (hasLocationOrTimingMismatch) {
      matchLevel = 'same_item_different_terms';
      matchLabel = 'Same item · check location or timing';
    } else {
      matchLevel = 'strong_match';
      matchLabel =
        unspecifiedChecks.length > 0
          ? 'Strong item match · check unspecified details'
          : 'Strong match';
    }

    // Verified match evidence ONLY — never list unspecified criteria or approximate guesses as verified
    const matchReasons: string[] = [];
    if (category) {
      matchReasons.push(`Same category (${rawPool.category})`);
    }
    if (matchResult.exactMatchedTerms.length > 0) {
      matchReasons.push(`Matched item terms: ${matchResult.exactMatchedTerms.join(', ')}`);
    }
    matchReasons.push(...specEval.verifiedReasons);
    if (locationEval.reason) matchReasons.push(locationEval.reason);
    if (timingEval.reason) matchReasons.push(timingEval.reason);

    // Verified mismatches / pool availability constraints ONLY
    const differences: string[] = [];
    if (locationEval.diff) differences.push(locationEval.diff);
    if (timingEval.diff) differences.push(timingEval.diff);
    if (matchResult.totalQueryUnits === 1 && !isApproximateMatch) {
      differences.push('Single-term search — narrow to model and variant before joining');
    } else if (queryCoverage < 0.75 && matchResult.unmatchedTerms.length > 0) {
      differences.push(`Pool does not list: ${matchResult.unmatchedTerms.join(', ')}`);
    }
    if (availability === 'unlocked') {
      differences.push('Group price already unlocked — closed to new buyers');
    } else if (availability === 'ended') {
      differences.push(
        metrics.effectiveStage === 'expired'
          ? 'Offer expired short of minimum — no longer accepting joins'
          : 'Completed cohort — no longer accepting new buyers'
      );
    }

    // Build clean suggestion against user's title query (only when backed by a reliable correction source)
    let suggestedQuery: string | undefined;
    if (isApproximateMatch && queryStructured.titleText) {
      const titleMatch = matchStructuredQueryToPool(queryStructured.titleText, corpus, {
        corroboratedTokens,
      });
      suggestedQuery = titleMatch.suggestedQuery ?? matchResult.suggestedQuery;
    }

    // Deterministic ranking score: exact normalized matches strictly outrank approximate matches
    let score = 0;
    score += availabilityOrder(availability) * 120;
    score += isApproximateMatch ? 0 : 45;
    score += matchLevelOrder(matchLevel) * 40;
    score += Math.round(queryCoverage * 25);
    score += matchResult.exactTermCount * 6;
    const totalEditDistance = matchResult.details.reduce((acc, d) => acc + (d.editDistance ?? 0), 0);
    score -= totalEditDistance * 5;
    if (specEval.specFit === 'verified') score += 15;
    if (locationEval.fit === 'match') score += 30;
    else if (locationEval.fit === 'nationwide') score += 15;
    if (timingEval.fit === 'close') score += 20;
    else if (timingEval.fit === 'moderate') score += 12;
    else if (timingEval.fit === 'far') score += 2;
    if (rawPool.currentOffer && !isUnavailablePool) score += 12;
    else if (metrics.effectiveStage === 'ready_for_quote') score += 8;

    const progressDenom = Math.max(1, metrics.targetMin);
    const activeProgress =
      metrics.effectiveStage === 'offer_open' ||
      metrics.effectiveStage === 'unlocked' ||
      metrics.effectiveStage === 'expired'
        ? metrics.confirmedUnits
        : metrics.eligibleInterestedUnits;
    score += Math.min(10, Math.round((activeProgress / progressDenom) * 10));

    const sanitizedPool = sanitizePoolForRole(rawPool, role, actorId, state.demoNow);
    const alreadyMember = rawPool.members.some((m) => m.userId === actorId);
    const alreadyOrganizer = rawPool.organizerId === actorId;
    const canQuickJoin =
      role !== 'seller' &&
      availability === 'joinable' &&
      !alreadyMember;

    candidates.push({
      pool: { ...sanitizedPool, metrics },
      matchLevel,
      matchLabel,
      score,
      matchedTerms,
      matchReasons,
      differences,
      unspecifiedChecks,
      specFit: specEval.specFit,
      isApproximateMatch,
      approximateInterpretations: matchResult.approximateInterpretations,
      suggestedQuery,
      locationFit: locationEval.fit,
      timingFit: timingEval.fit,
      timingDeltaDays: timingEval.deltaDays,
      availability,
      canQuickJoin,
      alreadyMember,
      alreadyOrganizer,
      quoteSummary: buildQuoteSummary(sanitizedPool),
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.pool.id.localeCompare(b.pool.id);
  });

  return candidates;
}

/**
 * Surfaces same-category pools that share the core item terms but failed the strict
 * variant/trim/option/SKU gate — strictly labeled as "Reference only" so buyers understand
 * why an existing pool was NOT merged with their specs without weakening matching gates.
 */
export function findReferenceOnlyPoolsInSession(
  state: DemoSessionState,
  role: PersonaRole,
  actorId: string,
  input: SimilarPoolQueryInput
): SimilarPoolReference[] {
  const category =
    input.category && VALID_CATEGORY_SET.has(input.category)
      ? (input.category as PoolCategory)
      : undefined;

  const queryStructured = collectQueryStructuredItemText(input);
  if (normalizeMatchTokens(queryStructured.fullItemText).length === 0) return [];

  const queryTerms = extractSubstantiveItemTokens(queryStructured.fullItemText);
  const queryTermSet = new Set(queryTerms);
  const references: SimilarPoolReference[] = [];

  for (const rawPool of state.pools) {
    if (input.excludePoolId && rawPool.id === input.excludePoolId) continue;
    // Never cross category boundaries even for reference-only pools
    if (category && rawPool.category !== category) continue;

    const poolStructured = collectPoolStructuredItemText(rawPool);
    const poolTerms = extractSubstantiveItemTokens(poolStructured.fullItemText);
    const poolTermSet = new Set(poolTerms);
    if (poolTerms.length === 0) continue;

    const incompatibilityReason = getIncompatibilityReason(
      queryStructured.fullItemText,
      queryTermSet,
      queryStructured.variantTexts,
      rawPool,
      poolStructured,
      poolTermSet,
      input.vehicleSpecs
    );
    if (!incompatibilityReason) continue;

    // Require strong core-item overlap in the pool title (also tolerating typos/spacing on the core item name)
    const corpus = buildPoolStructuredCorpus(
      rawPool,
      poolStructured.allowedOptionTexts,
      poolStructured.itemSpecTexts
    );
    const matchResult = matchStructuredQueryToPool(queryStructured.fullItemText, corpus);
    const hasSingleSpecificModelMatch =
      matchResult.matched &&
      matchResult.matchedTitleUnitCount === 1 &&
      matchResult.totalQueryUnits === 1 &&
      (matchResult.details[0]?.canonicalTerm.length ?? 0) >= 6;
    if (matchResult.matchedTitleUnitCount < 2 && !hasSingleSpecificModelMatch) continue;

    const metrics = computePoolMetrics(rawPool, state.demoNow);
    const sanitizedPool = sanitizePoolForRole(rawPool, role, actorId, state.demoNow);

    references.push({
      pool: { ...sanitizedPool, metrics },
      referenceKind: 'incompatible_variant',
      reasonLabel: 'Reference only · Incompatible variant',
      explanation: `${incompatibilityReason} Cannot be joined for your requested specs.`,
      quoteSummary: buildQuoteSummary(sanitizedPool),
    });
  }

  return references.sort((a, b) => a.pool.id.localeCompare(b.pool.id));
}

/**
 * Helper to derive a SimilarPoolQueryInput directly from an existing pool
 * (for comparing same-item pools from Explore or Pool Detail).
 */
export function buildQueryFromPool(pool: Pool): SimilarPoolQueryInput {
  const primaryAllowed = (pool.optionGroups ?? [])
    .filter((g) => g.id !== 'delivery' && g.required)
    .flatMap((g) => g.allowedValues ?? []);
  return {
    category: pool.category,
    title: pool.title,
    location: pool.location,
    goalDate: pool.goalDate,
    primaryOptionValues: primaryAllowed,
    categorySpecs: pool.categorySpecs,
    vehicleSpecs: pool.vehicleSpecs,
    excludePoolId: pool.id,
    includeUnavailable: true,
  };
}

/**
 * Builds a map of poolId -> count of other same-item pools in the current session,
 * so Explore and Pool Detail can surface "Compare N similar" only when real competing pools exist.
 */
export function findCompetingPoolCounts(
  pools: Pool[],
  demoNow: string
): Record<string, number> {
  const counts: Record<string, number> = {};
  if (pools.length < 2) return counts;

  const syntheticState: DemoSessionState = {
    sessionId: 'compare-scan',
    scenarioId: 'gathering-7-of-8',
    demoNow,
    pools,
    activity: [],
    alerts: [],
    notifications: [],
    createdAt: demoNow,
    updatedAt: demoNow,
  };

  for (const pool of pools) {
    const matches = findSimilarPoolsInSession(
      syntheticState,
      'buyer',
      '',
      buildQueryFromPool(pool)
    );
    if (matches.length > 0) {
      counts[pool.id] = matches.length;
    }
  }
  return counts;
}
