import { normalizeMatchTokens } from './alertsEngine.ts';
import type {
  Pool,
  PoolCategory,
  PoolSpecField,
  VehicleCondition,
  VehicleSubType,
} from './types.ts';
import {
  evaluateVehicleCompatibility,
  formatYearRequirement,
  getVehicleTypeLabel,
  inferVehicleSignalsFromText,
  isAccessoryPool,
} from './vehicleEngine.ts';

const MAX_QUERY_CHARS = 200;
const MAX_QUERY_TOKENS = 16;
const MAX_FIELD_TOKENS = 48;
const MAX_FUZZY_TOKEN_LEN = 32;

export const YEAR_TOKEN_RE = /^(19|20)\d{2}$/;
export const EXPLICIT_SKU_TOKEN_RE = /^[a-z]{2,}-[a-z0-9-]*\d[a-z0-9-]*$/;

// Only item-identifying structured spec labels are indexed (never pickup/delivery/area/price/outcome)
export const ITEM_SPEC_LABEL_RE =
  /^(model|trim|sku|edition|condition|unit size|room type|connector|finish|size|variant|spec)/i;

// Vague, boilerplate, and category-generic words that must NEVER drive a same-item match on their own
export const GENERIC_NOISE_TOKENS: ReadonlySet<string> = new Set([
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

// Structured mutually exclusive variant families — NEVER fuzzy-matched across values
export const VEHICLE_TRIM_FAMILY: ReadonlySet<string> = new Set([
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

export const VEHICLE_POWERTRAIN_FAMILY: ReadonlySet<string> = new Set([
  'hybrid',
  'ecoboost',
  'phev',
  'bev',
  'diesel',
  'electric',
]);

export const VEHICLE_DRIVETRAIN_FAMILY: ReadonlySet<string> = new Set([
  'awd',
  'fwd',
  'rwd',
  '4wd',
  '2wd',
]);

const PROTECTED_SIZE_AND_SPEC_WORDS: ReadonlySet<string> = new Set([
  'studio',
  'king',
  'queen',
  'twin',
  'full',
  'double',
  'single',
  'gas',
  'ev',
]);

const ALLOWED_SHORT_SUBSTANTIVE = new Set([
  'xl',
  'le',
  'se',
  'ex',
  'lx',
  'ev',
  'gt',
  'rs',
  'tv',
  'lp',
]);

// Regional spelling variants treated as exact normalized equivalence
const SPELLING_VARIANT_CANONICAL: Record<string, string> = {
  grey: 'gray',
  colour: 'color',
  colours: 'colors',
  aluminium: 'aluminum',
  tyre: 'tire',
  tyres: 'tires',
};

// Curated bidirectional, unambiguous abbreviations (never cross incompatible product classes)
const ABBREVIATION_GROUPS: readonly (readonly string[])[] = [
  ['apt', 'apartment'],
  ['bdrm', 'bedroom'],
  ['condo', 'condominium'],
  ['fridge', 'refrigerator'],
  ['tv', 'television'],
  ['pkg', 'package'],
  ['deliv', 'delivery'],
];

// Curated bidirectional, unambiguous common product synonyms
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['sofa', 'couch'],
  ['bike', 'bicycle'],
  ['bookshelf', 'bookcase'],
];

const ABBREVIATION_MAP = buildBidirectionalMap(ABBREVIATION_GROUPS);
const SYNONYM_MAP = buildBidirectionalMap(SYNONYM_GROUPS);
const CANONICAL_ABBREVIATION_EXPANSIONS: ReadonlySet<string> = new Set(
  ABBREVIATION_GROUPS.map((group) => group[group.length - 1])
);
const SCHEDULE_DATE_OPTION_LABEL_RE = /(move.?in|check.?in|check.?out|date|window|schedule)/i;

function buildBidirectionalMap(groups: readonly (readonly string[])[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < groups.length; i++) {
    const groupId = `g${i}`;
    for (const word of groups[i]) {
      map.set(word, groupId);
    }
  }
  return map;
}

const NUMBER_WORD_TO_UNIT_DIGIT: Record<string, string> = {
  '1': '1',
  one: '1',
  '2': '2',
  two: '2',
  '3': '3',
  three: '3',
};

const BEDROOM_UNIT_WORDS = new Set(['br', 'bd', 'bdr', 'bdrm', 'bed', 'beds', 'bedroom', 'bedrooms']);

export interface AnnotatedToken {
  rawNorm: string; // normalized surface phrase (e.g. "1 br", "maverik")
  display: string; // display label for explainability
  canonical: string; // canonical key (e.g. "1br", "maverick", singularized)
  singular: string; // safely singularized form
  isUnitSize: boolean;
  isProtected: boolean;
  isSubstantive: boolean;
  isYear: boolean;
}

export type TermMatchKind = 'exact' | 'abbreviation' | 'synonym' | 'split_join' | 'typo';

export interface MatchedTermDetail {
  queryDisplay: string;
  poolDisplay: string;
  canonicalTerm: string;
  kind: TermMatchKind;
  direction?: 'query_split' | 'pool_split';
  editDistance?: number;
  inTitle: boolean;
  fromCategory?: boolean;
  interpretation?: string;
}

export interface StructuredPoolMatchResult {
  matched: boolean;
  isApproximate: boolean;
  exactTermCount: number;
  approximateTermCount: number;
  totalQueryUnits: number;
  queryCoverage: number;
  matchedTitleUnitCount: number;
  poolTitleTermCount: number;
  matchedTerms: string[];
  exactMatchedTerms: string[];
  unmatchedTerms: string[];
  details: MatchedTermDetail[];
  approximateInterpretations: string[];
  suggestedQuery?: string;
}

/**
 * Safely singularizes regular English plural nouns (length >= 4, purely alphabetic, not protected)
 * without corrupting words ending in -ss, -us, -is, or model codes.
 */
export function singularizeSafe(token: string): string {
  const mapped = SPELLING_VARIANT_CANONICAL[token] ?? token;
  if (!/^[a-z]{4,}$/.test(mapped)) return mapped;
  if (
    VEHICLE_TRIM_FAMILY.has(mapped) ||
    VEHICLE_POWERTRAIN_FAMILY.has(mapped) ||
    VEHICLE_DRIVETRAIN_FAMILY.has(mapped) ||
    PROTECTED_SIZE_AND_SPEC_WORDS.has(mapped)
  ) {
    return mapped;
  }
  if (mapped.endsWith('ss') || mapped.endsWith('us') || mapped.endsWith('is')) {
    return mapped;
  }
  if (mapped.length >= 5 && mapped.endsWith('ies')) {
    return `${mapped.slice(0, -3)}y`;
  }
  if (
    mapped.length >= 5 &&
    (mapped.endsWith('ches') ||
      mapped.endsWith('shes') ||
      mapped.endsWith('xes') ||
      mapped.endsWith('zes'))
  ) {
    return mapped.slice(0, -2);
  }
  if (mapped.endsWith('ves') && mapped.length >= 6) {
    // e.g. bookshelves -> bookshelf
    return `${mapped.slice(0, -3)}f`;
  }
  if (mapped.endsWith('s')) {
    return mapped.slice(0, -1);
  }
  return mapped;
}

export function isProtectedToken(token: string): boolean {
  if (!token) return true;
  if (/\d/.test(token)) return true;
  if (VEHICLE_TRIM_FAMILY.has(token)) return true;
  if (VEHICLE_POWERTRAIN_FAMILY.has(token)) return true;
  if (VEHICLE_DRIVETRAIN_FAMILY.has(token)) return true;
  if (PROTECTED_SIZE_AND_SPEC_WORDS.has(token)) return true;
  if (GENERIC_NOISE_TOKENS.has(token)) return true;
  return false;
}

export function extractModelYears(text: string): Set<string> {
  const years = new Set<string>();
  for (const tok of normalizeMatchTokens(text.slice(0, 500))) {
    if (YEAR_TOKEN_RE.test(tok)) {
      years.add(tok);
    }
  }
  return years;
}

/**
 * Extracts explicit model years from a pool's structured item scope
 * (title, item-identifying categorySpecs, and non-schedule/non-delivery option groups).
 * Explicitly ignores move-in / check-in date option groups so lease/hotel dates are never
 * mistaken for a product model year.
 */
export function extractPoolModelYears(pool: Pool, itemSpecTexts: string[]): Set<string> {
  const optionTexts: string[] = [];
  if (Array.isArray(pool.optionGroups)) {
    for (const group of pool.optionGroups) {
      if (group.id === 'delivery' || group.id === 'moveIn') continue;
      if (SCHEDULE_DATE_OPTION_LABEL_RE.test(group.label ?? '')) continue;
      for (const val of group.allowedValues ?? []) {
        if (typeof val === 'string' && !val.toLowerCase().includes('(excluded)')) {
          optionTexts.push(val);
        }
      }
    }
  }
  return extractModelYears([pool.title, ...optionTexts, ...itemSpecTexts].join(' '));
}

/**
 * Collects substantive alphabetic tokens that appear verbatim across 2 or more distinct
 * pools' structured item fields. Used as a reliable corroboration source before suggesting
 * a spelling replacement (so a single misspelled user listing is never presented as a
 * correction of the buyer's query).
 */
export function buildCorroboratedTokenSet(pools: Pool[]): Set<string> {
  const poolCounts = new Map<string, number>();
  for (const pool of pools) {
    const { allowedOptionTexts, itemSpecTexts } = collectPoolStructuredTextsForExplore(pool);
    const tokens = extractAnnotatedTokens(
      [pool.title, ...allowedOptionTexts, ...itemSpecTexts].join(' ')
    );
    const uniqueInPool = new Set<string>();
    for (const t of tokens) {
      if (t.isSubstantive && /^[a-z]{5,}$/.test(t.singular) && !t.isProtected) {
        uniqueInPool.add(t.singular);
      }
    }
    for (const tok of uniqueInPool) {
      poolCounts.set(tok, (poolCounts.get(tok) ?? 0) + 1);
    }
  }
  const corroborated = new Set<string>();
  for (const [tok, count] of poolCounts.entries()) {
    if (count >= 2) corroborated.add(tok);
  }
  return corroborated;
}

export function extractApartmentUnitSize(text: string): string | null {
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/\bstudio\b/.test(normalized)) return 'studio';
  if (/\b(?:1|one)\s*-?\s*(?:bed(?:rooms?)?|br|bdr|bdrm|bd)\b|\b1(?:br|bd|bed)\b/.test(normalized)) {
    return '1br';
  }
  if (/\b(?:2|two)\s*-?\s*(?:bed(?:rooms?)?|br|bdr|bdrm|bd)\b|\b2(?:br|bd|bed)\b/.test(normalized)) {
    return '2br';
  }
  if (/\b(?:3|three)\s*-?\s*(?:bed(?:rooms?)?|br|bdr|bdrm|bd)\b|\b3(?:br|bd|bed)\b/.test(normalized)) {
    return '3br';
  }
  return null;
}

export function extractSkuCodes(values: string[]): Set<string> {
  const codes = new Set<string>();
  for (const val of values) {
    const cleaned = val
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, ' ');
    for (const part of cleaned.split(/\s+/)) {
      const trimmed = part.replace(/^-+|-+$/g, '');
      if (EXPLICIT_SKU_TOKEN_RE.test(trimmed)) {
        codes.add(trimmed.replace(/-/g, ''));
      }
    }
  }
  return codes;
}

/**
 * Extracts ordered, annotated tokens from text, recognizing unambiguous multi-word
 * structured concepts (1 br / 1 bedroom, all wheel drive, e-bike) while preserving
 * exact surface forms for honest explanation.
 */
export function extractAnnotatedTokens(text: string, maxTokens = MAX_FIELD_TOKENS): AnnotatedToken[] {
  const raw = normalizeMatchTokens(text.slice(0, 500)).slice(0, maxTokens);
  const out: AnnotatedToken[] = [];

  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    const next = raw[i + 1];
    const next2 = raw[i + 2];

    // 1. Multi-token drivetrain phrases ("all wheel drive" -> awd, etc.)
    if (next === 'wheel' && next2 === 'drive') {
      const driveMap: Record<string, string> = {
        all: 'awd',
        front: 'fwd',
        rear: 'rwd',
        four: '4wd',
        two: '2wd',
      };
      if (driveMap[tok]) {
        const canonical = driveMap[tok];
        const phrase = `${tok} wheel drive`;
        out.push({
          rawNorm: phrase,
          display: phrase,
          canonical,
          singular: canonical,
          isUnitSize: false,
          isProtected: true,
          isSubstantive: true,
          isYear: false,
        });
        i += 2;
        continue;
      }
    }

    // 2. Multi-token apartment unit sizes ("1 br", "1 bedroom", "one bedroom", "2 bd", etc.)
    const digit = NUMBER_WORD_TO_UNIT_DIGIT[tok];
    if (digit && next && BEDROOM_UNIT_WORDS.has(next)) {
      const canonical = `${digit}br`;
      const isFullBedroom = next === 'bedroom' || next === 'bedrooms';
      const rawNorm = isFullBedroom ? `${digit} bedroom` : `${tok} ${next}`;
      out.push({
        rawNorm,
        display: `${tok} ${next}`,
        canonical,
        singular: canonical,
        isUnitSize: true,
        isProtected: true,
        isSubstantive: true,
        isYear: false,
      });
      i += 1;
      continue;
    }

    // 3. Single-token compact apartment unit sizes ("1br", "2br", "1bed", "2bd")
    const compactUnit = tok.match(/^([123])(br|bd|bdr|bdrm|bed|bedroom)$/);
    if (compactUnit) {
      const canonical = `${compactUnit[1]}br`;
      out.push({
        rawNorm: tok,
        display: tok,
        canonical,
        singular: canonical,
        isUnitSize: true,
        isProtected: true,
        isSubstantive: true,
        isYear: false,
      });
      continue;
    }

    // 4. Hyphenated "e-bike" / "e bike" -> "ebike"
    if (tok === 'e' && (next === 'bike' || next === 'bikes')) {
      out.push({
        rawNorm: 'ebike',
        display: 'e-bike',
        canonical: 'ebike',
        singular: 'ebike',
        isUnitSize: false,
        isProtected: false,
        isSubstantive: true,
        isYear: false,
      });
      i += 1;
      continue;
    }

    const isYear = YEAR_TOKEN_RE.test(tok);
    const isUnitWord = tok === 'studio';
    const singular = singularizeSafe(tok);
    const isShortAllowed =
      tok.length === 2 && (/\d/.test(tok) || ALLOWED_SHORT_SUBSTANTIVE.has(tok));
    const isSubstantive =
      !isYear && !GENERIC_NOISE_TOKENS.has(tok) && (tok.length >= 3 || isShortAllowed);

    out.push({
      rawNorm: SPELLING_VARIANT_CANONICAL[tok] ?? tok,
      display: tok,
      canonical: singular,
      singular,
      isUnitSize: isUnitWord,
      isProtected: isProtectedToken(tok),
      isSubstantive,
      isYear,
    });
  }

  return out;
}

