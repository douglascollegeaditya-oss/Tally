import { useMemo } from 'react';
import { ArrowRight, Bookmark, Check, MapPin, Search, X } from 'lucide-react';
import { POOL_CATEGORIES, type PoolCategory } from '../domain/types.ts';
import { type ClientPool, useTally } from '../lib/api.ts';
import {
  formatCalendarDate,
  formatCurrency,
  formatShortDate,
  formatUnit,
  getStageLabel,
  getStageToneClasses,
} from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import { LOCATION_OPTIONS } from '../components/Layout.tsx';
import { PoolImage } from '../components/PoolImage.tsx';
import { SegmentedTally } from '../components/SegmentedTally.tsx';

type StageFilter = 'all' | 'open' | 'offer' | 'unlocked' | 'past';

const STAGE_FILTERS: { id: StageFilter; label: string }[] = [
  { id: 'all', label: 'All stages' },
  { id: 'open', label: 'Gathering & ready' },
  { id: 'offer', label: 'Offer open' },
  { id: 'unlocked', label: 'Unlocked & ready to claim' },
  { id: 'past', label: 'Past outcomes' },
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
    if (role === 'buyer' && member && (member.status === 'confirmed' || member.status === 'fulfilled')) {
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
        m.remainingToMinimum === 0
          ? 'Minimum met'
          : `${m.remainingToMinimum} more to unlock`,
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
      m.remainingToMinimum === 0
        ? 'Ready for quote'
        : `${m.remainingToMinimum} more needed`,
  };
}

