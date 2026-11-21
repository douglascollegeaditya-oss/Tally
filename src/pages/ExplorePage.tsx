import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BellPlus,
  Bookmark,
  Calendar,
  Check,
  MapPin,
  Scale,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from 'lucide-react';
import { buildQueryFromPool, findCompetingPoolCounts } from '../domain/competingPoolsEngine.ts';
import {
  POOL_CATEGORIES,
  type PoolCategory,
  type SimilarPoolCandidate,
  type SimilarPoolQueryInput,
  type SimilarPoolReference,
} from '../domain/types.ts';
import { ApiRequestError, type ClientPool, useTally } from '../lib/api.ts';
import {
  formatCalendarDate,
  formatCurrency,
  formatShortDate,
  getStageLabel,
  getStageToneClasses,
} from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import {
  CompetingPoolsComparison,
  type ComparisonQuerySummary,
} from '../components/CompetingPoolsComparison.tsx';
import { LOCATION_OPTIONS } from '../components/Layout.tsx';
import { PoolImage } from '../components/PoolImage.tsx';
import { SegmentedTally } from '../components/SegmentedTally.tsx';

type StageFilter = 'all' | 'open' | 'offer' | 'unlocked' | 'past';
type WindowFilter = 'all' | 'soon' | 'later' | 'past';

const STAGE_FILTERS: { id: StageFilter; label: string }[] = [
  { id: 'all', label: 'All stages' },
  { id: 'open', label: 'Gathering & ready' },
  { id: 'offer', label: 'Offer open' },
  { id: 'unlocked', label: 'Unlocked' },
  { id: 'past', label: 'Past outcomes' },
];

const WINDOW_FILTERS: { id: WindowFilter; label: string }[] = [
  { id: 'all', label: 'Any window' },
  { id: 'soon', label: 'Within 30 days' },
  { id: 'later', label: '30+ days out' },
  { id: 'past', label: 'Past target / ended' },
];

function matchesStageFilter(pool: ClientPool, stageFilter: StageFilter): boolean {
  const st = pool.metrics.effectiveStage;
  switch (stageFilter) {
    case 'open':
      return st === 'gathering' || st === 'ready_for_quote' || st === 'quote_requested';
    case 'offer':
      return st === 'offer_open';
    case 'unlocked':
      return st === 'unlocked';
    case 'past':
      return st === 'closed' || st === 'expired';
    default:
      return true;
  }
}

function getGoalDateDiffDays(goalDate: string, demoNowIso: string): number | null {
  const goalMs = Date.parse(`${goalDate}T12:00:00Z`);
  const nowMs = Date.parse(demoNowIso);
  if (Number.isNaN(goalMs) || Number.isNaN(nowMs)) return null;
  return Math.round((goalMs - nowMs) / (1000 * 60 * 60 * 24));
}

function matchesWindowFilter(
  pool: ClientPool,
  windowFilter: WindowFilter,
  demoNowIso: string
): boolean {
  if (windowFilter === 'all') return true;
  const st = pool.metrics.effectiveStage;
  const diffDays = getGoalDateDiffDays(pool.goalDate, demoNowIso);
  if (windowFilter === 'past') {
    return st === 'closed' || st === 'expired' || (diffDays !== null && diffDays < 0);
  }
  if (st === 'closed' || st === 'expired') return false;
  if (diffDays === null) return true;
  if (windowFilter === 'soon') return diffDays >= 0 && diffDays <= 30;
  if (windowFilter === 'later') return diffDays > 30;
  return true;
}

function extractVariantSummary(pool: ClientPool): string | null {
  const parts: string[] = [];
  for (const g of pool.optionGroups) {
    if (g.id === 'delivery') continue;
    if (g.allowedValues.length > 0) {
      parts.push(`${g.label}: ${g.allowedValues.join(', ')}`);
    }
  }
  if (parts.length === 0) {
    for (const spec of pool.categorySpecs.slice(0, 2)) {
      if (spec.value.trim()) parts.push(`${spec.label}: ${spec.value}`);
    }
  }
  return parts.length > 0 ? parts.slice(0, 2).join(' · ') : null;
}

function getPoolPrimaryDestination(pool: ClientPool, actorId: string, role: string): string {
  const st = pool.metrics.effectiveStage;
  if (st === 'unlocked' && role === 'buyer') {
    const member = pool.members.find((m) => m.userId === actorId);
    if (member && (member.status === 'confirmed' || member.status === 'fulfilled')) {
      return `/pools/${pool.id}/claim`;
    }
  }
  if (st === 'offer_open' || st === 'expired') {
    return `/pools/${pool.id}/offer`;
  }
  return `/pools/${pool.id}`;
}