/**
 * Extracts substantive whole-word item tokens (compatible with competingPoolsEngine
 * while recognizing structured unit-size concepts like "1 br" -> "1br").
 */
export function extractSubstantiveItemTokens(text: string): string[] {
  const annotated = extractAnnotatedTokens(text);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of annotated) {
    if (!tok.isSubstantive) continue;
    const key = tok.isUnitSize || tok.isProtected ? tok.canonical : tok.rawNorm;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Bounded Optimal String Alignment (Damerau-Levenshtein) distance.
 * Returns `maxDist + 1` immediately when length difference exceeds `maxDist`
 * or any token exceeds `MAX_FUZZY_TOKEN_LEN`.
 */
export function damerauLevenshteinBounded(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA > MAX_FUZZY_TOKEN_LEN || lenB > MAX_FUZZY_TOKEN_LEN) return maxDist + 1;
  if (Math.abs(lenA - lenB) > maxDist) return maxDist + 1;

  const dp: number[][] = Array.from({ length: lenA + 1 }, () =>
    new Array<number>(lenB + 1).fill(0)
  );
  for (let i = 0; i <= lenA; i++) dp[i][0] = i;
  for (let j = 0; j <= lenB; j++) dp[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        val = Math.min(val, dp[i - 2][j - 2] + 1); // adjacent transposition
      }
      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }

  return dp[lenA][lenB];
}

function isPureAdjacentTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  let diffIdx = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (diffIdx === -1) {
        diffIdx = i;
      } else {
        return false;
      }
    }
    if (diffIdx === i && i + 1 < a.length && a[i] === b[i + 1] && a[i + 1] === b[i]) {
      i += 1; // skip paired swapped index
    } else if (diffIdx === i) {
      return false;
    }
  }
  return diffIdx !== -1;
}

/**
 * Strict, bounded fuzzy typo/transposition check for sufficiently long alphabetic product words.
 * Never matches protected trims/powertrains/drivetrains, numeric tokens, SKUs, or tiny tokens.
 */
export function evaluateTypoMatch(a: string, b: string): { matched: boolean; distance: number } {
  if (a === b) return { matched: false, distance: 0 };
  if (!/^[a-z]{5,}$/.test(a) || !/^[a-z]{5,}$/.test(b)) {
    return { matched: false, distance: 99 };
  }
  if (isProtectedToken(a) || isProtectedToken(b)) {
    return { matched: false, distance: 99 };
  }

  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  const maxAllowedDist = minLen >= 8 ? 2 : 1;
  const dist = damerauLevenshteinBounded(a, b, maxAllowedDist);
  if (dist > maxAllowedDist) {
    return { matched: false, distance: dist };
  }

  if (dist === 1) {
    // 5-letter equal-length words allow ONLY pure adjacent transposition (e.g. couhc <-> couch, talbe <-> table)
    // to prevent collisions like chair/chain, bench/bunch, truck/track, table/cable.
    if (a.length === 5 && b.length === 5) {
      return { matched: isPureAdjacentTransposition(a, b), distance: dist };
    }
    const sameFirst = a[0] === b[0];
    const firstTwoSwapped = a[0] === b[1] && a[1] === b[0] && a.slice(2) === b.slice(2);
    if (!sameFirst && !firstTwoSwapped) {
      return { matched: false, distance: dist };
    }
    return { matched: maxLen >= 6, distance: dist };
  }

  // dist === 2: only for long words (>= 8 chars each) with strong character anchors
  if (dist === 2 && minLen >= 8) {
    const sameFirst = a[0] === b[0];
    const hasSecondAnchor = a[1] === b[1] || a[a.length - 1] === b[b.length - 1];
    return { matched: sameFirst && hasSecondAnchor, distance: dist };
  }

  return { matched: false, distance: dist };
}