export function ExplorePage() {
  const { session, role, busy, toggleFollowAction } = useTally();
  const { searchParams, navigate } = useRouter();

  const query = searchParams.get('q') ?? '';
  const category = (searchParams.get('cat') as PoolCategory | 'All' | null) ?? 'All';
  const location = searchParams.get('loc') ?? 'All locations';
  const stageFilter = (searchParams.get('stage') as StageFilter | null) ?? 'all';

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
    navigate('/', { replace: true });
  };

  const pools = session?.pools ?? [];
  const actorId = session?.actor.id ?? 'buyer-maya';

  const filteredPools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pools.filter((pool) => {
      if (category !== 'All' && pool.category !== category) return false;
      if (location !== 'All locations' && pool.location !== location) return false;
      if (!matchesStageFilter(pool, stageFilter)) return false;
      if (q) {
        const hay = [
          pool.title,
          pool.subtitle,
          pool.category,
          pool.location,
          pool.deliveryOrDestination,
          pool.unitPlural,
          pool.currentOffer?.sellerName ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pools, category, location, stageFilter, query]);

  const hasActiveFilter =
    query.trim() !== '' ||
    category !== 'All' ||
    location !== 'All locations' ||
    stageFilter !== 'all';

  // Feature Ford Maverick XLT prominently whenever it is in the filtered set
  const featuredPool = useMemo(
    () =>
      filteredPools.find((p) => p.id === 'pool-maverick-xlt') ??
      (!hasActiveFilter ? filteredPools[0] : undefined),
    [filteredPools, hasActiveFilter]
  );

  const secondaryPools = useMemo(
    () =>
      featuredPool
        ? filteredPools.filter((p) => p.id !== featuredPool.id)
        : filteredPools,
    [filteredPools, featuredPool]
  );

  const featuredMeter = featuredPool ? getMeterState(featuredPool) : null;
  const featuredFollowing = featuredPool ? featuredPool.followers.includes(actorId) : false;

  return (
    <div className="space-y-6">
      {/* Stitch Explore Header Card: Search + Compact Category Bar (no marketing splash) */}
      <section
        aria-label="Search and filter buying pools"
        className="bg-white border border-[#C6D8CE] p-5 sm:p-7 space-y-5"
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div className="space-y-1.5">
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] leading-[1.02] tracking-tight text-[#152B23] uppercase">
              Find a buying pool.
            </h1>
            <p className="text-sm sm:text-[15px] font-medium text-[#152B23]">
              Find people buying the same thing. Get one group price.
            </p>
            <p className="text-xs sm:text-[13px] text-[#516B61]">
              Get one seller quote for the group. The price unlocks when enough buyers confirm.
            </p>
          </div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#516B61] flex flex-wrap items-center gap-2">
            <span>{location === 'All locations' ? 'Pacific Northwest' : location}</span>
            <span aria-hidden="true">·</span>
            <span>{filteredPools.length} {filteredPools.length === 1 ? 'pool' : 'pools'} shown</span>
          </div>
        </div>

        {/* Search + Mobile Location Row */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-[#516B61] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor="explore-search" className="sr-only">
              Search buying pools by item, neighborhood, or category
            </label>
            <input
              id="explore-search"
              type="search"
              value={query}
              onChange={(e) => updateParams({ q: e.target.value || null })}
              placeholder="Search by item, neighborhood, unit, or seller…"
              className="w-full h-11 pl-10 pr-9 bg-[#EAF7EF]/60 border border-[#C6D8CE] text-sm text-[#152B23] placeholder:text-[#516B61] focus:border-[#152B23] focus:bg-white transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => updateParams({ q: null })}
                aria-label="Clear search query"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#516B61] hover:text-[#152B23] cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <label className="sm:w-52 flex items-center gap-2 px-3 h-11 bg-[#F6F1E5]/70 border border-[#C6D8CE] text-xs font-mono text-[#152B23] md:hidden">
            <MapPin className="w-3.5 h-3.5 text-[#516B61] shrink-0" aria-hidden="true" />
            <span className="sr-only">Location filter</span>
            <select
              aria-label="Location filter"
              value={location}
              onChange={(e) => updateParams({ loc: e.target.value })}
              className="w-full bg-transparent text-xs font-mono focus:outline-none"
            >
              {LOCATION_OPTIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Six Category Chips + All (compact square Stitch buttons) */}
        <div className="flex flex-col gap-3">
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
                      ? 'bg-[#152B23] text-white border-[#152B23]'
                      : 'bg-[#EAF7EF]/45 text-[#152B23] border-[#C6D8CE] hover:border-[#152B23] hover:bg-[#EAF7EF]'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Stage filter strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#C6D8CE]/60">
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
                        ? 'bg-[#F6F1E5] text-[#152B23] border border-[#152B23] font-semibold'
                        : 'text-[#516B61] hover:text-[#152B23] border border-transparent'
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
                className="font-mono text-[11px] uppercase tracking-wider text-[#152B23] underline underline-offset-4 hover:text-[#A63A2B] cursor-pointer"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      </section>

      {/* No Results State */}
      {filteredPools.length === 0 ? (
        <section
          aria-label="No matching pools"
          className="bg-white border border-[#C6D8CE] p-8 sm:p-12 text-center space-y-4"
        >
          <p className="font-mono text-xs uppercase tracking-wider text-[#516B61]">
            0 matching buying pools
          </p>
          <h2 className="font-display text-2xl text-[#152B23] uppercase">
            No pools match these filters yet
          </h2>
          <p className="text-sm text-[#516B61] max-w-md mx-auto">
            Try clearing your search or location filter, or start a new neighborhood pool with your
            exact specifications.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={resetFilters}
              className="px-4 py-2.5 bg-white border border-[#152B23] text-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider hover:bg-[#F6F1E5] cursor-pointer"
            >
              Reset all filters
            </button>
            <Link
              to="/start"
              className="px-4 py-2.5 bg-[#FFBF32] hover:bg-[#F2B01E] border border-[#152B23] text-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider"
            >
              Start a new pool
            </Link>
          </div>
        </section>
      ) : (
        <>
          {/* Featured Pool Asymmetric Split Card (matches tally-explore.jpg) */}
          {featuredPool && featuredMeter && (
            <article
              aria-label={`Featured pool: ${featuredPool.title}`}
              className="bg-white border border-[#C6D8CE] grid grid-cols-1 lg:grid-cols-12 items-stretch"
            >
              {/* Left 50%: Stitch Truck Photo */}
              <div className="lg:col-span-6 relative min-h-[240px] sm:min-h-[300px] lg:min-h-[340px] bg-[#152B23]">
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

              {/* Right 50%: Crisp Editorial Spec, Tally & Primary Action */}
              <div className="lg:col-span-6 p-5 sm:p-7 flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[#516B61]">
                      {featuredPool.location} ·{' '}
                      {featuredPool.currentOffer
                        ? `Closes ${formatShortDate(featuredPool.currentOffer.closeAt)}`
                        : `Goal ${formatCalendarDate(featuredPool.goalDate)}`}
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
                    <p className="mt-1.5 text-sm text-[#516B61] leading-relaxed">
                      {featuredPool.subtitle}
                    </p>
                  </div>

                  {featuredPool.currentOffer && (
                    <div className="p-3 bg-[#F6F1E5] border border-[#C6D8CE] flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-xs text-[#152B23]">
                        {featuredPool.currentOffer.sellerName} · Offer v
                        {featuredPool.currentOffer.version}
                      </span>
                      <span className="font-mono text-sm font-semibold text-[#152B23] tabular-nums">
                        {formatCurrency(featuredPool.currentOffer.subtotal)} subtotal
                      </span>
                    </div>
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

                  <div className="flex items-center justify-between text-[11px] font-mono text-[#516B61] uppercase">
                    <span>
                      Threshold: {formatUnit(featuredPool.metrics.targetMin, featuredPool.unitSingular, featuredPool.unitPlural)}
                    </span>
                    <span>
                      Counts {featuredPool.unitPlural}
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
                      className={`px-3.5 border transition-colors cursor-pointer ${
                        featuredFollowing
                          ? 'bg-[#152B23] text-[#FFBF32] border-[#152B23]'
                          : 'bg-[#EAF7EF]/60 text-[#152B23] border-[#C6D8CE] hover:border-[#152B23]'
                      }`}
                    >
                      {featuredFollowing ? (
                        <Check className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Bookmark className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          )}

          {/* Secondary Directory Grid (Active Pools, Ready-to-Claim Payoff, Past Outcomes) */}
          {secondaryPools.length > 0 && (
            <section aria-label="Directory of buying pools" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
                    Active & recent pools
                  </h2>
                  <span className="px-2 py-0.5 bg-white border border-[#C6D8CE] font-mono text-[11px] text-[#516B61]">
                    {secondaryPools.length} listed
                  </span>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-wider text-[#516B61]">
                  Multi-category neighborhood circular
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {secondaryPools.map((pool) => {
                  const meter = getMeterState(pool);
                  const st = pool.metrics.effectiveStage;
                  const isUnlocked = st === 'unlocked';
                  const dest = getPoolPrimaryDestination(pool, actorId, role);
                  const ctaLabel = getPoolPrimaryCtaLabel(pool, actorId, role);

                  return (
                    <article
                      key={pool.id}
                      className={`bg-white border flex flex-col justify-between transition-transform hover:-translate-y-0.5 ${
                        isUnlocked
                          ? 'border-[#152B23] shadow-[3px_3px_0px_#152B23]'
                          : 'border-[#C6D8CE]'
                      }`}
                    >
                      {/* Selective editorial imagery where present */}
                      {pool.imageUrl && (
                        <div className="aspect-[16/9] bg-[#F6F1E5] border-b border-[#C6D8CE] overflow-hidden relative">
                          <PoolImage
                            src={pool.imageUrl}
                            alt={pool.imageAlt}
                            category={pool.category}
                            title={pool.title}
                          />
                          {isUnlocked && (
                            <span className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-[#152B23] text-[#FFBF32] font-mono text-[10px] font-semibold uppercase tracking-wider">
                              Payoff unlocked
                            </span>
                          )}
                        </div>
                      )}

                      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61]">
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

                          <p className="text-xs text-[#516B61]">
                            {pool.location} ·{' '}
                            {st === 'closed'
                              ? 'Completed cohort'
                              : pool.currentOffer
                                ? `Claim by ${formatCalendarDate(pool.currentOffer.claimByDate)}`
                                : `Target ${formatCalendarDate(pool.goalDate)}`}
                          </p>

                          {/* Ready-to-claim payoff receipt line or past outcome line */}
                          {isUnlocked && pool.currentOffer && (
                            <div className="p-2.5 bg-[#EAF7EF] border border-[#B7DEC5] text-xs text-[#152B23] flex items-baseline justify-between gap-2">
                              <span className="font-medium">Unlocked group subtotal</span>
                              <span className="font-mono font-semibold tabular-nums">
                                {formatCurrency(pool.currentOffer.subtotal)}
                              </span>
                            </div>
                          )}

                          {st === 'closed' && pool.outcomeSummary && (
                            <p className="p-2.5 bg-[#F6F1E5] border border-[#C6D8CE] text-xs text-[#152B23]">
                              {pool.outcomeSummary}
                            </p>
                          )}
                        </div>

                        <div className="space-y-3 pt-2 border-t border-[#C6D8CE]/60">
                          <SegmentedTally
                            current={meter.current}
                            target={meter.target}
                            unitSingular={pool.unitSingular}
                            unitPlural={pool.unitPlural}
                            verb={meter.verb}
                            rightLabel={meter.rightLabel}
                            compact
                          />

                          <Link
                            to={dest}
                            className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 border font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                              isUnlocked
                                ? 'bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border-[#152B23]'
                                : 'bg-[#EAF7EF]/60 hover:bg-[#152B23] text-[#152B23] hover:text-white border-[#C6D8CE] hover:border-[#152B23]'
                            }`}
                          >
                            <span>{ctaLabel}</span>
                            <ArrowRight className="w-3 h-3" aria-hidden="true" />
                          </Link>
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
