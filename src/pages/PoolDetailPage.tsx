import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  MapPin,
  MessageSquare,
  PlusCircle,
  Scale,
  Settings2,
  Tag,
} from 'lucide-react';
import { buildQueryFromPool, findCompetingPoolCounts } from '../domain/competingPoolsEngine.ts';
import { canManagePool, evaluateMemberEligibility } from '../domain/tallyEngine.ts';
import type { SimilarPoolCandidate, SimilarPoolReference } from '../domain/types.ts';
import { ApiRequestError, useTally } from '../lib/api.ts';
import {
  formatCalendarDate,
  formatCurrency,
  formatDateTimePacific,
  formatUnit,
  getInitials,
  getPoolShortCode,
  getStageLabel,
  getStageToneClasses,
} from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import { CompetingPoolsComparison } from '../components/CompetingPoolsComparison.tsx';
import { PoolImage } from '../components/PoolImage.tsx';
import { SegmentedTally } from '../components/SegmentedTally.tsx';

export function PoolDetailPage({ poolId }: { poolId: string }) {
  const {
    session,
    role,
    busy,
    joinPoolAction,
    leavePoolAction,
    toggleFollowAction,
    postDiscussionAction,
    findSimilarPoolsAction,
    showBanner,
  } = useTally();
  const { lastExploreUrl, navigate } = useRouter();

  const pool = session?.pools.find((p) => p.id === poolId);
  const actorId = session?.actor.id ?? 'buyer-maya';

  const existingMember = useMemo(
    () => pool?.members.find((m) => m.userId === actorId),
    [pool, actorId]
  );

  // Competing pools comparison on Pool Detail
  const competingCount = useMemo(() => {
    if (!session || !pool) return 0;
    const counts = findCompetingPoolCounts(session.pools, session.demoNow);
    return counts[pool.id] ?? 0;
  }, [session, pool]);
  const [compareExpanded, setCompareExpanded] = useState(false);
  const [compareCandidates, setCompareCandidates] = useState<SimilarPoolCandidate[]>([]);
  const [compareReferencePools, setCompareReferencePools] = useState<SimilarPoolReference[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Form state for joining / editing preferences
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [memberNote, setMemberNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Discussion composer
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);

  // Mobile sticky bar visibility: only render when inline primary action scrolls out of viewport on mobile (<640px)
  const inlineActionRef = useRef<HTMLDivElement | null>(null);
  const tallyCardRef = useRef<HTMLDivElement | null>(null);
  const stickyBarRef = useRef<HTMLDivElement | null>(null);
  const joinFormRef = useRef<HTMLFormElement | null>(null);
  const pendingFocusTargetRef = useRef<'inline' | 'sticky' | 'form' | null>(null);
  const [inlineActionVisible, setInlineActionVisible] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 639px)').matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (!e.matches && stickyBarRef.current?.contains(document.activeElement)) {
        pendingFocusTargetRef.current = 'inline';
      }
      setIsMobileViewport(e.matches);
    };
    setIsMobileViewport(mq.matches);
    mq.addEventListener('change', handleMediaChange);
    return () => mq.removeEventListener('change', handleMediaChange);
  }, []);

  useEffect(() => {
    const el = inlineActionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]) {
          const nextVisible = entries[0].isIntersecting;
          if (!nextVisible && inlineActionRef.current) {
            const primaryInline = inlineActionRef.current.querySelector<HTMLElement>('[data-primary-cta]');
            if (primaryInline && document.activeElement === primaryInline) {
              pendingFocusTargetRef.current = 'sticky';
            }
          } else if (nextVisible && stickyBarRef.current?.contains(document.activeElement)) {
            pendingFocusTargetRef.current = 'inline';
          }
          setInlineActionVisible(nextVisible);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [pool?.id, showJoinForm, pool?.metrics.effectiveStage]);

  const effectiveStage = pool?.metrics.effectiveStage;
  const stickyBarActive = Boolean(
    pool &&
      isMobileViewport &&
      !inlineActionVisible &&
      !showJoinForm &&
      role !== 'seller' &&
      effectiveStage !== 'closed' &&
      effectiveStage !== 'quote_requested'
  );

  useEffect(() => {
    if (showJoinForm && pendingFocusTargetRef.current === 'form') {
      pendingFocusTargetRef.current = null;
      const firstControl = joinFormRef.current?.querySelector<HTMLElement>(
        'select, input, textarea, button'
      );
      firstControl?.focus({ preventScroll: true });
      return;
    }

    if (stickyBarActive) {
      const primaryInline = inlineActionRef.current?.querySelector<HTMLElement>('[data-primary-cta]');
      if (
        pendingFocusTargetRef.current === 'sticky' ||
        (primaryInline && document.activeElement === primaryInline)
      ) {
        pendingFocusTargetRef.current = null;
        const primarySticky = stickyBarRef.current?.querySelector<HTMLElement>('[data-primary-cta]');
        primarySticky?.focus({ preventScroll: true });
      }
    } else if (pendingFocusTargetRef.current === 'inline') {
      pendingFocusTargetRef.current = null;
      const primaryInline = inlineActionRef.current?.querySelector<HTMLElement>('[data-primary-cta]');
      primaryInline?.focus({ preventScroll: true });
    }
  }, [stickyBarActive, showJoinForm]);

  useEffect(() => {
    if (!pool) return;
    if (existingMember) {
      setQuantity(existingMember.quantity);
      setSelectedOptions({ ...existingMember.selectedOptions });
      setMemberNote(existingMember.note ?? '');
    } else {
      const defaults: Record<string, string> = {};
      for (const g of pool.optionGroups) {
        defaults[g.id] = g.allowedValues[0] || g.allValues[0] || '';
      }
      setQuantity(1);
      setSelectedOptions(defaults);
      setMemberNote('');
    }
    setCompareExpanded(false);
    setCompareCandidates([]);
    setCompareReferencePools([]);
    setCompareError(null);
  }, [pool?.id, existingMember?.id, existingMember?.quantity]);

  const loadSimilarForDetail = async () => {
    if (!pool) return;
    setCompareLoading(true);
    setCompareError(null);
    try {
      const res = await findSimilarPoolsAction(buildQueryFromPool(pool));
      setCompareCandidates(res.candidates);
      setCompareReferencePools(res.referencePools ?? []);
    } catch (err) {
      setCompareError(
        err instanceof ApiRequestError
          ? err.error.message
          : 'Could not load similar pools right now.'
      );
    } finally {
      setCompareLoading(false);
    }
  };

  const handleToggleCompare = () => {
    const next = !compareExpanded;
    setCompareExpanded(next);
    if (next) {
      void loadSimilarForDetail();
    }
  };

  if (!pool) {
    return (
      <div className="bg-white border border-[#CDD6CC] p-8 max-w-lg mx-auto text-center space-y-3">
        <h1 className="font-display text-2xl text-[#152B23] uppercase">Pool not found</h1>
        <p className="text-sm text-[#4E6359]">
          This pool link does not exist in your current demo session.
        </p>
        <Link
          to={lastExploreUrl}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase text-[#152B23]"
        >
          Back to Explore
        </Link>
      </div>
    );
  }

  const metrics = pool.metrics;
  const stage = metrics.effectiveStage;
  const isPoolOwner = canManagePool(pool, actorId);
  const isFollowing = pool.followers.includes(actorId);
  const isGatheringOrReady = stage === 'gathering' || stage === 'ready_for_quote';
  const showConfirmedMetric =
    stage === 'offer_open' || stage === 'unlocked' || stage === 'expired' || stage === 'closed';
  const canJoinOrEdit =
    role !== 'seller' &&
    (stage === 'gathering' || stage === 'ready_for_quote' || stage === 'quote_requested');
  const inlineOfferLinkDuplicated =
    stickyBarActive && (stage === 'offer_open' || stage === 'expired' || stage === 'unlocked');
  const inlineRequestQuoteDuplicated =
    stickyBarActive && isPoolOwner && stage === 'ready_for_quote';
  const inlineJoinDuplicated =
    stickyBarActive && canJoinOrEdit && !showJoinForm && !inlineRequestQuoteDuplicated;

  const variantHeadline = useMemo(() => {
    const parts: string[] = [];
    for (const g of pool.optionGroups) {
      if (g.id === 'delivery') continue;
      if (g.allowedValues.length > 0) {
        parts.push(`${g.label}: ${g.allowedValues.join(', ')}`);
      }
    }
    return parts.join(' · ');
  }, [pool.optionGroups]);

  // Evaluate preview eligibility of currently chosen form values
  const draftEligibility = evaluateMemberEligibility(pool, {
    id: 'preview',
    userId: actorId,
    displayName: 'You',
    location: pool.location,
    quantity,
    selectedOptions,
    joinedAt: '',
    status: 'interested',
  });

  const existingEligibility = existingMember
    ? evaluateMemberEligibility(pool, existingMember)
    : null;

  // Separate eligible vs excluded members for transparent ledger
  const eligibleMembers = pool.members.filter(
    (m) => evaluateMemberEligibility(pool, m).eligible && m.status !== 'passed'
  );
  const excludedMembers = pool.members.filter(
    (m) => !evaluateMemberEligibility(pool, m).eligible
  );

  // Build initialed slot labels for the tally ticket card
  const slotLabels: string[] = [];
  for (const m of eligibleMembers) {
    const ini = m.userId === actorId ? 'YOU' : getInitials(m.displayName);
    for (let q = 0; q < m.quantity; q++) {
      slotLabels.push(ini);
    }
  }

  const fillPct = Math.min(
    100,
    Math.round((metrics.eligibleInterestedUnits / Math.max(1, metrics.targetMin)) * 100)
  );

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await joinPoolAction(pool.id, {
        quantity,
        selectedOptions,
        note: memberNote,
      });
      setShowJoinForm(false);
    } catch (err) {
      setFormError(
        err instanceof ApiRequestError
          ? err.error.message
          : 'Could not save your pool participation.'
      );
    }
  };

  const handleLeave = async () => {
    setFormError(null);
    try {
      await leavePoolAction(pool.id);
      setShowJoinForm(false);
    } catch (err) {
      setFormError(
        err instanceof ApiRequestError ? err.error.message : 'Unable to leave pool right now.'
      );
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCommentError(null);
    if (commentBody.trim().length < 2) {
      setCommentError('Write a question or note before posting.');
      return;
    }
    try {
      await postDiscussionAction(pool.id, commentBody, false);
      setCommentBody('');
      showBanner('success', 'Posted to pool discussion.');
    } catch (err) {
      setCommentError(
        err instanceof ApiRequestError ? err.error.message : 'Could not post comment.'
      );
    }
  };

  // 3-Step Stage Sequence states using actual Tally domain stage values
  const step1Done = stage !== 'gathering';
  const step2Active = stage === 'ready_for_quote' || stage === 'quote_requested';
  const step2Done =
    stage === 'offer_open' || stage === 'unlocked' || stage === 'expired' || stage === 'closed';
  const step3Active =
    stage === 'offer_open' || stage === 'unlocked' || stage === 'expired' || stage === 'closed';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#CDD6CC]">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 sm:gap-2 font-mono text-[11px] sm:text-xs text-[#4E6359] min-w-0"
        >
          <Link
            to={lastExploreUrl}
            className="inline-flex items-center gap-1 text-[#152B23] underline underline-offset-4 hover:text-[#1E4334] whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Back to pools</span>
          </Link>
          <span aria-hidden="true" className="shrink-0 text-[#8C9A86]">
            /
          </span>
          <span className="shrink-0">{pool.category}</span>
          <span aria-hidden="true" className="shrink-0 text-[#8C9A86]">
            /
          </span>
          <span className="text-[#152B23] font-medium truncate">{pool.title}</span>
        </nav>

        <span
          className={`px-2.5 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 ${getStageToneClasses(
            stage
          )}`}
        >
          {getStageLabel(stage)}
        </span>
      </div>

      {/* Top Section: Item/Model, Meaningful Variant, Location & Purchase Timing */}
      <header className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] sm:text-[11px] uppercase tracking-wider text-[#4E6359]">
              Pool #{getPoolShortCode(pool)} · {pool.category} · Organized by {pool.organizerName}
            </p>
            <h1 className="font-display text-2xl leading-tight sm:text-4xl tracking-tight text-[#152B23]">
              {pool.title}
            </h1>
            {variantHeadline && (
              <p className="text-sm sm:text-base font-medium text-[#1E4334]">{variantHeadline}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-[13px] font-mono text-[#4E6359] pt-0.5">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#8C9A86] shrink-0" aria-hidden="true" />
                <span>
                  {pool.location} · {pool.deliveryOrDestination}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#8C9A86] shrink-0" aria-hidden="true" />
                <span>
                  {pool.currentOffer
                    ? `Offer closes ${formatDateTimePacific(
                        pool.currentOffer.closeAt,
                        pool.currentOffer.timezoneLabel
                      )} · Claim by ${formatCalendarDate(pool.currentOffer.claimByDate)}`
                    : `Target purchase date ${formatCalendarDate(pool.goalDate, {
                        includeYear: true,
                      })}`}
                </span>
              </span>
            </div>
          </div>

          {isPoolOwner && (
            <Link
              to={`/pools/${pool.id}/organize`}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1E4334] text-white hover:bg-[#152B23] font-mono text-[11px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap self-start sm:self-auto"
            >
              <Settings2 className="w-3.5 h-3.5 text-[#FFBF32]" aria-hidden="true" />
              <span>Organizer workspace</span>
            </Link>
          )}
        </div>

        {/* Clean 3-Step Stage Sequence */}
        <ol
          aria-label="Buying pool stages"
          className="grid grid-cols-1 sm:grid-cols-3 border border-[#CDD6CC] bg-[#FBF9F4] divide-y sm:divide-y-0 sm:divide-x divide-[#CDD6CC]"
        >
          <li
            aria-current={!step1Done ? 'step' : undefined}
            className={`px-4 py-3 space-y-0.5 ${
              !step1Done ? 'bg-[#1E4334] text-white' : 'bg-[#EFF3ED]/70 text-[#152B23]'
            }`}
          >
            <p
              className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${
                !step1Done ? 'text-[#FFBF32]' : 'text-[#1E4334]'
              }`}
            >
              Step 1 · Gathering {step1Done ? '✓' : '· Current'}
            </p>
            <p className="font-mono text-xs tabular-nums">
              {metrics.eligibleInterestedUnits} of {metrics.targetMin} {pool.unitPlural} interested
            </p>
          </li>

          <li
            aria-current={step2Active ? 'step' : undefined}
            className={`px-4 py-3 space-y-0.5 ${
              step2Active
                ? 'bg-[#FFBF32] text-[#152B23]'
                : step2Done
                  ? 'bg-[#EFF3ED]/70 text-[#152B23]'
                  : 'text-[#4E6359]'
            }`}
          >
            <p
              className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${
                step2Active
                  ? 'text-[#152B23]'
                  : step2Done
                    ? 'text-[#1E4334]'
                    : 'text-[#4E6359]'
              }`}
            >
              Step 2 · Requesting quote {step2Done ? '✓' : step2Active ? '· Current' : ''}
            </p>
            <p className="font-mono text-xs">
              {stage === 'ready_for_quote'
                ? 'Minimum met — ready for seller'
                : stage === 'quote_requested'
                  ? 'Aggregate request sent to seller'
                  : step2Done
                    ? 'Seller quote received'
                    : `Starts at ${metrics.targetMin} ${pool.unitPlural}`}
            </p>
          </li>

          <li
            aria-current={step3Active ? 'step' : undefined}
            className={`px-4 py-3 space-y-0.5 ${
              stage === 'offer_open'
                ? 'bg-[#FFBF32] text-[#152B23]'
                : stage === 'unlocked'
                  ? 'bg-[#1E4334] text-white'
                  : stage === 'expired' || stage === 'closed'
                    ? 'bg-[#ECEEE7] text-[#152B23]'
                    : 'text-[#4E6359]'
            }`}
          >
            <p
              className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${
                stage === 'unlocked'
                  ? 'text-[#FFBF32]'
                  : stage === 'offer_open'
                    ? 'text-[#152B23]'
                    : 'text-[#4E6359]'
              }`}
            >
              Step 3 · Offer review &amp; unlock {step3Active ? '· Current' : ''}
            </p>
            <p className="font-mono text-xs tabular-nums">
              {stage === 'offer_open' &&
                `${metrics.confirmedUnits} of ${metrics.targetMin} confirmed`}
              {stage === 'unlocked' &&
                `Unlocked (${metrics.confirmedUnits} confirmed)`}
              {stage === 'expired' &&
                `Expired short (${metrics.confirmedUnits}/${metrics.targetMin})`}
              {stage === 'closed' && 'Completed cohort'}
              {!step3Active && 'Confirm only after quote review'}
            </p>
          </li>
        </ol>
      </header>

      {/* Same-Item Competing Pools Banner (only shown when real similar pools exist in session) */}
      {competingCount > 0 && (
        <section
          aria-label="Compare similar buying pools"
          className="bg-[#F6F1E5] border border-[#8C9A86] p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-start sm:items-center gap-2 text-xs text-[#152B23]">
              <Scale className="w-4 h-4 text-[#1E4334] shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
              <span>
                <strong>
                  {competingCount} other similar {competingCount === 1 ? 'pool' : 'pools'}
                </strong>{' '}
                for this item {competingCount === 1 ? 'exists' : 'exist'} in this session. Compare
                interested vs confirmed progress, location, timing, and published quotes before
                deciding.
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggleCompare}
              aria-expanded={compareExpanded}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#1E4334] text-[#152B23] hover:text-white border border-[#1E4334] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <span>{compareExpanded ? 'Hide comparison' : `Compare ${competingCount} similar`}</span>
              {compareExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>

          {compareExpanded && (
            <div className="pt-2 border-t border-[#CDD6CC]">
              <CompetingPoolsComparison
                candidates={compareCandidates}
                referencePools={compareReferencePools}
                loading={compareLoading}
                error={compareError}
                onRetry={() => void loadSimilarForDetail()}
                onRefreshCandidates={() => void loadSimilarForDetail()}
                referencePool={pool}
                emptyTitle="No other compatible pools found"
                emptyDescription="No other pools currently match this item in your session."
              />
            </div>
          )}
        </section>
      )}

      {/* Asymmetric 2-Column Layout — Mobile places Participation Card ABOVE specs/discussion */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
        {/* Right Column on Desktop, FIRST Action Card on Mobile */}
        <aside
          ref={tallyCardRef}
          aria-label="Pool tally and participation"
          className="lg:col-span-5 order-1 lg:order-2 lg:sticky lg:top-20 space-y-4"
        >
          {/* Perforated Tally Participation Ticket Card */}
          <div className="relative bg-white border-2 border-[#1E4334] shadow-[4px_4px_0px_#152B23]">
            {/* Subtle side ticket notches matching warm off-white page canvas */}
            <span
              aria-hidden="true"
              className="hidden sm:block absolute -left-2 top-14 w-3.5 h-3.5 rounded-full bg-[#F5F3EC] border-r-2 border-[#1E4334]"
            />
            <span
              aria-hidden="true"
              className="hidden sm:block absolute -right-2 top-14 w-3.5 h-3.5 rounded-full bg-[#F5F3EC] border-l-2 border-[#1E4334]"
            />

            <div className="px-4 sm:px-5 py-3 bg-[#F6F1E5] border-b border-dashed border-[#1E4334]/40 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
                  Participation tally · Pool #{getPoolShortCode(pool)}
                </p>
                <span
                  className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase whitespace-nowrap shrink-0 ${getStageToneClasses(
                    stage
                  )}`}
                >
                  {getStageLabel(stage)}
                </span>
              </div>
              <p className="font-mono text-xs font-semibold text-[#152B23] leading-snug">
                Target: {formatUnit(metrics.targetMin, pool.unitSingular, pool.unitPlural)} min ·{' '}
                {metrics.targetCap} cap
              </p>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              {/* Explicit 3-Column Separation: Interested vs Confirmed vs Target */}
              <dl className="grid grid-cols-3 gap-2 py-2.5 px-3 bg-[#F7F5EE] border border-[#CDD6CC]">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
                    Interested
                  </dt>
                  <dd className="mt-0.5 font-mono text-lg sm:text-xl font-bold text-[#152B23] tabular-nums">
                    {metrics.eligibleInterestedUnits}
                  </dd>
                </div>
                <div className="border-l border-[#CDD6CC] pl-2.5">
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
                    {stage === 'closed' ? 'Fulfilled' : 'Confirmed'}
                  </dt>
                  <dd className="mt-0.5 font-mono text-lg sm:text-xl font-bold text-[#152B23] tabular-nums">
                    {showConfirmedMetric
                      ? stage === 'closed'
                        ? metrics.fulfilledUnits || metrics.confirmedUnits
                        : metrics.confirmedUnits
                      : 0}
                  </dd>
                </div>
                <div className="border-l border-[#CDD6CC] pl-2.5">
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
                    Target min
                  </dt>
                  <dd className="mt-0.5 font-mono text-lg sm:text-xl font-bold text-[#1E4334] tabular-nums">
                    {metrics.targetMin}
                  </dd>
                </div>
              </dl>

              <div className="flex items-baseline justify-between gap-2 font-mono text-xs text-[#4E6359]">
                <span>
                  {stage === 'gathering' &&
                    `${metrics.remainingToMinimum} more eligible ${
                      metrics.remainingToMinimum === 1 ? pool.unitSingular : pool.unitPlural
                    } to request a seller quote`}
                  {stage === 'ready_for_quote' &&
                    'Minimum interest reached — organizer can request a seller quote.'}
                  {stage === 'quote_requested' &&
                    'Waiting for seller quote. No commitment until terms are published.'}
                  {stage === 'offer_open' &&
                    `Seller quote live (${pool.currentOffer?.sellerName}). Confirm only if terms fit.`}
                  {stage === 'unlocked' && 'Group price unlocked for confirmed buyers.'}
                  {stage === 'expired' && 'Offer closed short of minimum confirmations.'}
                  {stage === 'closed' && (pool.outcomeSummary || 'Completed buying pool.')}
                </span>
                <span className="shrink-0 font-semibold text-[#152B23] tabular-nums">
                  {fillPct}%
                </span>
              </div>

              <SegmentedTally
                current={
                  stage === 'offer_open' || stage === 'unlocked' || stage === 'expired'
                    ? metrics.confirmedUnits
                    : metrics.eligibleInterestedUnits
                }
                target={metrics.targetMin}
                unitSingular={pool.unitSingular}
                unitPlural={pool.unitPlural}
                verb={
                  stage === 'offer_open' || stage === 'unlocked' || stage === 'expired'
                    ? 'confirmed'
                    : 'interested'
                }
                variant="ticket"
                slotLabels={slotLabels}
              />

              <div className="flex items-center justify-between font-mono text-[11px] text-[#4E6359]">
                <span>{formatUnit(metrics.targetCap, pool.unitSingular, pool.unitPlural)} cap</span>
                <span>
                  {metrics.excludedUnits > 0
                    ? `${metrics.excludedUnits} excluded (incompatible)`
                    : 'Confirmed only after quote'}
                </span>
              </div>

              {/* Personal Status Box */}
              {existingMember && (
                <div
                  className={`p-3 border text-xs space-y-1 ${
                    existingEligibility?.eligible
                      ? 'bg-[#EFF3ED] border-[#8C9A86] text-[#152B23]'
                      : 'bg-[#FDF4F2] border-[#E6C4BE] text-[#A63A2B]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-mono font-semibold uppercase text-[11px]">
                    <span>
                      {existingEligibility?.eligible
                        ? `Your status: In pool (${formatUnit(
                            existingMember.quantity,
                            pool.unitSingular,
                            pool.unitPlural
                          )})`
                        : 'Excluded from eligible demand'}
                    </span>
                    <span className="capitalize">{existingMember.status}</span>
                  </div>
                  {!existingEligibility?.eligible && existingEligibility?.reasons && (
                    <p className="leading-relaxed">
                      {existingEligibility.reasons.join(' ')} Edit your options below to match the
                      group requirements.
                    </p>
                  )}
                </div>
              )}

              {/* Primary Action Area (observed for mobile sticky bar handoff) */}
              <div ref={inlineActionRef}>
                {stage === 'offer_open' || stage === 'expired' ? (
                  <div className="space-y-2">
                    <Link
                      to={`/pools/${pool.id}/offer`}
                      data-primary-cta="true"
                      aria-hidden={inlineOfferLinkDuplicated || undefined}
                      tabIndex={inlineOfferLinkDuplicated ? -1 : undefined}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 sm:py-3.5 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider transition-colors"
                    >
                      <span>
                        {stage === 'expired' ? 'View expired offer details' : 'Review quote & decide'}
                      </span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                    {pool.currentOffer && (
                      <p className="text-[11px] font-mono text-center text-[#4E6359]">
                        Closes{' '}
                        {formatDateTimePacific(
                          pool.currentOffer.closeAt,
                          pool.currentOffer.timezoneLabel
                        )}
                      </p>
                    )}
                  </div>
                ) : stage === 'unlocked' ? (
                  <div className="space-y-2">
                    {role === 'buyer' &&
                    existingMember &&
                    (existingMember.status === 'confirmed' ||
                      existingMember.status === 'fulfilled') ? (
                      <Link
                        to={`/pools/${pool.id}/claim`}
                        data-primary-cta="true"
                        aria-hidden={inlineOfferLinkDuplicated || undefined}
                        tabIndex={inlineOfferLinkDuplicated ? -1 : undefined}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 sm:py-3.5 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider"
                      >
                        <span>
                          {existingMember.status === 'fulfilled'
                            ? 'View fulfilled claim pass'
                            : 'View unlocked claim instructions'}
                        </span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    ) : (
                      <Link
                        to={`/pools/${pool.id}/offer`}
                        data-primary-cta="true"
                        aria-hidden={inlineOfferLinkDuplicated || undefined}
                        tabIndex={inlineOfferLinkDuplicated ? -1 : undefined}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#1E4334] hover:bg-[#152B23] text-white font-mono text-xs font-semibold uppercase tracking-wider"
                      >
                        <span>View unlocked quote receipt</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                ) : stage === 'quote_requested' ? (
                  <div className="space-y-2.5">
                    <div className="p-3 bg-[#F6F1E5] border border-[#8C9A86] text-xs text-[#152B23]">
                      <p className="font-mono font-semibold uppercase text-[11px]">
                        Waiting for seller quote
                      </p>
                      <p className="mt-1 text-[#4E6359]">
                        The organizer submitted the aggregate group spec. You will review exact
                        pricing before confirming.
                      </p>
                    </div>
                    {role === 'seller' && pool.sellerToken && (
                      <Link
                        to={`/s/${pool.sellerToken}`}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider"
                      >
                        <span>Open seller quote form</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    )}
                    {isPoolOwner && (
                      <Link
                        to={`/pools/${pool.id}/organize`}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#1E4334] text-white font-mono text-xs font-semibold uppercase tracking-wider"
                      >
                        <span>View private seller link</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                ) : stage === 'closed' ? (
                  <div className="p-3 bg-[#F6F1E5] border border-[#CDD6CC] text-xs text-[#4E6359] text-center">
                    Past completed cohort — no longer open for joining.
                  </div>
                ) : (
                  /* Gathering or Ready for quote */
                  <div className="space-y-2.5 sm:space-y-3">
                    {isPoolOwner && stage === 'ready_for_quote' && (
                      <Link
                        to={`/pools/${pool.id}/organize`}
                        data-primary-cta="true"
                        aria-hidden={inlineRequestQuoteDuplicated || undefined}
                        tabIndex={inlineRequestQuoteDuplicated ? -1 : undefined}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 sm:py-3.5 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider"
                      >
                        <span>Request seller quote ({metrics.eligibleInterestedUnits} ready)</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    )}

                    {canJoinOrEdit && !showJoinForm && (
                      <div className="space-y-1.5 sm:space-y-2">
                        <button
                          type="button"
                          data-primary-cta={!inlineRequestQuoteDuplicated ? 'true' : undefined}
                          aria-hidden={inlineJoinDuplicated || undefined}
                          tabIndex={inlineJoinDuplicated ? -1 : undefined}
                          onClick={() => {
                            pendingFocusTargetRef.current = 'form';
                            setShowJoinForm(true);
                          }}
                          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3 sm:py-3.5 border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                            !existingMember
                              ? 'bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23]'
                              : 'bg-white hover:bg-[#F6F1E5] text-[#152B23]'
                          }`}
                        >
                          <PlusCircle className="w-4 h-4" aria-hidden="true" />
                          <span>
                            {existingMember ? 'Edit my options or quantity' : 'Join pool (non-binding)'}
                          </span>
                        </button>

                        {existingMember && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleLeave()}
                            className="w-full py-1.5 text-xs font-mono uppercase tracking-wider text-[#4E6359] hover:text-[#A63A2B] underline cursor-pointer"
                          >
                            Leave pool
                          </button>
                        )}
                      </div>
                    )}

                    {role === 'seller' && (
                      <p className="p-3 bg-[#F6F1E5] border border-[#CDD6CC] text-xs text-[#4E6359]">
                        Viewing as Seller persona. Sellers receive a private aggregate request link
                        once the pool reaches minimum quantity.
                      </p>
                    )}

                    {/* Inline Join / Edit Preferences Form */}
                    {canJoinOrEdit && showJoinForm && (
                      <form
                        ref={joinFormRef}
                        onSubmit={handleJoinSubmit}
                        className="p-4 bg-[#F6F1E5] border border-[#1E4334] space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="font-mono text-xs font-semibold uppercase text-[#152B23]">
                            {existingMember ? 'Edit your interest' : 'Choose compatible options'}
                          </h3>
                          <button
                            type="button"
                            onClick={() => {
                              pendingFocusTargetRef.current = 'inline';
                              setShowJoinForm(false);
                            }}
                            className="text-xs font-mono text-[#4E6359] underline cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>

                        {pool.optionGroups.map((group) => (
                          <div key={group.id} className="space-y-1">
                            <label
                              htmlFor={`opt-${group.id}`}
                              className="block font-mono text-[11px] uppercase text-[#152B23]"
                            >
                              {group.label} {group.required ? '(Required match)' : '(Preference)'}
                            </label>
                            <select
                              id={`opt-${group.id}`}
                              value={selectedOptions[group.id] || ''}
                              onChange={(e) =>
                                setSelectedOptions((prev) => ({
                                  ...prev,
                                  [group.id]: e.target.value,
                                }))
                              }
                              className="w-full h-10 px-2.5 bg-white border border-[#8C9A86] text-sm text-[#152B23]"
                            >
                              {group.allValues.map((val) => (
                                <option key={val} value={val}>
                                  {val}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}

                        <div className="space-y-1">
                          <label
                            htmlFor="join-quantity"
                            className="block font-mono text-[11px] uppercase text-[#152B23]"
                          >
                            Quantity ({pool.unitPlural})
                          </label>
                          <input
                            id="join-quantity"
                            type="number"
                            min={1}
                            max={5}
                            value={quantity}
                            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                            className="w-24 h-10 px-3 bg-white border border-[#8C9A86] font-mono text-sm text-[#152B23]"
                          />
                        </div>

                        <div className="space-y-1">
                          <label
                            htmlFor="join-note"
                            className="block font-mono text-[11px] uppercase text-[#152B23]"
                          >
                            Optional note for organizer
                          </label>
                          <input
                            id="join-note"
                            type="text"
                            value={memberNote}
                            onChange={(e) => setMemberNote(e.target.value)}
                            placeholder="e.g., Ready for December pickup"
                            className="w-full h-10 px-2.5 bg-white border border-[#8C9A86] text-sm text-[#152B23]"
                          />
                        </div>

                        {!draftEligibility.eligible ? (
                          <div className="p-2.5 bg-[#FDF4F2] border border-[#E6C4BE] text-xs text-[#A63A2B] space-y-1">
                            <div className="flex items-center gap-1.5 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Incompatible with shared pool requirements</span>
                            </div>
                            <p>{draftEligibility.reasons.join(' ')}</p>
                            <p className="text-[11px]">
                              If saved as-is, your entry will be excluded from the eligible quote
                              count.
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-[#152B23] bg-[#EFF3ED] border border-[#8C9A86] px-2.5 py-2">
                            <Check className="w-3.5 h-3.5 text-[#1E4334] shrink-0" aria-hidden="true" />
                            <span>Matches shared requirements — counts toward eligible demand.</span>
                          </div>
                        )}

                        {formError && (
                          <p className="text-xs text-[#A63A2B] font-medium">{formError}</p>
                        )}

                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full py-3 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
                        >
                          {busy
                            ? 'Saving…'
                            : existingMember
                              ? 'Save updated options'
                              : `Confirm interest (${formatUnit(quantity, pool.unitSingular, pool.unitPlural)})`}
                        </button>
                      </form>
                    )}

                    {isGatheringOrReady && (
                      <p className="text-[11px] sm:text-xs text-center text-[#4E6359]">
                        Joining shows non-binding interest. You decide only after reviewing an
                        actual published seller quote.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Follow / Bookmark Pool Action with Honest Microcopy */}
              {role !== 'seller' && (
                <div className="pt-3 border-t border-[#CDD6CC] space-y-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggleFollowAction(pool.id)}
                    aria-pressed={isFollowing}
                    className={`w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 border font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-60 ${
                      isFollowing
                        ? 'bg-[#1E4334] text-[#FFBF32] border-[#1E4334]'
                        : 'bg-[#F7F5EE] hover:bg-[#F6F1E5] text-[#152B23] border-[#8C9A86] hover:border-[#1E4334]'
                    }`}
                  >
                    {isFollowing ? (
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>{isFollowing ? 'Following pool (saved)' : 'Follow pool'}</span>
                  </button>
                  <p className="text-[11px] text-[#4E6359] leading-snug text-center">
                    Saves this pool to My pools to check later — does not join, increase the
                    interested count, or send alert notifications.
                  </p>
                </div>
              )}

              {/* Interested Neighbors & Excluded Members List */}
              <div className="pt-4 border-t border-dashed border-[#1E4334]/30 space-y-3">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4E6359] mb-1.5">
                    Eligible interested buyers ({metrics.eligibleInterestedUnits} {pool.unitPlural})
                  </p>
                  <p className="text-xs text-[#152B23] leading-relaxed">
                    {eligibleMembers.map((m, idx) => (
                      <span key={m.id}>
                        <span className={m.userId === actorId ? 'font-semibold underline' : ''}>
                          {m.userId === actorId ? `You (${m.displayName})` : m.displayName}
                        </span>
                        <span className="text-[#4E6359]">
                          {' '}
                          ({m.location}
                          {m.quantity > 1 ? ` · ×${m.quantity}` : ''})
                        </span>
                        {idx < eligibleMembers.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </p>
                </div>

                {excludedMembers.length > 0 && (
                  <div className="p-2.5 bg-[#F6F1E5] border border-[#CDD6CC] space-y-1">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#A63A2B]">
                      Excluded from eligible demand (
                      {formatUnit(metrics.excludedUnits, pool.unitSingular, pool.unitPlural)})
                    </p>
                    {excludedMembers.map((m) => {
                      const check = evaluateMemberEligibility(pool, m);
                      return (
                        <p key={m.id} className="text-[11px] text-[#4E6359]">
                          <strong className="text-[#152B23]">{m.displayName}:</strong>{' '}
                          {check.reasons[0]}
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 sm:px-5 py-2.5 bg-[#F7F5EE] border-t border-[#CDD6CC] flex items-center justify-between font-mono text-[11px] text-[#4E6359]">
              <span>Goal {formatCalendarDate(pool.goalDate)}</span>
              <span>{pool.location}</span>
            </div>
          </div>

          {stage === 'ready_for_quote' && role === 'buyer' && !isPoolOwner && (
            <div className="p-4 bg-white border border-[#1E4334] text-xs space-y-2">
              <p className="font-mono font-semibold uppercase text-[#152B23]">
                Next step: Organizer requests quote
              </p>
              <p className="text-[#4E6359]">
                This pool now has {metrics.eligibleInterestedUnits} eligible {pool.unitPlural}. To
                continue the demo walkthrough, switch to <strong>Organizer</strong> in Demo controls
                and open the Organizer workspace.
              </p>
              <button
                type="button"
                onClick={() => navigate(`/pools/${pool.id}/organize`)}
                className="font-mono text-[11px] uppercase underline text-[#1E4334] cursor-pointer"
              >
                Preview organizer route protection →
              </button>
            </div>
          )}
        </aside>

        {/* Left Column on Desktop (Photo, Quote Status, Specs, Organizer Note, Discussion) */}
        <div className="lg:col-span-7 order-2 lg:order-1 space-y-5">
          {pool.imageUrl && (
            <figure className="bg-white border border-[#CDD6CC] overflow-hidden">
              <div className="aspect-[16/10] bg-[#1E4334]">
                <PoolImage
                  src={pool.imageUrl}
                  alt={pool.imageAlt}
                  category={pool.category}
                  title={pool.title}
                />
              </div>
              <figcaption className="px-4 py-2 bg-[#1E4334] text-white flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <span>{pool.title}</span>
                <span className="text-[#FFBF32]">
                  Target: {formatUnit(metrics.targetMin, pool.unitSingular, pool.unitPlural)}
                </span>
              </figcaption>
            </figure>
          )}

          {/* Honest Current Quote Status / Published Seller Quote Card */}
          <section
            aria-label="Current seller quote status"
            className={`border p-5 sm:p-6 space-y-3 ${
              pool.currentOffer
                ? 'bg-[#F6F1E5] border-[#1E4334]'
                : 'bg-white border-[#CDD6CC]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-bold text-[#152B23] inline-flex items-center gap-2">
                <Tag className="w-4 h-4 text-[#1E4334]" aria-hidden="true" />
                <span>
                  {pool.currentOffer ? 'Published seller quote' : 'Current quote status'}
                </span>
              </h2>
              {pool.currentOffer && (
                <span className="font-mono text-[11px] font-semibold uppercase text-[#1E4334]">
                  Offer v{pool.currentOffer.version} · {pool.currentOffer.currency}
                </span>
              )}
            </div>

            {pool.currentOffer ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2.5 border-b border-[#CDD6CC]">
                  <div>
                    <p className="font-semibold text-sm text-[#152B23]">
                      {pool.currentOffer.sellerName}
                    </p>
                    <p className="text-xs text-[#4E6359]">
                      {pool.currentOffer.sellerLocation}
                    </p>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <p className="text-xl font-bold text-[#152B23]">
                      {formatCurrency(pool.currentOffer.subtotal)}
                    </p>
                    <p className="text-[11px] text-[#4E6359]">subtotal before tax/registration</p>
                  </div>
                </div>

                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-2.5 bg-white border border-[#CDD6CC]">
                    <dt className="font-mono text-[10px] uppercase text-[#4E6359]">Unit price</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-[#152B23] tabular-nums">
                      {formatCurrency(pool.currentOffer.unitPrice)}
                    </dd>
                  </div>
                  <div className="p-2.5 bg-white border border-[#CDD6CC]">
                    <dt className="font-mono text-[10px] uppercase text-[#4E6359]">
                      {pool.currentOffer.feeLabel || 'Known fees'}
                    </dt>
                    <dd className="mt-0.5 font-mono font-semibold text-[#152B23] tabular-nums">
                      {formatCurrency(pool.currentOffer.knownFees)}
                    </dd>
                  </div>
                  <div className="p-2.5 bg-white border border-[#CDD6CC]">
                    <dt className="font-mono text-[10px] uppercase text-[#4E6359]">Group range</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-[#152B23] tabular-nums">
                      {pool.currentOffer.minQuantity}–{pool.currentOffer.maxQuantity}{' '}
                      {pool.unitPlural}
                    </dd>
                  </div>
                </dl>

                <div className="space-y-1 text-xs text-[#152B23]">
                  <p>
                    <strong className="font-mono text-[10px] uppercase text-[#4E6359]">
                      Matching scope:{' '}
                    </strong>
                    {pool.currentOffer.matchingScope}
                  </p>
                  <p>
                    <strong className="font-mono text-[10px] uppercase text-[#4E6359]">
                      Fulfillment:{' '}
                    </strong>
                    {pool.currentOffer.fulfillmentMethod} · Claim by{' '}
                    {formatCalendarDate(pool.currentOffer.claimByDate, { includeYear: true })}
                  </p>
                  <p className="text-[#4E6359]">{pool.currentOffer.taxAndRegistrationNote}</p>
                </div>

                <div className="pt-1">
                  <Link
                    to={`/pools/${pool.id}/offer`}
                    className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-[#1E4334] underline underline-offset-4 hover:text-[#152B23]"
                  >
                    <span>Open full quote receipt &amp; terms</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
                  No quote published yet
                </p>
                <p className="text-sm text-[#4E6359] leading-relaxed">
                  {stage === 'gathering' &&
                    `Pricing is only established after ${metrics.targetMin} eligible ${pool.unitPlural} gather and a seller submits a written quote for the group.`}
                  {stage === 'ready_for_quote' &&
                    'Minimum interest is met. Once the organizer sends the aggregate request and a seller responds, the quote terms will appear here.'}
                  {stage === 'quote_requested' &&
                    'The organizer has sent the aggregate specification to a seller. Exact unit pricing, fees, and inclusions will appear here as soon as the seller publishes a quote.'}
                  {stage === 'closed' &&
                    (pool.outcomeSummary || 'This cohort is closed with no active quote.')}
                </p>
              </div>
            )}
          </section>

          {/* Shared Requirements, Acceptable Options & Category Specs */}
          <section
            aria-label="Shared requirements and specifications"
            className="bg-white border border-[#CDD6CC] p-5 sm:p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-bold text-[#152B23]">
                Shared requirements &amp; acceptable specs
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
                Pool consensus
              </span>
            </div>

            {pool.categorySpecs.length > 0 && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {pool.categorySpecs.map((spec) => (
                  <div key={spec.label} className="p-3 bg-[#F7F5EE] border border-[#CDD6CC]">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
                      {spec.label}
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold text-[#152B23]">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {pool.optionGroups.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4E6359]">
                  Eligibility by option
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {pool.optionGroups.map((group) => {
                    const excluded = group.allValues.filter(
                      (v) => !group.allowedValues.includes(v)
                    );
                    return (
                      <div key={group.id} className="p-3 bg-[#FBF9F4] border border-[#CDD6CC] space-y-1 text-xs">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-[#152B23] font-semibold">
                          {group.label} {group.required ? '· Required' : '· Preference'}
                        </p>
                        <p className="text-[#1E4334]">
                          <strong>Included:</strong> {group.allowedValues.join(', ')}
                        </p>
                        {excluded.length > 0 && (
                          <p className="text-[#A63A2B]">
                            <strong>Excluded:</strong> {excluded.join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <ul className="space-y-2 pt-1">
              {pool.sharedRequirements.map((req, idx) => (
                <li key={idx} className="flex items-start gap-2.5 text-sm text-[#152B23]">
                  <span className="font-mono text-xs font-semibold text-[#4E6359] mt-0.5">
                    0{idx + 1}.
                  </span>
                  <span>{req}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Organizer Note */}
          <section
            aria-label="Organizer note"
            className="bg-[#F6F1E5] border border-[#CDD6CC] p-5 flex items-start gap-3.5"
          >
            <div
              aria-hidden="true"
              className="w-9 h-9 bg-[#FFBF32] border border-[#152B23] flex items-center justify-center font-mono text-xs font-bold text-[#152B23] shrink-0"
            >
              {getInitials(pool.organizerName).replace(/\./g, '')}
            </div>
            <div className="space-y-1">
              <p className="font-mono text-xs text-[#4E6359]">
                <strong className="text-[#152B23]">{pool.organizerName}</strong> · Organizer ·{' '}
                {pool.location}
              </p>
              <p className="text-sm text-[#152B23] leading-relaxed">“{pool.organizerNote}”</p>
            </div>
          </section>

          {/* Pool Discussion Thread */}
          <section
            id="discussion"
            aria-label="Pool discussion"
            className="bg-white border border-[#CDD6CC] p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#CDD6CC]">
              <h2 className="font-heading text-lg font-bold text-[#152B23] flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#4E6359]" aria-hidden="true" />
                <span>Pool discussion ({pool.discussion.length})</span>
              </h2>
              <span className="font-mono text-[11px] text-[#4E6359]">
                Contact details stay private
              </span>
            </div>

            {pool.discussion.length === 0 ? (
              <p className="text-sm text-[#4E6359] py-2">
                No messages yet. Ask a question about specs, timing, or delivery before joining.
              </p>
            ) : (
              <ol className="space-y-3">
                {pool.discussion.map((msg) => (
                  <li
                    key={msg.id}
                    className={`p-3.5 border ${
                      msg.isOrganizerUpdate
                        ? 'bg-[#EFF3ED] border-[#8C9A86]'
                        : 'bg-[#F7F5EE] border-[#CDD6CC]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#4E6359]">
                      <span className="text-[#152B23] font-semibold">
                        {msg.authorName}{' '}
                        {msg.isOrganizerUpdate && (
                          <span className="ml-1 px-1.5 py-0.5 bg-[#FFBF32] text-[#152B23] text-[10px] uppercase">
                            Organizer update
                          </span>
                        )}
                      </span>
                      <span>{formatDateTimePacific(msg.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-[#152B23] leading-relaxed">{msg.body}</p>
                  </li>
                ))}
              </ol>
            )}

            <form onSubmit={handlePostComment} className="pt-2 space-y-2">
              <label
                htmlFor="discussion-input"
                className="block font-mono text-[11px] uppercase tracking-wider text-[#4E6359]"
              >
                Post to discussion as {session?.actor.name}
              </label>
              <textarea
                id="discussion-input"
                rows={2}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Ask about options, pickup timing, or offer terms…"
                className="w-full p-3 bg-[#F7F5EE] border border-[#8C9A86] focus:border-[#1E4334] focus:bg-white text-sm text-[#152B23]"
              />
              {commentError && <p className="text-xs text-[#A63A2B]">{commentError}</p>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 bg-[#1E4334] hover:bg-[#152B23] text-white font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
                >
                  Post message
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      {/* Compact Sticky Mobile Buyer Bar — mounts ONLY when inline primary CTA scrolls out of view on mobile */}
      {stickyBarActive && (
        <div
          ref={stickyBarRef}
          aria-label="Quick pool action"
          className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-[#FBF9F4] border-t-2 border-[#1E4334] px-3 py-2 flex items-center justify-between gap-2.5 shadow-[0_-2px_10px_rgba(21,43,35,0.12)]"
        >
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold text-[#152B23] tabular-nums truncate">
              {stage === 'offer_open' || stage === 'unlocked' || stage === 'expired'
                ? `${metrics.confirmedUnits} of ${metrics.targetMin} confirmed`
                : `${metrics.eligibleInterestedUnits} of ${metrics.targetMin} interested`}
            </p>
            <p className="font-mono text-[10px] text-[#4E6359] truncate">{getStageLabel(stage)}</p>
          </div>

          {stage === 'offer_open' || stage === 'expired' ? (
            <Link
              to={`/pools/${pool.id}/offer`}
              data-primary-cta="true"
              className="px-3.5 py-2 bg-[#FFBF32] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0"
            >
              {stage === 'expired' ? 'View offer' : 'Review quote'}
            </Link>
          ) : stage === 'unlocked' ? (
            <Link
              to={
                role === 'buyer' &&
                existingMember &&
                (existingMember.status === 'confirmed' || existingMember.status === 'fulfilled')
                  ? `/pools/${pool.id}/claim`
                  : `/pools/${pool.id}/offer`
              }
              data-primary-cta="true"
              className="px-3.5 py-2 bg-[#FFBF32] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0"
            >
              {role === 'buyer' && existingMember ? 'Claim pass' : 'View quote'}
            </Link>
          ) : isPoolOwner && stage === 'ready_for_quote' ? (
            <Link
              to={`/pools/${pool.id}/organize`}
              data-primary-cta="true"
              className="px-3.5 py-2 bg-[#FFBF32] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0"
            >
              Request quote
            </Link>
          ) : (
            <button
              type="button"
              data-primary-cta="true"
              onClick={() => {
                pendingFocusTargetRef.current = 'form';
                setShowJoinForm(true);
                tallyCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="px-3.5 py-2 bg-[#FFBF32] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer"
            >
              {existingMember ? 'Edit options' : 'Join pool'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