function isExactNormalizedPair(q: AnnotatedToken, p: AnnotatedToken): boolean {
  if (q.isUnitSize || p.isUnitSize) {
    return q.isUnitSize && p.isUnitSize && q.canonical === p.canonical && q.rawNorm === p.rawNorm;
  }
  if (q.isProtected || p.isProtected) {
    return q.canonical === p.canonical && q.rawNorm === p.rawNorm;
  }
  return q.rawNorm === p.rawNorm || q.singular === p.singular;
}

function isAbbreviationPair(q: AnnotatedToken, p: AnnotatedToken): boolean {
  if (q.isUnitSize && p.isUnitSize && q.canonical === p.canonical && q.rawNorm !== p.rawNorm) {
    return true;
  }
  if (q.isProtected && p.isProtected && q.canonical === p.canonical && q.rawNorm !== p.rawNorm) {
    // e.g. "all wheel drive" <-> "awd"
    return true;
  }
  const gA = ABBREVIATION_MAP.get(q.singular);
  const gB = ABBREVIATION_MAP.get(p.singular);
  return Boolean(gA && gB && gA === gB && q.singular !== p.singular);
}

function isSynonymPair(q: AnnotatedToken, p: AnnotatedToken): boolean {
  const gA = SYNONYM_MAP.get(q.singular);
  const gB = SYNONYM_MAP.get(p.singular);
  return Boolean(gA && gB && gA === gB && q.singular !== p.singular);
}

export interface PoolStructuredCorpus {
  titleTokens: AnnotatedToken[];
  optionTokenLists: AnnotatedToken[][];
  specTokenLists: AnnotatedToken[][];
  categoryTokens: AnnotatedToken[];
  allStructuredTokens: { token: AnnotatedToken; inTitle: boolean; fromCategory: boolean }[];
  fieldSequences: { tokens: AnnotatedToken[]; inTitle: boolean }[];
}

export function buildPoolStructuredCorpus(
  pool: Pool,
  allowedOptionTexts: string[],
  itemSpecTexts: string[]
): PoolStructuredCorpus {
  const titleTokens = extractAnnotatedTokens(pool.title);
  const optionTokenLists = allowedOptionTexts.map((t) => extractAnnotatedTokens(t));
  const specTokenLists = itemSpecTexts.map((t) => extractAnnotatedTokens(t));
  const categoryTokens = extractAnnotatedTokens(pool.category);

  const allStructuredTokens: { token: AnnotatedToken; inTitle: boolean; fromCategory: boolean }[] = [];
  for (const t of titleTokens) {
    if (t.isSubstantive) allStructuredTokens.push({ token: t, inTitle: true, fromCategory: false });
  }
  for (const list of optionTokenLists) {
    for (const t of list) {
      if (t.isSubstantive) allStructuredTokens.push({ token: t, inTitle: false, fromCategory: false });
    }
  }
  for (const list of specTokenLists) {
    for (const t of list) {
      if (t.isSubstantive) allStructuredTokens.push({ token: t, inTitle: false, fromCategory: false });
    }
  }
  for (const t of categoryTokens) {
    // Index non-generic category words (e.g. "apartments", "hotels", "collectibles") so "apt" <-> "apartments" works
    if (t.isSubstantive) allStructuredTokens.push({ token: t, inTitle: false, fromCategory: true });
  }

  const fieldSequences: { tokens: AnnotatedToken[]; inTitle: boolean }[] = [
    { tokens: titleTokens, inTitle: true },
    ...optionTokenLists.map((tokens) => ({ tokens, inTitle: false })),
    ...specTokenLists.map((tokens) => ({ tokens, inTitle: false })),
  ];

  return {
    titleTokens,
    optionTokenLists,
    specTokenLists,
    categoryTokens,
    allStructuredTokens,
    fieldSequences,
  };
}

function canJoinPair(a: AnnotatedToken, b: AnnotatedToken): boolean {
  if (!/^[a-z]{2,}$/.test(a.rawNorm) || !/^[a-z]{2,}$/.test(b.rawNorm)) return false;
  if (a.isProtected || b.isProtected) return false;
  if (a.isUnitSize || b.isUnitSize) return false;
  const combined = a.rawNorm + b.rawNorm;
  if (combined.length < 5 || combined.length > MAX_FUZZY_TOKEN_LEN) return false;
  if (isProtectedToken(combined)) return false;
  return true;
}

function findExactMatchInCorpus(
  qTok: AnnotatedToken,
  corpus: PoolStructuredCorpus
): { token: AnnotatedToken; inTitle: boolean; fromCategory: boolean } | null {
  let fallback: { token: AnnotatedToken; inTitle: boolean; fromCategory: boolean } | null = null;
  for (const entry of corpus.allStructuredTokens) {
    if (isExactNormalizedPair(qTok, entry.token)) {
      if (entry.inTitle) return entry;
      if (!fallback || (!entry.fromCategory && fallback.fromCategory)) {
        fallback = entry;
      }
    }
  }
  return fallback;
}

function isReliableAbbreviationExpansion(queryDisplay: string, poolDisplay: string): boolean {
  const qNorm = queryDisplay.trim().toLowerCase();
  const pNorm = poolDisplay.trim().toLowerCase();
  // Unit sizes: only suggest expanding short forms ("1 br", "1br") into full "1 bedroom", never shortening
  if (/\bbedroom\b/.test(pNorm) && !/\bbedroom\b/.test(qNorm)) {
    return true;
  }
  const qSing = singularizeSafe(qNorm);
  const pSing = singularizeSafe(pNorm);
  return CANONICAL_ABBREVIATION_EXPANSIONS.has(pSing) && !CANONICAL_ABBREVIATION_EXPANSIONS.has(qSing);
}

