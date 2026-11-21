import { containsContiguousTokens, normalizeMatchTokens } from './alertsEngine.ts';
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
  type PoolSpecField,
  type SimilarPoolAvailability,
  type SimilarPoolCandidate,
  type SimilarPoolMatchLevel,
  type SimilarPoolQueryInput,
  type SimilarPoolQuoteSummary,
} from './types.ts';

const VALID_CATEGORY_SET = new Set<string>(POOL_CATEGORIES);

// Vague, boilerplate, and category-generic words that must NEVER drive a same-item match on their own
const GENERIC_NOISE_TOKENS = new Set<string>([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'for',
  'in',
  'on',
  'to',
  'with',
  'by',
  'at',
  'from',
  'group',
  'buy',
  'buying',
  'pool',
  'pools',
  'order',
  'orders',
  'bulk',
  'deal',
  'deals',
  'cohort',
  'block',
  'local',
  'neighborhood',
  'community',
  'shared',
  'set',
  'pack',
  'bundle',
  'unit',
  'units',
  'item',
  'items',
  'new',
  'standard',
  'custom',
  'clean',
  'direct',
  'pickup',
  'delivery',
  'shipping',
  'ships',
  'nationwide',
  'metro',
  'area',
  'city',
  'home',
  'homes',
  'room',
  'rooms',
  'vehicle',
  'vehicles',
  'household',
  'households',
  'copy',
  'copies',
  'furniture',
  'other',
  'install',
  'installation',
  'lease',
  'weekend',
  'month',
  'months',
  'year',
  'spec',
  'specification',
  'matches',
  'solid',
  'modern',
  'winter',
  'summer',
  'spring',
  'fall',
]);

const YEAR_TOKEN_RE = /^(19|20)\d{2}$/;

// Only item-identifying structured spec labels are indexed (never pickup/delivery/area/price/outcome)
const ITEM_SPEC_LABEL_RE =
  /^(model|trim|sku|edition|condition|unit size|room type|connector|finish|size|variant|spec)/i;

// Structured mutually exclusive variant families for deterministic eligibility gating
const VEHICLE_TRIM_FAMILY = new Set([
  'xl',
  'xlt',
  'lariat',
  'tremor',
  'lobo',
  'le',
  'xle',
  'se',
  'xse',
  'limited',
  'platinum',
  'touring',
  'sport',
  'base',
  'pro',
  'rs',
  'gt',
  'sel',
  'ex',
  'lx',
]);

const VEHICLE_POWERTRAIN_FAMILY = new Set([
  'hybrid',
  'ecoboost',
  'phev',
  'bev',
  'diesel',
  'electric',
]);

const VEHICLE_DRIVETRAIN_FAMILY = new Set(['awd', 'fwd', 'rwd', '4wd', '2wd']);

const EXPLICIT_SKU_TOKEN_RE = /^[a-z]{2,}-[a-z0-9-]*\d[a-z0-9-]*$/;

function extractModelYears(text: string): Set<string> {
  const years = new Set<string>();
  for (const tok of normalizeMatchTokens(text)) {
    if (YEAR_TOKEN_RE.test(tok)) {
      years.add(tok);
    }
  }
  return years;
}

/**
 * Extracts substantive whole-word item tokens (excluding stopwords, boilerplate words,
 * standalone 4-digit years, and single-character noise).
 */