function getPoolPrimaryCtaLabel(pool: ClientPool, actorId: string, role: string): string {
  const st = pool.metrics.effectiveStage;
  if (st === 'unlocked') {
    const member = pool.members.find((m) => m.userId === actorId);
    if (
      role === 'buyer' &&
      member &&
      (member.status === 'confirmed' || member.status === 'fulfilled')
    ) {
      return member.status === 'fulfilled' ? 'View fulfilled pass' : 'Claim unlocked price';
    }
    return 'View unlocked deal';
  }
  if (st === 'offer_open') return 'Review quote & confirm';
  if (st === 'expired') return 'View expired offer';
  if (st === 'closed') return 'View outcome';
  if (st === 'ready_for_quote' && pool.organizerId === actorId) return 'Request seller quote';
  return 'View pool';
}

function getMeterState(pool: ClientPool) {
  const m = pool.metrics;
  const st = m.effectiveStage;
  if (st === 'offer_open') {
    return {
      current: m.confirmedUnits,
      target: m.targetMin,
      verb: 'confirmed',
      rightLabel:
        m.remainingToMinimum === 0 ? 'Minimum met' : `${m.remainingToMinimum} more to unlock`,
    };
  }
  if (st === 'unlocked') {
    return {
      current: m.confirmedUnits,
      target: m.targetMin,
      verb: 'confirmed',
      rightLabel: pool.currentOffer
        ? `${formatCurrency(pool.currentOffer.subtotal)} unlocked`
        : 'Unlocked',
    };
  }
  if (st === 'expired') {
    return {
      current: m.confirmedUnits,
      target: m.targetMin,
      verb: 'confirmed',
      rightLabel: 'Closed short',
    };
  }
  if (st === 'closed') {
    return {
      current: m.fulfilledUnits || m.confirmedUnits,
      target: m.targetMin,
      verb: 'fulfilled',
      rightLabel: 'Completed',
    };
  }
  return {
    current: m.eligibleInterestedUnits,
    target: m.targetMin,
    verb: 'interested',
    rightLabel:
      m.remainingToMinimum === 0 ? 'Ready for quote' : `${m.remainingToMinimum} more needed`,
  };
}