function buildSuggestedQueryFromDetails(
  rawTitleQuery: string,
  details: MatchedTermDetail[],
  corroboratedTokens?: ReadonlySet<string>
): string | undefined {
  const cleanOriginal = rawTitleQuery.trim();
  if (!cleanOriginal) return undefined;

  const asciiOriginal = cleanOriginal
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  let candidate = asciiOriginal;
  let changed = false;

  for (const d of details) {
    if (d.kind === 'exact') continue;
    // Never suggest splitting a clean single word into awkward listing spacing (e.g. "maverick" -> "mave rick")
    if (d.kind === 'split_join' && d.direction === 'pool_split') continue;
    // Never suggest shortening a full word into an abbreviation (e.g. "apartment" -> "apt", "1 bedroom" -> "1 br")
    if (d.kind === 'abbreviation' && !isReliableAbbreviationExpansion(d.queryDisplay, d.poolDisplay)) {
      continue;
    }
    // Never suggest an uncorroborated single-listing spelling as a correction of the buyer's query
    if (d.kind === 'typo') {
      const targetSing = singularizeSafe(d.poolDisplay.trim().toLowerCase());
      if (!corroboratedTokens || !corroboratedTokens.has(targetSing)) {
        continue;
      }
    }

    const escaped = d.queryDisplay.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
    if (re.test(candidate)) {
      candidate = candidate.replace(re, d.poolDisplay);
      changed = true;
    }
  }

  const normalizedOriginal = asciiOriginal.replace(/\s+/g, ' ');
  const normalizedCandidate = candidate.trim().replace(/\s+/g, ' ');
  if (!changed || normalizedCandidate === normalizedOriginal) {
    return undefined;
  }
  return normalizedCandidate;
}

/**
 * Shared, deterministic, bounded matcher used by both Competing-Pools Comparison
 * and Explore Search. Evaluates query tokens against a pool's structured fields
 * (title, allowed options, item specs, and non-generic category name — NEVER
 * free-form descriptions, requirements, or discussion).
 */