export function extractSubstantiveItemTokens(text: string): string[] {
  const raw = normalizeMatchTokens(text);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of raw) {
    if (GENERIC_NOISE_TOKENS.has(tok)) continue;
    if (YEAR_TOKEN_RE.test(tok)) continue;
    // Allow meaningful short alphanumeric codes like "1br", "2br", "4lp", "48a", "v2", "xl", "ev", "gt"
    const isShortAllowed =
      tok.length === 2 && (/\d/.test(tok) || ['xl', 'le', 'se', 'ex', 'lx', 'ev', 'gt', 'rs'].includes(tok));
    if (tok.length < 3 && !isShortAllowed) continue;
    if (!seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

function extractApartmentUnitSize(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/\bstudio\b/.test(normalized)) return 'studio';
  if (/\b(1\s*-?\s*bed(?:room)?|1\s*br)\b/.test(normalized)) return '1br';
  if (/\b(2\s*-?\s*bed(?:room)?|2\s*br)\b/.test(normalized)) return '2br';
  if (/\b(3\s*-?\s*bed(?:room)?|3\s*br)\b/.test(normalized)) return '3br';
  return null;
}

function extractSkuCodes(values: string[]): Set<string> {
  const codes = new Set<string>();
  for (const val of values) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]+/g, ' ');
    for (const part of cleaned.split(/\s+/)) {
      const trimmed = part.replace(/^-+|-+$/g, '');
      if (EXPLICIT_SKU_TOKEN_RE.test(trimmed)) {
        codes.add(trimmed.replace(/-/g, ''));
      }
    }
  }
  return codes;
}

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

  const titleText = typeof input.title === 'string' ? input.title.trim() : '';
  const fullItemText = [titleText, ...variantTexts].join(' ');
  return { titleText, variantTexts, fullItemText };
}

function hasFamilyConflict(
  queryTokens: Set<string>,
  poolTokens: Set<string>,
  family: Set<string>
): boolean {
  const qInFamily = Array.from(queryTokens).filter((t) => family.has(t));
  const pInFamily = Array.from(poolTokens).filter((t) => family.has(t));
  if (qInFamily.length === 0 || pInFamily.length === 0) return false;
  // Conflict if buyer specifies at least one member of the family and NONE overlap with pool's allowed set
  return !qInFamily.some((t) => pInFamily.includes(t));
}