export function ExplorePage() {
  const { session, role, busy, toggleFollowAction, findSimilarPoolsAction } = useTally();
  const { searchParams, navigate } = useRouter();

  const query = searchParams.get('q') ?? '';
  const variant = searchParams.get('var') ?? '';
  const category = (searchParams.get('cat') as PoolCategory | 'All' | null) ?? 'All';
  const location = searchParams.get('loc') ?? 'All locations';
  const stageFilter = (searchParams.get('stage') as StageFilter | null) ?? 'all';
  const windowFilter = (searchParams.get('win') as WindowFilter | null) ?? 'all';

  // Competing pools comparison drawer/panel state
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareRefPoolId, setCompareRefPoolId] = useState<string | null>(null);
  const [compareQueryInput, setCompareQueryInput] = useState<SimilarPoolQueryInput | null>(null);
  const [compareQuerySummary, setCompareQuerySummary] = useState<ComparisonQuerySummary | null>(
    null
  );
  const [compareCandidates, setCompareCandidates] = useState<SimilarPoolCandidate[]>([]);
  const [compareReferencePools, setCompareReferencePools] = useState<SimilarPoolReference[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Automatic matcher lookup when Explore shows 0 results for a typed search
  const [emptyMatchCandidates, setEmptyMatchCandidates] = useState<SimilarPoolCandidate[]>([]);
  const [emptyReferencePools, setEmptyReferencePools] = useState<SimilarPoolReference[]>([]);
  const [emptyMatchLoading, setEmptyMatchLoading] = useState(false);
  const [emptyMatchError, setEmptyMatchError] = useState<string | null>(null);

  const compareHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === 'All' || v === 'All locations' || v === 'all') {
        next.delete(k);
      } else {
        next.set(k, v);
      }
    }
    const qs = next.toString();
    navigate(qs ? `/?${qs}` : '/', { replace: true });
  };

  const resetFilters = () => {
    setCompareOpen(false);
    navigate('/', { replace: true });
  };

  const pools = session?.pools ?? [];
  const demoNow = session?.demoNow ?? '';
  const actorId = session?.actor.id ?? 'buyer-maya';

  const trimmedQuery = query.trim();
  const trimmedVariant = variant.trim();

  const filteredPools = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    const v = trimmedVariant.toLowerCase();
    return pools.filter((pool) => {
      if (category !== 'All' && pool.category !== category) return false;
      if (location !== 'All locations' && pool.location !== location) return false;
      if (!matchesStageFilter(pool, stageFilter)) return false;
      if (!matchesWindowFilter(pool, windowFilter, demoNow)) return false;

      const optionText = pool.optionGroups.flatMap((g) => [g.label, ...g.allowedValues]).join(' ');
      const specText = pool.categorySpecs.map((s) => `${s.label} ${s.value}`).join(' ');

      if (q) {
        const hay = [
          pool.title,
          pool.subtitle,
          pool.category,
          pool.location,
          pool.deliveryOrDestination,
          pool.unitPlural,
          pool.currentOffer?.sellerName ?? '',
          optionText,
          specText,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (v) {
        const variantHay = [pool.title, optionText, specText].join(' ').toLowerCase();
        if (!variantHay.includes(v)) return false;
      }

      return true;
    });
  }, [pools, category, location, stageFilter, windowFilter, demoNow, trimmedQuery, trimmedVariant]);

  const hasActiveFilter =
    trimmedQuery !== '' ||
    trimmedVariant !== '' ||
    category !== 'All' ||
    location !== 'All locations' ||
    stageFilter !== 'all' ||
    windowFilter !== 'all';

  // Feature Ford Maverick XLT prominently whenever it is in the filtered set
  const featuredPool = useMemo(
    () =>
      filteredPools.find((p) => p.id === 'pool-maverick-xlt') ??
      (!hasActiveFilter ? filteredPools[0] : undefined),
    [filteredPools, hasActiveFilter]
  );

  const secondaryPools = useMemo(
    () => (featuredPool ? filteredPools.filter((p) => p.id !== featuredPool.id) : filteredPools),
    [filteredPools, featuredPool]
  );

  const featuredMeter = featuredPool ? getMeterState(featuredPool) : null;
  const featuredFollowing = featuredPool ? featuredPool.followers.includes(actorId) : false;

  // Pre-fills item query and selected category only; city stays an explicit optional field on Alerts
  const alertQueryValue = [trimmedQuery, trimmedVariant].filter(Boolean).join(' ').trim();
  const createAlertHref = useMemo(() => {
    const params = new URLSearchParams({ create: '1' });
    if (alertQueryValue) params.set('q', alertQueryValue);
    if (category !== 'All') params.set('cat', category);
    return `/alerts?${params.toString()}`;
  }, [alertQueryValue, category]);

  const startPoolHref = useMemo(() => {
    const params = new URLSearchParams();
    if (alertQueryValue) params.set('q', alertQueryValue);
    if (category !== 'All') params.set('cat', category);
    if (location !== 'All locations') params.set('loc', location);
    const qs = params.toString();
    return qs ? `/start?${qs}` : '/start';
  }, [alertQueryValue, category, location]);

  const competingCounts = useMemo(
    () => findCompetingPoolCounts(pools, demoNow),
    [pools, demoNow]
  );

  const compareRefPool = useMemo(
    () => (compareRefPoolId ? pools.find((p) => p.id === compareRefPoolId) ?? null : null),
    [pools, compareRefPoolId]
  );

  const activeStageLabel =
    stageFilter !== 'all'
      ? STAGE_FILTERS.find((s) => s.id === stageFilter)?.label
      : undefined;
  const activeWindowLabel =
    windowFilter !== 'all'
      ? WINDOW_FILTERS.find((w) => w.id === windowFilter)?.label
      : undefined;

  const executeComparison = async (input: SimilarPoolQueryInput) => {
    setCompareLoading(true);
    setCompareError(null);
    try {
      const res = await findSimilarPoolsAction(input);
      setCompareCandidates(res.candidates);
      setCompareReferencePools(res.referencePools ?? []);
    } catch (err) {
      setCompareError(
        err instanceof ApiRequestError
          ? err.error.message
          : 'Could not compare pools right now.'
      );
    } finally {
      setCompareLoading(false);
    }
  };

  const openPoolComparison = (pool: ClientPool) => {
    const input = buildQueryFromPool(pool);
    setCompareRefPoolId(pool.id);
    setCompareQueryInput(input);
    setCompareQuerySummary(null);
    setCompareOpen(true);
    void executeComparison(input);
  };

  const openSearchComparison = () => {
    const titleQuery = trimmedQuery || trimmedVariant;
    if (!titleQuery) return;
    const input: SimilarPoolQueryInput = {
      title: titleQuery,
      category: category !== 'All' ? category : undefined,
      location: location !== 'All locations' ? location : undefined,
      modelOrVariant: trimmedVariant || undefined,
      includeUnavailable: true,
    };
    setCompareRefPoolId(null);
    setCompareQueryInput(input);
    setCompareQuerySummary({
      title: titleQuery,
      category: category !== 'All' ? category : undefined,
      location: location !== 'All locations' ? location : undefined,
      windowLabel: activeWindowLabel,
      stageLabel: activeStageLabel,
      specsText: trimmedVariant ? `Variant: ${trimmedVariant}` : undefined,
    });
    setCompareOpen(true);
    void executeComparison(input);
  };

  // When Explore returns 0 results for a typed search, ask the real matcher for
  // compatible candidates (e.g., hidden by filters) or reference-only incompatible variants.
  const emptyMatcherInput = useMemo<SimilarPoolQueryInput | null>(() => {
    const titleQuery = trimmedQuery || trimmedVariant;
    if (filteredPools.length > 0 || titleQuery.length < 2) return null;
    return {
      title: titleQuery,
      category: category !== 'All' ? category : undefined,
      location: location !== 'All locations' ? location : undefined,
      modelOrVariant: trimmedVariant || undefined,
      includeUnavailable: true,
    };
  }, [filteredPools.length, trimmedQuery, trimmedVariant, category, location]);

  const [emptyRetryNonce, setEmptyRetryNonce] = useState(0);

  useEffect(() => {
    if (!emptyMatcherInput) {
      setEmptyMatchCandidates([]);
      setEmptyReferencePools([]);
      setEmptyMatchLoading(false);
      setEmptyMatchError(null);
      return;
    }

    let cancelled = false;
    setEmptyMatchLoading(true);
    setEmptyMatchError(null);

    const timer = window.setTimeout(() => {
      void findSimilarPoolsAction(emptyMatcherInput)
        .then((res) => {
          if (cancelled) return;
          setEmptyMatchCandidates(res.candidates);
          setEmptyReferencePools(res.referencePools ?? []);
        })
        .catch((err) => {
          if (cancelled) return;
          setEmptyMatchError(
            err instanceof ApiRequestError
              ? err.error.message
              : 'Could not check live pools right now.'
          );
        })
        .finally(() => {
          if (!cancelled) setEmptyMatchLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [emptyMatcherInput, emptyRetryNonce, findSimilarPoolsAction, session?.sessionId, session?.actor.id]);

  useEffect(() => {
    if (compareOpen) {
      compareHeadingRef.current?.focus();
    }
  }, [compareOpen, compareRefPoolId]);

  const activeCriteriaSummary: ComparisonQuerySummary = {
    title: trimmedQuery || trimmedVariant || 'Current filters',
    category: category !== 'All' ? category : undefined,
    location: location !== 'All locations' ? location : undefined,
    windowLabel: activeWindowLabel,
    stageLabel: activeStageLabel,
    specsText: trimmedVariant ? `Variant: ${trimmedVariant}` : undefined,
  };

  const focusSearchBar = () => {
    setCompareOpen(false);
    searchInputRef.current?.focus();
    searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="space-y-6">
      {/* Editorial Neighborhood Circular Search & Filter Header */}
      <section
        aria-label="Search and filter buying pools"
        className="bg-[#FBF9F4] border border-[#CDD6CC] p-5 sm:p-7 space-y-5"
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div className="space-y-1.5">
            <p className="font-mono text-[11px] uppercase tracking-wider text-[#4E6359]">
              Neighborhood Buying Circular · {location === 'All locations' ? 'Pacific Northwest' : location}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] leading-[1.02] tracking-tight text-[#152B23] uppercase">
              Find a buying pool.
            </h1>
            <p className="text-sm sm:text-[15px] text-[#152B23] max-w-2xl">
              Compare shared demand and actual published seller quotes before buying alone or
              starting another group.
            </p>
          </div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#4E6359] tabular-nums">
            {filteredPools.length} {filteredPools.length === 1 ? 'pool' : 'pools'} shown
          </div>
        </div>

        {/* Prominent Search + Variant + Location + Purchase Window Controls */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
          <div className="relative md:col-span-5">
            <Search
              className="w-4 h-4 text-[#4E6359] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor="explore-search" className="sr-only">
              Search buying pools by item, model, neighborhood, or seller
            </label>
            <input
              ref={searchInputRef}
              id="explore-search"
              type="search"
              value={query}
              onChange={(e) => updateParams({ q: e.target.value || null })}
              placeholder="Search item, model, SKU, or seller…"
              className="w-full h-11 pl-10 pr-9 bg-white border border-[#8C9A86] text-sm text-[#152B23] placeholder:text-[#4E6359] focus:border-[#1E4334] transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => updateParams({ q: null })}
                aria-label="Clear search query"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#4E6359] hover:text-[#152B23] cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="relative md:col-span-3">
            <SlidersHorizontal
              className="w-3.5 h-3.5 text-[#4E6359] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor="explore-variant" className="sr-only">
              Filter by trim, variant, size, or SKU
            </label>
            <input
              id="explore-variant"
              type="text"
              value={variant}
              onChange={(e) => updateParams({ var: e.target.value || null })}
              placeholder="Variant, trim, size, or SKU"
              className="w-full h-11 pl-9 pr-8 bg-white border border-[#CDD6CC] focus:border-[#1E4334] text-xs font-mono text-[#152B23] placeholder:text-[#4E6359]"
            />
            {variant && (
              <button
                type="button"
                onClick={() => updateParams({ var: null })}
                aria-label="Clear variant filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#4E6359] hover:text-[#152B23] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <label className="md:col-span-2 flex items-center gap-1.5 px-3 h-11 bg-white border border-[#CDD6CC] focus-within:border-[#1E4334] text-xs font-mono text-[#152B23]">
            <MapPin className="w-3.5 h-3.5 text-[#8C9A86] shrink-0" aria-hidden="true" />
            <span className="sr-only">Location filter</span>
            <select
              aria-label="Location filter"
              value={location}
              onChange={(e) => updateParams({ loc: e.target.value })}
              className="w-full bg-transparent text-xs font-mono focus:outline-none truncate"
            >
              {LOCATION_OPTIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </label>

          <label className="md:col-span-2 flex items-center gap-1.5 px-3 h-11 bg-white border border-[#CDD6CC] focus-within:border-[#1E4334] text-xs font-mono text-[#152B23]">
            <Calendar className="w-3.5 h-3.5 text-[#8C9A86] shrink-0" aria-hidden="true" />
            <span className="sr-only">Purchase window filter</span>
            <select
              aria-label="Purchase window filter"
              value={windowFilter}
              onChange={(e) => updateParams({ win: e.target.value })}
              className="w-full bg-transparent text-xs font-mono focus:outline-none truncate"
            >
              {WINDOW_FILTERS.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Category & Stage Filter Controls */}
        <div className="space-y-3">
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Filter by category"
          >
            {(['All', ...POOL_CATEGORIES] as const).map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => updateParams({ cat })}
                  aria-pressed={active}
                  className={`px-3 py-1.5 border font-mono text-[11px] font-medium uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#1E4334] text-white border-[#1E4334]'
                      : 'bg-white text-[#152B23] border-[#CDD6CC] hover:border-[#1E4334] hover:bg-[#F6F1E5]'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#CDD6CC]/80">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by stage">
              {STAGE_FILTERS.map((sf) => {
                const active = stageFilter === sf.id;
                return (
                  <button
                    key={sf.id}
                    type="button"
                    onClick={() => updateParams({ stage: sf.id })}
                    aria-pressed={active}
                    className={`px-2.5 py-1 font-mono text-[11px] transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-[#F6F1E5] text-[#152B23] border border-[#1E4334] font-semibold'
                        : 'text-[#4E6359] hover:text-[#152B23] border border-transparent'
                    }`}
                  >
                    {sf.label}
                  </button>
                );
              })}
            </div>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="font-mono text-[11px] uppercase tracking-wider text-[#1E4334] underline underline-offset-4 hover:text-[#A63A2B] cursor-pointer"
              >
                Reset all
              </button>
            )}
          </div>

          {/* Active Search Criteria Strip */}
          {hasActiveFilter && (
            <div
              aria-label="Active search criteria"
              className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 bg-[#F6F1E5] border border-[#CDD6CC] font-mono text-[11px]"
            >
              <span className="uppercase tracking-wider text-[#4E6359] font-semibold">
                Active criteria:
              </span>
              {trimmedQuery && (
                <button
                  type="button"
                  onClick={() => updateParams({ q: null })}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-[#8C9A86] text-[#152B23] hover:border-[#A63A2B] cursor-pointer"
                >
                  <span>Query: &ldquo;{trimmedQuery}&rdquo;</span>
                  <X className="w-3 h-3 text-[#4E6359]" aria-hidden="true" />
                </button>
              )}
              {trimmedVariant && (
                <button
                  type="button"
                  onClick={() => updateParams({ var: null })}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-[#8C9A86] text-[#152B23] hover:border-[#A63A2B] cursor-pointer"
                >
                  <span>Variant: {trimmedVariant}</span>
                  <X className="w-3 h-3 text-[#4E6359]" aria-hidden="true" />
                </button>
              )}
              {category !== 'All' && (
                <button
                  type="button"
                  onClick={() => updateParams({ cat: null })}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-[#8C9A86] text-[#152B23] hover:border-[#A63A2B] cursor-pointer"
                >
                  <span>Category: {category}</span>
                  <X className="w-3 h-3 text-[#4E6359]" aria-hidden="true" />
                </button>
              )}
              {location !== 'All locations' && (
                <button
                  type="button"
                  onClick={() => updateParams({ loc: null })}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-[#8C9A86] text-[#152B23] hover:border-[#A63A2B] cursor-pointer"
                >
                  <span>Location: {location}</span>
                  <X className="w-3 h-3 text-[#4E6359]" aria-hidden="true" />
                </button>
              )}
              {activeWindowLabel && (
                <button
                  type="button"
                  onClick={() => updateParams({ win: null })}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-[#8C9A86] text-[#152B23] hover:border-[#A63A2B] cursor-pointer"
                >
                  <span>Window: {activeWindowLabel}</span>
                  <X className="w-3 h-3 text-[#4E6359]" aria-hidden="true" />
                </button>
              )}
              {activeStageLabel && (
                <button
                  type="button"
                  onClick={() => updateParams({ stage: null })}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-[#8C9A86] text-[#152B23] hover:border-[#A63A2B] cursor-pointer"
                >
                  <span>Stage: {activeStageLabel}</span>
                  <X className="w-3 h-3 text-[#4E6359]" aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {/* Typed search prompt: compare matching pools side-by-side or save an item alert */}
          {(trimmedQuery.length > 0 || trimmedVariant.length > 0) && filteredPools.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-[#EFF3ED] border border-[#8C9A86]">
              <p className="text-xs text-[#152B23] leading-relaxed">
                Checking{' '}
                <strong>&ldquo;{alertQueryValue}&rdquo;</strong>
                {category !== 'All' ? ` in ${category}` : ''}? Compare same-item momentum,
                variant compatibility, and any published seller quote side-by-side.
              </p>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={openSearchComparison}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer transition-colors"
                >
                  <Scale className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Compare matching pools</span>
                </button>
                <Link
                  to={createAlertHref}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#1E4334] text-[#152B23] hover:text-white border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors"
                >
                  <BellPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Create item alert</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Same-Item Competing Pools Comparison Panel */}
      {compareOpen && (
        <section
          aria-label="Compare similar buying pools"
          className="bg-[#FBF9F4] border-2 border-[#1E4334] shadow-[4px_4px_0px_#152B23] p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#CDD6CC]">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4E6359]">
                Same-item pool comparison
              </p>
              <h2
                ref={compareHeadingRef}
                tabIndex={-1}
                className="font-display text-xl sm:text-2xl text-[#152B23] uppercase focus:outline-none"
              >
                {compareRefPool
                  ? `Pools similar to ${compareRefPool.title}`
                  : `Matching pools for "${compareQuerySummary?.title ?? alertQueryValue}"`}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setCompareOpen(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#8C9A86] hover:border-[#1E4334] font-mono text-[11px] uppercase text-[#152B23] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Close comparison</span>
            </button>
          </div>

          <CompetingPoolsComparison
            candidates={compareCandidates}
            referencePools={compareReferencePools}
            loading={compareLoading}
            error={compareError}
            onRetry={() => {
              if (compareQueryInput) void executeComparison(compareQueryInput);
            }}
            onRefreshCandidates={() => {
              if (compareQueryInput) void executeComparison(compareQueryInput);
            }}
            referencePool={compareRefPool}
            querySummary={compareQuerySummary}
            emptyTitle="No compatible open pool found"
            emptyDescription="No open buying pools in this session match those exact item terms, category, and specifications. Adjust your search, create an alert for future pools, or start a separate pool."
            createAlertHref={createAlertHref}
            separatePoolHref={
              compareRefPool
                ? `/start?${new URLSearchParams({
                    q: compareRefPool.title,
                    cat: compareRefPool.category,
                    loc: compareRefPool.location,
                  }).toString()}`
                : startPoolHref
            }
            onAdjustSearch={focusSearchBar}
          />
        </section>
      )}

      {/* No Results State — Uses Real Matcher to Surface Any Reference-Only Incompatible Variants */}
      {filteredPools.length === 0 ? (
        <section aria-label="No matching pools" className="space-y-4">
          {emptyMatcherInput ? (
            <CompetingPoolsComparison
              candidates={emptyMatchCandidates}
              referencePools={emptyReferencePools}
              loading={emptyMatchLoading}
              error={emptyMatchError}
              onRetry={() => setEmptyRetryNonce((n) => n + 1)}
              querySummary={activeCriteriaSummary}
              emptyTitle="No compatible open pool found"
              emptyDescription="No open pool matches your search criteria right now. You can adjust your search, save an in-app item alert for future pools, or start a separate pool."
              createAlertHref={createAlertHref}
              separatePoolHref={startPoolHref}
              onAdjustSearch={focusSearchBar}
            />
          ) : (
            <div className="bg-white border border-[#CDD6CC] p-6 sm:p-10 space-y-4">
              <p className="font-mono text-xs uppercase tracking-wider text-[#4E6359]">
                0 matching buying pools
              </p>
              <h2 className="font-display text-2xl text-[#152B23] uppercase">
                No compatible open pool matches these filters
              </h2>
              <p className="text-sm text-[#4E6359] max-w-xl leading-relaxed">
                No pools in this session matched{' '}
                {category !== 'All' ? `${category}` : 'all categories'}
                {location !== 'All locations' ? ` in ${location}` : ''}
                {activeWindowLabel ? ` (${activeWindowLabel})` : ''}
                {activeStageLabel ? ` at stage "${activeStageLabel}"` : ''}. Adjust your filters,
                create an item alert for future pools, or start a separate buying pool.
              </p>
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white border border-[#8C9A86] hover:border-[#1E4334] text-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider hover:bg-[#F6F1E5] cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Adjust search</span>
                </button>
                <Link
                  to={createAlertHref}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#FFBF32] hover:bg-[#F2B01E] border border-[#152B23] text-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider"
                >
                  <BellPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Create item alert</span>
                </Link>
                <Link
                  to={startPoolHref}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#1E4334] hover:bg-[#152B23] border border-[#152B23] text-white font-mono text-xs font-semibold uppercase tracking-wider"
                >
                  <span>Start a separate pool</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
        </section>
      ) : (
        <>
          {/* Featured Pool Asymmetric Split Card */}
          {featuredPool && featuredMeter && (
            <article
              aria-label={`Featured pool: ${featuredPool.title}`}
              className="bg-white border border-[#CDD6CC] grid grid-cols-1 lg:grid-cols-12 items-stretch"
            >
              <div className="lg:col-span-6 relative min-h-[240px] sm:min-h-[300px] lg:min-h-[340px] bg-[#1E4334]">
                <PoolImage
                  src={featuredPool.imageUrl}
                  alt={featuredPool.imageAlt}
                  category={featuredPool.category}
                  title={featuredPool.title}
                  className="lg:h-full"
                />
                <span className="absolute top-3 left-3 px-2.5 py-1 bg-[#FFBF32] border border-[#152B23] font-mono text-[10px] font-semibold uppercase tracking-wider text-[#152B23]">
                  Featured pool
                </span>
              </div>

              <div className="lg:col-span-6 p-5 sm:p-7 flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[#4E6359]">
                      {featuredPool.category} · {featuredPool.location} ·{' '}
                      {featuredPool.currentOffer
                        ? `Closes ${formatShortDate(featuredPool.currentOffer.closeAt)}`
                        : `Target ${formatCalendarDate(featuredPool.goalDate)}`}
                    </span>
                    <span
                      className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider ${getStageToneClasses(
                        featuredPool.metrics.effectiveStage
                      )}`}
                    >
                      {getStageLabel(featuredPool.metrics.effectiveStage)}
                    </span>
                  </div>

                  <div>
                    <h2 className="font-display text-2xl sm:text-[28px] leading-tight text-[#152B23] uppercase">
                      {featuredPool.title}
                    </h2>
                    {extractVariantSummary(featuredPool) && (
                      <p className="mt-1 text-sm font-medium text-[#1E4334]">
                        {extractVariantSummary(featuredPool)}
                      </p>
                    )}
                    <p className="mt-1 text-sm text-[#4E6359] leading-relaxed">
                      {featuredPool.subtitle}
                    </p>
                  </div>

                  {featuredPool.currentOffer ? (
                    <div className="p-3 bg-[#F6F1E5] border border-[#1E4334]/35 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[#1E4334] font-semibold">
                        <Tag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {featuredPool.currentOffer.sellerName} · Offer v
                          {featuredPool.currentOffer.version} (USD)
                        </span>
                      </span>
                      <span className="font-mono text-sm font-bold text-[#152B23] tabular-nums">
                        {formatCurrency(featuredPool.currentOffer.subtotal)} subtotal
                      </span>
                    </div>
                  ) : (
                    <p className="px-3 py-2 bg-[#F7F5EE] border border-[#CDD6CC] font-mono text-[11px] text-[#4E6359]">
                      No quote published yet · Pricing arrives after minimum interest is reached
                    </p>
                  )}
                </div>

                <div className="space-y-4">
                  <SegmentedTally
                    current={featuredMeter.current}
                    target={featuredMeter.target}
                    unitSingular={featuredPool.unitSingular}
                    unitPlural={featuredPool.unitPlural}
                    verb={featuredMeter.verb}
                    rightLabel={featuredMeter.rightLabel}
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#4E6359] uppercase tabular-nums">
                    <span>
                      {featuredPool.metrics.eligibleInterestedUnits} interested ·{' '}
                      {featuredPool.metrics.confirmedUnits} confirmed
                    </span>
                    <span>
                      Min {featuredPool.metrics.targetMin} · Cap {featuredPool.metrics.targetCap}{' '}
                      {featuredPool.unitPlural}
                    </span>
                  </div>

                  <div className="flex items-stretch gap-2">
                    <Link
                      to={getPoolPrimaryDestination(featuredPool, actorId, role)}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider transition-colors"
                    >
                      <span>{getPoolPrimaryCtaLabel(featuredPool, actorId, role)}</span>
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                    {role !== 'seller' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleFollowAction(featuredPool.id)}
                        aria-label={
                          featuredFollowing
                            ? `Unfollow ${featuredPool.title}`
                            : `Follow ${featuredPool.title}`
                        }
                        aria-pressed={featuredFollowing}
                        title={
                          featuredFollowing
                            ? 'Saved to My pools (does not join or send alerts)'
                            : 'Save to My pools (does not join or send alerts)'
                        }
                        className={`px-3.5 border transition-colors cursor-pointer ${
                          featuredFollowing
                            ? 'bg-[#1E4334] text-[#FFBF32] border-[#1E4334]'
                            : 'bg-[#F7F5EE] text-[#152B23] border-[#8C9A86] hover:border-[#1E4334]'
                        }`}
                      >
                        {featuredFollowing ? (
                          <Check className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Bookmark className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </div>

                  {(competingCounts[featuredPool.id] ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => openPoolComparison(featuredPool)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-[#F6F1E5] hover:bg-[#1E4334] text-[#152B23] hover:text-white border border-[#1E4334] font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                    >
                      <Scale className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        Compare with {competingCounts[featuredPool.id]} similar{' '}
                        {competingCounts[featuredPool.id] === 1 ? 'pool' : 'pools'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </article>
          )}

          {/* Secondary Directory Grid */}
          {secondaryPools.length > 0 && (
            <section aria-label="Directory of buying pools" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
                    Active &amp; recent pools
                  </h2>
                  <span className="font-mono text-[11px] text-[#4E6359] tabular-nums">
                    · {secondaryPools.length} listed
                  </span>
                </div>
                <Link
                  to={startPoolHref}
                  className="font-mono text-[11px] uppercase tracking-wider text-[#1E4334] underline underline-offset-4 hover:text-[#152B23]"
                >
                  Check &amp; start a pool →
                </Link>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {secondaryPools.map((pool) => {
                  const meter = getMeterState(pool);
                  const st = pool.metrics.effectiveStage;
                  const isUnlocked = st === 'unlocked';
                  const isUnavailable = st === 'closed' || st === 'expired' || st === 'unlocked';
                  const dest = getPoolPrimaryDestination(pool, actorId, role);
                  const ctaLabel = getPoolPrimaryCtaLabel(pool, actorId, role);
                  const variantSummary = extractVariantSummary(pool);

                  return (
                    <article
                      key={pool.id}
                      className={`border flex flex-col justify-between transition-transform hover:-translate-y-0.5 ${
                        isUnlocked
                          ? 'bg-white border-[#1E4334] shadow-[3px_3px_0px_#152B23]'
                          : isUnavailable
                            ? 'bg-[#FBF9F4] border-[#CDD6CC]'
                            : 'bg-white border-[#CDD6CC]'
                      }`}
                    >
                      {pool.imageUrl && (
                        <div className="aspect-[16/9] bg-[#F6F1E5] border-b border-[#CDD6CC] overflow-hidden relative">
                          <PoolImage
                            src={pool.imageUrl}
                            alt={pool.imageAlt}
                            category={pool.category}
                            title={pool.title}
                          />
                          {isUnlocked && (
                            <span className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-[#1E4334] text-[#FFBF32] font-mono text-[10px] font-semibold uppercase tracking-wider">
                              Unlocked
                            </span>
                          )}
                        </div>
                      )}

                      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4E6359]">
                              {pool.category}
                            </span>
                            <span
                              className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider ${getStageToneClasses(
                                st
                              )}`}
                            >
                              {getStageLabel(st)}
                            </span>
                          </div>

                          <h3 className="font-heading text-base sm:text-[17px] font-bold leading-snug text-[#152B23]">
                            {pool.title}
                          </h3>

                          {variantSummary && (
                            <p className="text-xs text-[#1E4334] font-medium leading-snug">
                              {variantSummary}
                            </p>
                          )}

                          <p className="font-mono text-[11px] text-[#4E6359]">
                            {pool.location} ·{' '}
                            {st === 'closed'
                              ? 'Completed cohort'
                              : pool.currentOffer
                                ? `Claim by ${formatCalendarDate(pool.currentOffer.claimByDate)}`
                                : `Target ${formatCalendarDate(pool.goalDate)}`}
                          </p>

                          {/* Honest quote line or past outcome */}
                          {pool.currentOffer ? (
                            <div className="p-2.5 bg-[#F6F1E5] border border-[#1E4334]/30 text-xs text-[#152B23] flex items-baseline justify-between gap-2">
                              <span className="truncate font-medium">
                                {pool.currentOffer.sellerName}
                              </span>
                              <span className="font-mono font-semibold tabular-nums shrink-0">
                                {formatCurrency(pool.currentOffer.subtotal)}
                              </span>
                            </div>
                          ) : st === 'closed' && pool.outcomeSummary ? (
                            <p className="p-2.5 bg-[#F6F1E5] border border-[#CDD6CC] text-xs text-[#152B23]">
                              {pool.outcomeSummary}
                            </p>
                          ) : (
                            <p className="font-mono text-[11px] text-[#4E6359]">
                              No quote published yet
                            </p>
                          )}
                        </div>

                        <div className="space-y-3 pt-2 border-t border-[#CDD6CC]/70">
                          <SegmentedTally
                            current={meter.current}
                            target={meter.target}
                            unitSingular={pool.unitSingular}
                            unitPlural={pool.unitPlural}
                            verb={meter.verb}
                            rightLabel={meter.rightLabel}
                            compact
                          />

                          <div className="space-y-2">
                            <Link
                              to={dest}
                              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 border font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                                isUnlocked || st === 'offer_open'
                                  ? 'bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border-[#152B23]'
                                  : 'bg-[#F7F5EE] hover:bg-[#1E4334] text-[#152B23] hover:text-white border-[#8C9A86] hover:border-[#1E4334]'
                              }`}
                            >
                              <span>{ctaLabel}</span>
                              <ArrowRight className="w-3 h-3" aria-hidden="true" />
                            </Link>

                            {(competingCounts[pool.id] ?? 0) > 0 && (
                              <button
                                type="button"
                                onClick={() => openPoolComparison(pool)}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#F6F1E5] hover:bg-[#1E4334] text-[#152B23] hover:text-white border border-[#CDD6CC] hover:border-[#1E4334] font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                              >
                                <Scale className="w-3 h-3" aria-hidden="true" />
                                <span>
                                  Compare ({competingCounts[pool.id]} similar)
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