export function matchStructuredQueryToPool(
  rawQueryText: string,
  corpus: PoolStructuredCorpus,
  options?: { allowSingleTokenQuery?: boolean; corroboratedTokens?: ReadonlySet<string> }
): StructuredPoolMatchResult {
  const queryAnnotated = extractAnnotatedTokens(rawQueryText.slice(0, MAX_QUERY_CHARS), MAX_QUERY_TOKENS);
  const poolTitleSubstantiveCount = corpus.titleTokens.filter((t) => t.isSubstantive).length;

  const consumed = new Set<number>();
  const details: MatchedTermDetail[] = [];
  const unmatchedTerms: string[] = [];

  // Pass 1: Bidirectional query-split -> pool-joined check ("mave rick" -> "maverick", "ma verick" -> "maverick")
  for (let i = 0; i < queryAnnotated.length - 1; i++) {
    if (consumed.has(i) || consumed.has(i + 1)) continue;
    const first = queryAnnotated[i];
    const second = queryAnnotated[i + 1];
    if (first.isYear || second.isYear) continue;
    if (!canJoinPair(first, second)) continue;

    // Only attempt joining if at least one half is NOT already an exact match in the pool
    const firstExact = first.isSubstantive ? findExactMatchInCorpus(first, corpus) : null;
    const secondExact = second.isSubstantive ? findExactMatchInCorpus(second, corpus) : null;
    if (firstExact && secondExact) continue;

    const joinedNorm = first.rawNorm + second.rawNorm;
    const joinedSing = singularizeSafe(joinedNorm);

    let joinedHit: { token: AnnotatedToken; inTitle: boolean } | null = null;
    for (const entry of corpus.allStructuredTokens) {
      if (entry.fromCategory) continue;
      if (entry.token.rawNorm === joinedNorm || entry.token.singular === joinedSing) {
        if (entry.inTitle) {
          joinedHit = entry;
          break;
        }
        if (!joinedHit) joinedHit = entry;
      }
    }

    if (joinedHit) {
      consumed.add(i);
      consumed.add(i + 1);
      const qPhrase = `${first.display} ${second.display}`;
      details.push({
        queryDisplay: qPhrase,
        poolDisplay: joinedHit.token.display,
        canonicalTerm: joinedHit.token.canonical,
        kind: 'split_join',
        direction: 'query_split',
        inTitle: joinedHit.inTitle,
        interpretation: `Spacing match: "${qPhrase}" → "${joinedHit.token.display}"`,
      });
    }
  }

  // Pass 2: Match remaining substantive query tokens in strict priority order
  const seenQueryUnitKeys = new Set<string>();
  let totalQueryUnits = details.length;

  for (let i = 0; i < queryAnnotated.length; i++) {
    if (consumed.has(i)) continue;
    const qTok = queryAnnotated[i];
    if (!qTok.isSubstantive) continue;
    const unitKey = qTok.isUnitSize ? qTok.canonical : qTok.rawNorm;
    if (seenQueryUnitKeys.has(unitKey)) continue;
    seenQueryUnitKeys.add(unitKey);
    totalQueryUnits += 1;

    // Priority 1: Exact normalized match
    const exactHit = findExactMatchInCorpus(qTok, corpus);
    if (exactHit) {
      details.push({
        queryDisplay: qTok.display,
        poolDisplay: exactHit.token.display,
        canonicalTerm: exactHit.token.canonical,
        kind: 'exact',
        inTitle: exactHit.inTitle,
        fromCategory: exactHit.fromCategory,
      });
      continue;
    }

    // Priority 2: Unambiguous abbreviation match (bidirectional, e.g. "1 br" <-> "1 bedroom", "apt" <-> "apartments")
    let abbrHit: { token: AnnotatedToken; inTitle: boolean; fromCategory: boolean } | null = null;
    for (const entry of corpus.allStructuredTokens) {
      if (isAbbreviationPair(qTok, entry.token)) {
        if (entry.inTitle) {
          abbrHit = entry;
          break;
        }
        if (!abbrHit || (!entry.fromCategory && abbrHit.fromCategory)) {
          abbrHit = entry;
        }
      }
    }
    if (abbrHit) {
      details.push({
        queryDisplay: qTok.display,
        poolDisplay: abbrHit.token.display,
        canonicalTerm: abbrHit.token.canonical,
        kind: 'abbreviation',
        inTitle: abbrHit.inTitle,
        fromCategory: abbrHit.fromCategory,
        interpretation: `Abbreviation: "${qTok.display}" ↔ "${abbrHit.token.display}"`,
      });
      continue;
    }

    // Priority 3: Unambiguous common product synonym (bidirectional, e.g. "sofa" <-> "couch")
    let synHit: { token: AnnotatedToken; inTitle: boolean } | null = null;
    for (const entry of corpus.allStructuredTokens) {
      if (entry.fromCategory) continue;
      if (isSynonymPair(qTok, entry.token)) {
        if (entry.inTitle) {
          synHit = entry;
          break;
        }
        if (!synHit) synHit = entry;
      }
    }
    if (synHit) {
      details.push({
        queryDisplay: qTok.display,
        poolDisplay: synHit.token.display,
        canonicalTerm: synHit.token.canonical,
        kind: 'synonym',
        inTitle: synHit.inTitle,
        interpretation: `Related term: "${qTok.display}" ↔ "${synHit.token.display}"`,
      });
      continue;
    }

    // Priority 4: Pool-split -> Query-joined ("maverick" <-> "mave rick", "heatpump" <-> "heat pump")
    if (/^[a-z]{5,}$/.test(qTok.rawNorm) && !qTok.isProtected) {
      let poolSplitHit: { phrase: string; inTitle: boolean } | null = null;
      for (const seq of corpus.fieldSequences) {
        for (let j = 0; j < seq.tokens.length - 1; j++) {
          const p1 = seq.tokens[j];
          const p2 = seq.tokens[j + 1];
          if (p1.isYear || p2.isYear) continue;
          if (!canJoinPair(p1, p2)) continue;
          const combined = p1.rawNorm + p2.rawNorm;
          if (combined === qTok.rawNorm || singularizeSafe(combined) === qTok.singular) {
            poolSplitHit = { phrase: `${p1.display} ${p2.display}`, inTitle: seq.inTitle };
            break;
          }
        }
        if (poolSplitHit?.inTitle) break;
      }
      if (poolSplitHit) {
        details.push({
          queryDisplay: qTok.display,
          poolDisplay: poolSplitHit.phrase,
          canonicalTerm: qTok.canonical,
          kind: 'split_join',
          direction: 'pool_split',
          inTitle: poolSplitHit.inTitle,
          interpretation: `Spacing variation: "${qTok.display}" ↔ "${poolSplitHit.phrase}"`,
        });
        continue;
      }
    }

    // Priority 5: Bounded typo / adjacent transposition for sufficiently long alphabetic product words
    let bestTypo: { token: AnnotatedToken; inTitle: boolean; distance: number } | null = null;
    for (const entry of corpus.allStructuredTokens) {
      if (entry.fromCategory) continue;
      const evalTypo = evaluateTypoMatch(qTok.singular, entry.token.singular);
      if (!evalTypo.matched) continue;
      if (
        !bestTypo ||
        evalTypo.distance < bestTypo.distance ||
        (evalTypo.distance === bestTypo.distance && entry.inTitle && !bestTypo.inTitle) ||
        (evalTypo.distance === bestTypo.distance &&
          entry.inTitle === bestTypo.inTitle &&
          entry.token.display.localeCompare(bestTypo.token.display) < 0)
      ) {
        bestTypo = { token: entry.token, inTitle: entry.inTitle, distance: evalTypo.distance };
      }
    }
    if (bestTypo) {
      details.push({
        queryDisplay: qTok.display,
        poolDisplay: bestTypo.token.display,
        canonicalTerm: bestTypo.token.canonical,
        kind: 'typo',
        editDistance: bestTypo.distance,
        inTitle: bestTypo.inTitle,
        interpretation: `Spelling match: "${qTok.display}" ↔ "${bestTypo.token.display}"`,
      });
      continue;
    }

    unmatchedTerms.push(qTok.display);
  }

  const matchedCount = details.length;
  const queryCoverage = totalQueryUnits > 0 ? matchedCount / totalQueryUnits : 0;
  const matchedTitleUnitCount = details.filter((d) => d.inTitle).length;
  const exactTermCount = details.filter((d) => d.kind === 'exact').length;
  const approximateTermCount = matchedCount - exactTermCount;
  const isApproximate = approximateTermCount > 0;

  const nonCategoryMatchedCount = details.filter((d) => !d.fromCategory).length;

  // Credible overlap gate: avoid single vague word overlap or category+spec-only matches across multi-word queries
  let credible = false;
  if (totalQueryUnits === 1) {
    credible = matchedCount >= 1 && options?.allowSingleTokenQuery !== false;
  } else if (totalQueryUnits === 2) {
    credible = matchedCount >= 2;
  } else if (totalQueryUnits >= 3) {
    const hasSufficientItemOverlap =
      unmatchedTerms.length === 0 || (nonCategoryMatchedCount >= 2 && matchedTitleUnitCount >= 1);
    credible = matchedCount >= 2 && queryCoverage >= 0.6 && hasSufficientItemOverlap;
  }

  // Must anchor in title, structured options/specs, or explicit category abbreviation
  const hasStrongAnchor =
    matchedTitleUnitCount > 0 ||
    matchedCount >= 2 ||
    details.some((d) => d.kind === 'abbreviation' || d.kind === 'exact');

  const matched = credible && hasStrongAnchor;

  const approximateInterpretations = Array.from(
    new Set(
      details
        .map((d) => d.interpretation)
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
    )
  );

  return {
    matched,
    isApproximate,
    exactTermCount,
    approximateTermCount,
    totalQueryUnits,
    queryCoverage,
    matchedTitleUnitCount,
    poolTitleTermCount: poolTitleSubstantiveCount,
    matchedTerms: details.map((d) => d.canonicalTerm),
    exactMatchedTerms: details.filter((d) => d.kind === 'exact').map((d) => d.poolDisplay),
    unmatchedTerms,
    details,
    approximateInterpretations,
    suggestedQuery:
      matched && isApproximate
        ? buildSuggestedQueryFromDetails(rawQueryText, details, options?.corroboratedTokens)
        : undefined,
  };
}