function isIncompatibleVariant(
  queryText: string,
  queryTokens: Set<string>,
  queryVariantTexts: string[],
  pool: Pool,
  poolStructured: ReturnType<typeof collectPoolStructuredItemText>,
  poolTokens: Set<string>
): boolean {
  // 1. Check explicitly excluded option values on the candidate pool
  for (const excl of poolStructured.excludedOptionTexts) {
    const exclTokens = extractSubstantiveItemTokens(excl).filter((t) => !poolTokens.has(t));
    if (exclTokens.length > 0 && exclTokens.some((t) => queryTokens.has(t))) {
      return true;
    }
  }

  // 2. Category-specific structured compatibility gates
  if (pool.category === 'Vehicles') {
    if (hasFamilyConflict(queryTokens, poolTokens, VEHICLE_TRIM_FAMILY)) return true;
    if (hasFamilyConflict(queryTokens, poolTokens, VEHICLE_POWERTRAIN_FAMILY)) return true;
    if (hasFamilyConflict(queryTokens, poolTokens, VEHICLE_DRIVETRAIN_FAMILY)) return true;
  }

  if (pool.category === 'Apartments') {
    const qSize = extractApartmentUnitSize(queryText);
    const pSize = extractApartmentUnitSize(poolStructured.fullItemText);
    if (qSize && pSize && qSize !== pSize) return true;
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
    if (!hasOverlap) return true;
  }

  return false;
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
  return {
    hasQuote: true,
    statusLabel: `Seller quote v${offer.version} published`,
    version: offer.version,
    sellerName: offer.sellerName,
    sellerLocation: offer.sellerLocation,
    unitPrice: offer.unitPrice,
    knownFees: offer.knownFees,
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
  const queryTerms = extractSubstantiveItemTokens(queryStructured.fullItemText);
  if (queryTerms.length === 0) {
    return [];
  }

  const queryTermSet = new Set(queryTerms);
  const queryYears = extractModelYears(queryStructured.fullItemText);
  const includeUnavailable = input.includeUnavailable !== false;

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

    // Gate 2: Incompatible model / variant / excluded option gate
    if (
      isIncompatibleVariant(
        queryStructured.fullItemText,
        queryTermSet,
        queryStructured.variantTexts,
        rawPool,
        poolStructured,
        poolTermSet
      )
    ) {
      continue;
    }

    const matchedTerms = queryTerms.filter((t) => poolTermSet.has(t));
    if (matchedTerms.length === 0) continue;

    const queryCoverage = matchedTerms.length / queryTerms.length;
    const poolTitleTerms = extractSubstantiveItemTokens(poolStructured.titleText);
    const matchedTitleTerms = matchedTerms.filter((t) => poolTitleTerms.includes(t));

    // Credible item overlap gate (avoid single vague word overlap across multi-word items)
    if (queryTerms.length === 1) {
      if (matchedTerms.length < 1) continue;
    } else if (queryTerms.length === 2) {
      if (matchedTerms.length < 2) continue;
    } else {
      if (matchedTerms.length < 2 || queryCoverage < 0.6) continue;
    }

    // Must match at least one substantive term in the pool title or structured options
    if (matchedTitleTerms.length === 0 && matchedTerms.length < 2) {
      continue;
    }

    const locationEval = evaluateLocationFit(input.location, rawPool.location);
    const timingEval = evaluateTimingFit(input.goalDate, rawPool);

    // Model year comparison (soft difference -> downgrades to possible_match with clear callout)
    const poolYears = extractModelYears(poolStructured.fullItemText);
    let modelYearDiff: string | undefined;
    if (queryYears.size > 0 && poolYears.size > 0) {
      const sharesYear = Array.from(queryYears).some((y) => poolYears.has(y));
      if (!sharesYear) {
        modelYearDiff = `Model year differs (${Array.from(poolYears).join('/')} vs ${Array.from(
          queryYears
        ).join('/')})`;
      }
    }

    const isUncertainItemMatch =
      queryTerms.length === 1 ||
      queryCoverage < 0.75 ||
      Boolean(modelYearDiff);

    const hasLocationOrTimingMismatch =
      locationEval.fit === 'different' || timingEval.fit === 'far';

    const isUnavailablePool = availability === 'unlocked' || availability === 'ended';

    let matchLevel: SimilarPoolMatchLevel;
    let matchLabel: string;
    if (isUncertainItemMatch) {
      matchLevel = 'possible_match';
      matchLabel = 'Possible match · verify specs';
    } else if (hasLocationOrTimingMismatch || isUnavailablePool) {
      matchLevel = 'same_item_different_terms';
      matchLabel = isUnavailablePool
        ? 'Same item · no longer open'
        : 'Same item · check location or timing';
    } else {
      matchLevel = 'strong_match';
      matchLabel = 'Strong match';
    }

    const matchReasons: string[] = [];
    if (category) {
      matchReasons.push(`Same category (${rawPool.category})`);
    } else {
      matchReasons.push(`Category: ${rawPool.category}`);
    }
    matchReasons.push(`Matched item terms: ${matchedTerms.join(', ')}`);
    if (locationEval.reason) matchReasons.push(locationEval.reason);
    if (timingEval.reason) matchReasons.push(timingEval.reason);

    const differences: string[] = [];
    if (modelYearDiff) differences.push(modelYearDiff);
    if (locationEval.diff) differences.push(locationEval.diff);
    if (timingEval.diff) differences.push(timingEval.diff);
    if (queryTerms.length === 1) {
      differences.push('Broad single-term search — check exact model and trim before joining');
    } else if (queryCoverage < 0.75) {
      const unmatched = queryTerms.filter((t) => !poolTermSet.has(t));
      if (unmatched.length > 0) {
        differences.push(`Pool does not list: ${unmatched.join(', ')}`);
      }
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

    // Deterministic ranking score
    let score = 0;
    score += availabilityOrder(availability) * 100;
    score += matchLevelOrder(matchLevel) * 40;
    score += Math.round(queryCoverage * 25);
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