export interface ExploreSearchPoolMatch<TPool extends Pool = Pool> {
  pool: TPool;
  matchKind: 'all' | 'exact' | 'approximate';
  interpretations: string[];
  score: number;
}

export interface ExploreSearchResult<TPool extends Pool = Pool> {
  results: ExploreSearchPoolMatch<TPool>[];
  hasExactMatches: boolean;
  hasApproximateMatches: boolean;
  approximateInterpretations: string[];
  suggestedQuery?: string;
}

function collectPoolStructuredTextsForExplore(pool: Pool): {
  allowedOptionTexts: string[];
  excludedOptionTexts: string[];
  itemSpecTexts: string[];
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
    const structuredVals = [
      vs.assetClass === 'accessory'
        ? 'accessory'
        : vs.vehicleType
          ? getVehicleTypeLabel(vs.vehicleType, true)
          : undefined,
      vs.condition,
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
    ];
    for (const val of structuredVals) {
      if (typeof val === 'string' && val.trim()) {
        itemSpecTexts.push(val.trim());
      }
    }
  }

  return { allowedOptionTexts, excludedOptionTexts, itemSpecTexts };
}

function hasExploreIncompatibility(
  combinedQueryText: string,
  queryAnnotated: AnnotatedToken[],
  pool: Pool,
  allowedOptionTexts: string[],
  excludedOptionTexts: string[],
  itemSpecTexts: string[]
): boolean {
  const queryTermSet = new Set(
    queryAnnotated
      .filter((t) => t.isSubstantive)
      .map((t) => (t.isProtected || t.isUnitSize ? t.canonical : t.rawNorm))
  );
  const poolFullText = [pool.title, ...allowedOptionTexts, ...itemSpecTexts].join(' ');
  const poolAnnotated = extractAnnotatedTokens(poolFullText);
  const poolTermSet = new Set(
    poolAnnotated
      .filter((t) => t.isSubstantive)
      .map((t) => (t.isProtected || t.isUnitSize ? t.canonical : t.rawNorm))
  );

  // 1. Explicitly excluded options
  for (const excl of excludedOptionTexts) {
    const exclTokens = extractSubstantiveItemTokens(excl).filter((t) => !poolTermSet.has(t));
    if (exclTokens.length > 0 && exclTokens.some((t) => queryTermSet.has(t))) {
      return true;
    }
  }

  // 2. Unified vehicle compatibility + trim / powertrain / drivetrain conflict
  if (pool.category === 'Vehicles') {
    const queryVehSignals = inferVehicleSignalsFromText(combinedQueryText);
    const poolVehSignals = inferVehicleSignalsFromText(poolFullText, pool.vehicleSpecs);
    const vehCompat = evaluateVehicleCompatibility(queryVehSignals, poolVehSignals, {
      mode: 'pool_comparison',
    });
    if (!vehCompat.compatible) {
      return true;
    }

    for (const family of [VEHICLE_TRIM_FAMILY, VEHICLE_POWERTRAIN_FAMILY, VEHICLE_DRIVETRAIN_FAMILY]) {
      const qVals = Array.from(queryTermSet).filter((t) => family.has(t));
      const pVals = Array.from(poolTermSet).filter((t) => family.has(t));
      if (qVals.length > 0 && pVals.length > 0 && !qVals.some((v) => pVals.includes(v))) {
        return true;
      }
    }
  }

  // 3. Apartment unit size conflict (e.g. 1BR vs 2BR vs Studio)
  if (pool.category === 'Apartments') {
    const qSize = extractApartmentUnitSize(combinedQueryText);
    const pSize = extractApartmentUnitSize(poolFullText);
    if (qSize && pSize && qSize !== pSize) {
      return true;
    }
  }

  // 4. Explicit hyphenated SKU conflict
  const qSkus = extractSkuCodes([combinedQueryText]);
  const pSkus = extractSkuCodes([pool.title, ...allowedOptionTexts, ...itemSpecTexts]);
  if (qSkus.size > 0 && pSkus.size > 0) {
    if (!Array.from(qSkus).some((s) => pSkus.has(s))) {
      return true;
    }
  }

  // 5. Explicit model year conflict (e.g. buyer explicitly requests 2025 vs 2026-only pool)
  const queryYears = extractModelYears(combinedQueryText);
  const poolYears = extractPoolModelYears(pool, itemSpecTexts);
  if (queryYears.size > 0 && poolYears.size > 0) {
    if (!Array.from(queryYears).some((y) => poolYears.has(y))) {
      return true;
    }
  }

  return false;
}

/**
 * Shared Explore search filter and ranker built on the same deterministic, bounded
 * matching engine as Competing-Pools Comparison so Explore and Comparison stay aligned.
 * Exact normalized matches ALWAYS rank above approximate candidates.
 */
export function searchPoolsForExplore<TPool extends Pool>(
  pools: TPool[],
  filters: {
    query?: string;
    variant?: string;
    category?: PoolCategory | 'All';
    location?: string;
    vehicleType?: VehicleSubType | 'all' | 'accessories';
    vehicleCondition?: VehicleCondition | 'all';
  }
): ExploreSearchResult<TPool> {
  const trimmedQuery = (filters.query ?? '').trim();
  const trimmedVariant = (filters.variant ?? '').trim();

  // Apply explicit category, vehicle subtype/condition, and location dropdown filters first
  const basePools = pools.filter((pool) => {
    if (filters.category && filters.category !== 'All' && pool.category !== filters.category) {
      return false;
    }
    if (filters.location && filters.location !== 'All locations' && pool.location !== filters.location) {
      return false;
    }
    if (filters.vehicleType && filters.vehicleType !== 'all') {
      if (pool.category !== 'Vehicles') return false;
      if (filters.vehicleType === 'accessories') {
        if (!isAccessoryPool(pool)) return false;
      } else {
        if (isAccessoryPool(pool)) return false;
        if (pool.vehicleSpecs?.vehicleType !== filters.vehicleType) return false;
      }
    }
    if (filters.vehicleCondition && filters.vehicleCondition !== 'all') {
      if (pool.category !== 'Vehicles' || isAccessoryPool(pool)) return false;
      if (pool.vehicleSpecs?.condition !== filters.vehicleCondition) return false;
    }
    return true;
  });

  if (!trimmedQuery && !trimmedVariant) {
    return {
      results: basePools.map((pool) => ({
        pool,
        matchKind: 'all',
        interpretations: [],
        score: 0,
      })),
      hasExactMatches: false,
      hasApproximateMatches: false,
      approximateInterpretations: [],
    };
  }

  const combinedText = [trimmedQuery, trimmedVariant].filter(Boolean).join(' ');
  const combinedAnnotated = extractAnnotatedTokens(combinedText, MAX_QUERY_TOKENS);
  const queryRawNormTokens = normalizeMatchTokens(trimmedQuery);
  const variantRawNormTokens = normalizeMatchTokens(trimmedVariant);
  const corroboratedTokens = buildCorroboratedTokenSet(pools);

  const matchedEntries: (ExploreSearchPoolMatch<TPool> & { suggestedQuery?: string })[] = [];

  for (const pool of basePools) {
    const { allowedOptionTexts, excludedOptionTexts, itemSpecTexts } =
      collectPoolStructuredTextsForExplore(pool);

    // Strict eligibility/variant gate: never show incompatible model years, trims, drivetrains, unit sizes, or SKUs
    if (
      hasExploreIncompatibility(
        combinedText,
        combinedAnnotated,
        pool,
        allowedOptionTexts,
        excludedOptionTexts,
        itemSpecTexts
      )
    ) {
      continue;
    }

    const corpus = buildPoolStructuredCorpus(pool, allowedOptionTexts, itemSpecTexts);

    // Check variant field if provided (must match structured title/options/specs)
    let variantResult: StructuredPoolMatchResult | null = null;
    if (trimmedVariant) {
      variantResult = matchStructuredQueryToPool(trimmedVariant, corpus, {
        allowSingleTokenQuery: true,
        corroboratedTokens,
      });
      // Fallback for exact normalized year/short token in variant field (e.g. "2026" or "XLT")
      if (!variantResult.matched && variantRawNormTokens.length > 0) {
        const poolAllExact = new Set(
          normalizeMatchTokens([pool.title, ...allowedOptionTexts, ...itemSpecTexts].join(' '))
        );
        const allVariantTokensExact = variantRawNormTokens.every((t) => poolAllExact.has(t));
        if (!allVariantTokensExact) continue;
      } else if (!variantResult.matched) {
        continue;
      }
    }

    // Check main query field if provided
    let queryResult: StructuredPoolMatchResult | null = null;
    let matchedViaMetadataExact = false;

    if (trimmedQuery) {
      queryResult = matchStructuredQueryToPool(trimmedQuery, corpus, {
        allowSingleTokenQuery: true,
        corroboratedTokens,
      });

      if (!queryResult.matched) {
        // Explore discovery fallback: exact normalized whole-word match over structured pool metadata
        // (title, options, specs, category, location, sellerName — NEVER descriptions/requirements/discussion)
        const metadataTokens = new Set(
          normalizeMatchTokens(
            [
              pool.title,
              pool.category,
              pool.location,
              pool.currentOffer?.sellerName ?? '',
              ...allowedOptionTexts,
              ...itemSpecTexts,
            ].join(' ')
          )
        );
        if (
          queryRawNormTokens.length > 0 &&
          queryRawNormTokens.every((t) => metadataTokens.has(t))
        ) {
          matchedViaMetadataExact = true;
        } else {
          continue;
        }
      }
    }

    const isApprox =
      Boolean(queryResult?.matched && queryResult.isApproximate) ||
      Boolean(variantResult?.matched && variantResult.isApproximate);

    const interpretations = Array.from(
      new Set([
        ...(queryResult?.approximateInterpretations ?? []),
        ...(variantResult?.approximateInterpretations ?? []),
      ])
    );

    // Ranking: exact matches ALWAYS rank strictly above approximate matches
    let score = isApprox ? 100 : 300;
    if (queryResult?.matched) {
      score += Math.round(queryResult.queryCoverage * 40);
      score += queryResult.matchedTitleUnitCount * 15;
      score += queryResult.exactTermCount * 10;
      const totalEdits = queryResult.details.reduce((acc, d) => acc + (d.editDistance ?? 0), 0);
      score -= totalEdits * 6;
    } else if (matchedViaMetadataExact) {
      score += 20;
    }
    if (variantResult?.matched) {
      score += variantResult.isApproximate ? 5 : 20;
    }

    matchedEntries.push({
      pool,
      matchKind: isApprox ? 'approximate' : 'exact',
      interpretations,
      score,
      suggestedQuery: queryResult?.suggestedQuery,
    });
  }

  matchedEntries.sort((a, b) => {
    if (a.matchKind !== b.matchKind) {
      return a.matchKind === 'exact' ? -1 : 1;
    }
    if (b.score !== a.score) return b.score - a.score;
    return a.pool.id.localeCompare(b.pool.id);
  });

  const hasExactMatches = matchedEntries.some((m) => m.matchKind === 'exact');
  const hasApproximateMatches = matchedEntries.some((m) => m.matchKind === 'approximate');

  // Offer a user-selectable suggestion only when there are NO exact matches and an approximate hit has a clean suggestion
  const topApprox = matchedEntries.find((m) => m.matchKind === 'approximate' && m.suggestedQuery);
  const suggestedQuery = !hasExactMatches ? topApprox?.suggestedQuery : undefined;

  const approximateInterpretations = Array.from(
    new Set(
      matchedEntries
        .filter((m) => m.matchKind === 'approximate')
        .flatMap((m) => m.interpretations)
    )
  );

  return {
    results: matchedEntries.map(({ suggestedQuery: _sq, ...rest }) => rest),
    hasExactMatches,
    hasApproximateMatches,
    approximateInterpretations,
    suggestedQuery,
  };
}
