import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  PlusCircle,
  Scale,
  Settings2,
} from 'lucide-react';
import { buildQueryFromPool, findCompetingPoolCounts } from '../domain/competingPoolsEngine.ts';
import { canManagePool, evaluateMemberEligibility } from '../domain/tallyEngine.ts';
import type { SimilarPoolCandidate } from '../domain/types.ts';
import { ApiRequestError, useTally } from '../lib/api.ts';
import {
  formatCalendarDate,
  formatDateTimePacific,
  formatUnit,
  getInitials,
  getPoolShortCode,
  getStageLabel,
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
    setCompareError(null);
  }, [pool?.id, existingMember?.id, existingMember?.quantity]);

  const loadSimilarForDetail = async () => {
    if (!pool) return;
    setCompareLoading(true);
    setCompareError(null);
    try {
      const res = await findSimilarPoolsAction(buildQueryFromPool(pool));
      setCompareCandidates(res.candidates);
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
      <div className="bg-white border border-[#C6D8CE] p-8 max-w-lg mx-auto text-center space-y-3">
        <h1 className="font-display text-2xl text-[#152B23] uppercase">Pool not found</h1>
        <p className="text-sm text-[#516B61]">
          This pool link does not exist in your current demo session.
        </p>
        <Link
          to={lastExploreUrl}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase"
        >
          Back to Explore
        </Link>
      </div>
    );
  }

  const metrics = pool.metrics;
  const stage = metrics.effectiveStage;
  const isPoolOwner = canManagePool(pool, actorId);
  const isGatheringOrReady = stage === 'gathering' || stage === 'ready_for_quote';
  const canJoinOrEdit =
    role !== 'seller' &&
    (stage === 'gathering' || stage === 'ready_for_quote' || stage === 'quote_requested');
  const inlineOfferLinkDuplicated =
    stickyBarActive && (stage === 'offer_open' || stage === 'expired' || stage === 'unlocked');
  const inlineRequestQuoteDuplicated =
    stickyBarActive && isPoolOwner && stage === 'ready_for_quote';
  const inlineJoinDuplicated =
    stickyBarActive && canJoinOrEdit && !showJoinForm && !inlineRequestQuoteDuplicated;

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

  // Build initialed slot labels for the Stitch tally ticket card
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

  // Stage stepper state
  const step1Done = stage !== 'gathering';
  const step2Active = stage === 'ready_for_quote' || stage === 'quote_requested';
  const step2Done = stage === 'offer_open' || stage === 'unlocked' || stage === 'expired' || stage === 'closed';
  const step3Active = stage === 'offer_open' || stage === 'unlocked' || stage === 'expired';

  return (
    <div className="space-y-3 sm:space-y-5">
      {/* Stitch Breadcrumb & Stage Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 pb-2 sm:pb-3 border-b border-[#C6D8CE]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 sm:gap-2 font-mono text-[11px] sm:text-xs text-[#516B61] min-w-0">
          <Link
            to={lastExploreUrl}
            className="inline-flex items-center gap-1 text-[#152B23] underline underline-offset-4 hover:text-[#28463B] whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Back to pools</span>
          </Link>
          <span aria-hidden="true" className="shrink-0">/</span>
          <span className="shrink-0">{pool.category}</span>
          <span aria-hidden="true" className="shrink-0">/</span>
          <span className="text-[#152B23] font-medium truncate">
            {pool.title}
          </span>
        </nav>

        <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 font-mono text-[10px] sm:text-[11px]">
          <span
            className={`px-1.5 sm:px-2 py-0.5 ${
              !step1Done
                ? 'bg-[#152B23] text-[#FFBF32] font-semibold'
                : 'text-[#516B61]'
            }`}
          >
            1. Gathering ({metrics.eligibleInterestedUnits}/{metrics.targetMin})
          </span>
          <span className="text-[#516B61]" aria-hidden="true">·</span>
          <span
            className={`px-1.5 sm:px-2 py-0.5 ${
              step2Active
                ? 'bg-[#FFBF32] text-[#152B23] font-semibold border border-[#152B23]'
                : step2Done
                  ? 'text-[#516B61]'
                  : 'text-[#516B61]/70'
            }`}
          >
            2. Requesting quote
          </span>
          <span className="text-[#516B61]" aria-hidden="true">·</span>
          <span
            className={`px-1.5 sm:px-2 py-0.5 ${
              step3Active
                ? 'bg-[#FFBF32] text-[#152B23] font-semibold border border-[#152B23]'
                : 'text-[#516B61]/70'
            }`}
          >
            3. Offer & unlock
          </span>
        </div>
      </div>

      {/* Main Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 sm:gap-3">
        <div>
          <p className="font-mono text-[10px] sm:text-[11px] uppercase tracking-wider text-[#516B61]">
            {pool.location} · Pool #{getPoolShortCode(pool)} · Organized by {pool.organizerName}
          </p>
          <h1 className="mt-0.5 sm:mt-1 font-display text-[22px] leading-tight sm:text-4xl tracking-tight text-[#152B23]">
            {pool.title}
          </h1>
          <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-[#516B61]">
            {pool.deliveryOrDestination} · Target date {formatCalendarDate(pool.goalDate)}
          </p>
        </div>

        {/* Organizer Workspace Shortcut (shown to this pool's owner directly) */}
        {isPoolOwner && (
          <Link
            to={`/pools/${pool.id}/organize`}
            className="inline-flex items-center justify-center gap-2 px-3.5 sm:px-4 py-2 sm:py-2.5 bg-[#152B23] text-white hover:bg-[#28463B] font-mono text-[11px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap self-start sm:self-auto"
          >
            <Settings2 className="w-3.5 h-3.5 text-[#FFBF32]" aria-hidden="true" />
            <span>Organizer workspace</span>
          </Link>
        )}
      </div>

      {/* Same-Item Competing Pools Banner (only shown when real similar pools exist in session) */}
      {competingCount > 0 && (
        <section
          aria-label="Compare similar buying pools"
          className="bg-[#F6F1E5] border border-[#152B23]/40 p-3.5 sm:p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-start sm:items-center gap-2 text-xs text-[#152B23]">
              <Scale className="w-4 h-4 text-[#152B23] shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
              <span>
                <strong>
                  {competingCount} other similar {competingCount === 1 ? 'pool' : 'pools'}
                </strong>{' '}
                for this item {competingCount === 1 ? 'exists' : 'exist'} in this session. Compare
                buyer momentum, location, timing, and published quotes before deciding.
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggleCompare}
              aria-expanded={compareExpanded}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#152B23] text-[#152B23] hover:text-white border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer transition-colors"
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
            <div className="pt-2 border-t border-[#C6D8CE]">
              <CompetingPoolsComparison
                candidates={compareCandidates}
                loading={compareLoading}
                error={compareError}
                onRetry={() => void loadSimilarForDetail()}
                onRefreshCandidates={() => void loadSimilarForDetail()}
                referencePool={pool}
                emptyTitle="No other similar pools found"
                emptyDescription="No other pools currently match this item in your session."
              />
            </div>
          )}
        </section>
      )}

      {/* Asymmetric 2-Column Layout — Mobile places Tally Ticket & Primary CTA ABOVE specs/discussion */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
        {/* Right Column on Desktop, FIRST Action Card on Mobile (via order-1 lg:order-2) */}
        <aside
          ref={tallyCardRef}
          aria-label="Pool tally and participation"
          className="lg:col-span-5 order-1 lg:order-2 lg:sticky lg:top-20 space-y-4"
        >
          {/* Signature Stitch Perforated Tally Ticket Card */}
          <div className="relative bg-white border-2 border-[#152B23] shadow-[4px_4px_0px_#152B23]">
            {/* Subtle side ticket notches */}
            <span
              aria-hidden="true"
              className="hidden sm:block absolute -left-2 top-14 w-3.5 h-3.5 rounded-full bg-[#EAF7EF] border-r-2 border-[#152B23]"
            />
            <span
              aria-hidden="true"
              className="hidden sm:block absolute -right-2 top-14 w-3.5 h-3.5 rounded-full bg-[#EAF7EF] border-l-2 border-[#152B23]"
            />

            {/* Top ticket strip — stacked cleanly so label never truncates on 375px mobile */}
            <div className="px-3.5 sm:px-5 py-2.5 sm:py-3 bg-[#F6F1E5]/70 border-b border-dashed border-[#152B23]/40 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
                  Pool #{getPoolShortCode(pool)}
                </p>
                <span className="px-2 py-0.5 bg-[#EAF7EF] border border-[#152B23]/30 font-mono text-[10px] font-semibold uppercase text-[#152B23] whitespace-nowrap shrink-0">
                  {getStageLabel(stage)}
                </span>
              </div>
              <p className="font-mono text-xs font-semibold text-[#152B23] leading-snug">
                Pool tally · {formatUnit(metrics.targetMin, pool.unitSingular, pool.unitPlural)} needed
              </p>
            </div>

            {/* Live Count + Discrete Segmented Slot Boxes */}
            <div className="p-3.5 sm:p-5 space-y-3 sm:space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-2xl sm:text-4xl leading-none text-[#152B23] tabular-nums">
                    {stage === 'offer_open' || stage === 'unlocked' || stage === 'expired'
                      ? `${metrics.confirmedUnits} of ${metrics.targetMin}`
                      : `${metrics.eligibleInterestedUnits} of ${metrics.targetMin}`}
                  </p>
                  <p className="font-display text-base sm:text-xl text-[#152B23] leading-tight mt-0.5">
                    {pool.unitPlural}{' '}
                    <span className="font-sans text-xs sm:text-sm font-medium text-[#516B61]">
                      {stage === 'offer_open' || stage === 'unlocked' || stage === 'expired'
                        ? 'confirmed'
                        : 'interested'}
                    </span>
                  </p>
                </div>
                <div className="text-right font-mono">
                  <p className="text-sm font-semibold text-[#152B23] tabular-nums">{fillPct}%</p>
                  <p className="text-[10px] uppercase text-[#516B61]">eligible</p>
                </div>
              </div>

              <p className="font-mono text-[11px] sm:text-xs text-[#516B61]">
                {stage === 'gathering' &&
                  `${metrics.remainingToMinimum} more eligible ${
                    metrics.remainingToMinimum === 1 ? pool.unitSingular : pool.unitPlural
                  } to request a seller quote`}
                {stage === 'ready_for_quote' &&
                  'Minimum reached! Organizer can now generate a private seller quote request.'}
                {stage === 'quote_requested' &&
                  'Waiting for seller quote. Organizer has shared the aggregate request packet.'}
                {stage === 'offer_open' &&
                  `Seller quote is live (${pool.currentOffer?.sellerName}). Review terms to confirm.`}
                {stage === 'unlocked' && 'Your group price is unlocked for confirmed buyers.'}
                {stage === 'expired' && 'Offer closed short of minimum quantity.'}
                {stage === 'closed' && (pool.outcomeSummary || 'This buying pool is completed.')}
              </p>

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

              <div className="flex items-center justify-between font-mono text-[11px] text-[#516B61]">
                <span>{formatUnit(metrics.targetCap, pool.unitSingular, pool.unitPlural)} cap</span>
                <span>
                  {metrics.excludedUnits > 0
                    ? `${metrics.excludedUnits} excluded (incompatible)`
                    : 'Quote triggered at min'}
                </span>
              </div>

              {/* Personal Status Box */}
              {existingMember && (
                <div
                  className={`p-3 border text-xs space-y-1 ${
                    existingEligibility?.eligible
                      ? 'bg-[#EAF7EF] border-[#B7DEC5] text-[#152B23]'
                      : 'bg-[#FDF0EE] border-[#E8C2BC] text-[#A63A2B]'
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
                    <p className="text-[11px] font-mono text-center text-[#516B61]">
                      Closes {formatDateTimePacific(pool.currentOffer.closeAt, pool.currentOffer.timezoneLabel)}
                    </p>
                  )}
                </div>
              ) : stage === 'unlocked' ? (
                <div className="space-y-2">
                  {role === 'buyer' &&
                  existingMember &&
                  (existingMember.status === 'confirmed' || existingMember.status === 'fulfilled') ? (
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
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#152B23] text-white font-mono text-xs font-semibold uppercase tracking-wider"
                    >
                      <span>View unlocked quote receipt</span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              ) : stage === 'quote_requested' ? (
                <div className="space-y-2.5">
                  <div className="p-3 bg-[#F6F1E5] border border-[#152B23]/30 text-xs text-[#152B23]">
                    <p className="font-mono font-semibold uppercase text-[11px]">
                      Waiting for seller quote
                    </p>
                    <p className="mt-1 text-[#516B61]">
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
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#152B23] text-white font-mono text-xs font-semibold uppercase tracking-wider"
                    >
                      <span>View private seller link</span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              ) : stage === 'closed' ? (
                <div className="p-3 bg-[#F6F1E5] border border-[#C6D8CE] text-xs text-[#516B61] text-center">
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
                          {existingMember ? 'Edit my options or quantity' : 'Join pool'}
                        </span>
                      </button>

                      {existingMember && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleLeave()}
                          className="w-full py-1.5 sm:py-2 text-xs font-mono uppercase tracking-wider text-[#516B61] hover:text-[#A63A2B] underline cursor-pointer"
                        >
                          Leave pool
                        </button>
                      )}
                    </div>
                  )}

                  {role === 'seller' && (
                    <p className="p-3 bg-[#F6F1E5] border border-[#C6D8CE] text-xs text-[#516B61]">
                      Viewing as Seller persona. Sellers receive a private aggregate request link
                      once the pool reaches minimum quantity.
                    </p>
                  )}

                  {/* Inline Join / Edit Preferences Form */}
                  {canJoinOrEdit && showJoinForm && (
                    <form
                      ref={joinFormRef}
                      onSubmit={handleJoinSubmit}
                      className="p-4 bg-[#F6F1E5] border border-[#152B23] space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="font-mono text-xs font-semibold uppercase text-[#152B23]">
                          {existingMember ? 'Edit your commitment' : 'Choose compatible options'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => {
                            pendingFocusTargetRef.current = 'inline';
                            setShowJoinForm(false);
                          }}
                          className="text-xs font-mono text-[#516B61] underline cursor-pointer"
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
                            className="w-full h-10 px-2.5 bg-white border border-[#152B23]/40 text-sm text-[#152B23]"
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
                          className="w-24 h-10 px-3 bg-white border border-[#152B23]/40 font-mono text-sm text-[#152B23]"
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
                          className="w-full h-10 px-2.5 bg-white border border-[#152B23]/40 text-sm text-[#152B23]"
                        />
                      </div>

                      {/* Real-time compatibility preview */}
                      {!draftEligibility.eligible ? (
                        <div className="p-2.5 bg-[#FDF0EE] border border-[#E8C2BC] text-xs text-[#A63A2B] space-y-1">
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
                        <div className="flex items-center gap-1.5 text-xs text-[#152B23] bg-[#EAF7EF] border border-[#B7DEC5] px-2.5 py-2">
                          <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
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
                    <p className="text-[11px] sm:text-xs text-center text-[#516B61]">
                      Joining shows non-binding interest. You decide only after seeing the exact
                      seller quote.
                    </p>
                  )}
                </div>
              )}
              </div>

              {/* Interested Neighbors & Excluded Members List */}
              <div className="pt-4 border-t border-dashed border-[#152B23]/30 space-y-3">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61] mb-1.5">
                    Eligible interested buyers ({metrics.eligibleInterestedUnits} {pool.unitPlural})
                  </p>
                  <p className="text-xs text-[#152B23] leading-relaxed">
                    {eligibleMembers.map((m, idx) => (
                      <span key={m.id}>
                        <span className={m.userId === actorId ? 'font-semibold underline' : ''}>
                          {m.userId === actorId ? `You (${m.displayName})` : m.displayName}
                        </span>
                        <span className="text-[#516B61]">
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
                  <div className="p-2.5 bg-[#F6F1E5] border border-[#C6D8CE] space-y-1">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#A63A2B]">
                      Excluded from eligible demand ({formatUnit(metrics.excludedUnits, pool.unitSingular, pool.unitPlural)})
                    </p>
                    {excludedMembers.map((m) => {
                      const check = evaluateMemberEligibility(pool, m);
                      return (
                        <p key={m.id} className="text-[11px] text-[#516B61]">
                          <strong className="text-[#152B23]">{m.displayName}:</strong>{' '}
                          {check.reasons[0]}
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom ticket metadata */}
            <div className="px-4 sm:px-5 py-2.5 bg-[#EAF7EF]/60 border-t border-[#152B23]/20 flex items-center justify-between font-mono text-[11px] text-[#516B61]">
              <span>Goal {formatCalendarDate(pool.goalDate)}</span>
              <span>{pool.location}</span>
            </div>
          </div>

          {stage === 'ready_for_quote' && role === 'buyer' && !isPoolOwner && (
            <div className="p-4 bg-white border border-[#152B23] text-xs space-y-2">
              <p className="font-mono font-semibold uppercase text-[#152B23]">
                Next step: Organizer requests quote
              </p>
              <p className="text-[#516B61]">
                This pool now has {metrics.eligibleInterestedUnits} eligible {pool.unitPlural}. To
                continue the demo walkthrough, switch to <strong>Organizer</strong> in Demo controls
                and open the Organizer workspace.
              </p>
              <button
                type="button"
                onClick={() => navigate(`/pools/${pool.id}/organize`)}
                className="font-mono text-[11px] uppercase underline text-[#152B23] cursor-pointer"
              >
                Preview organizer route protection →
              </button>
            </div>
          )}
        </aside>

        {/* Left Column on Desktop (Photo, Specs, Organizer Note, Discussion) */}
        <div className="lg:col-span-7 order-2 lg:order-1 space-y-5">
          {/* Editorial Photo with Dark Spruce Caption Strip (matching tally-pool.jpg) */}
          {pool.imageUrl && (
            <figure className="bg-white border border-[#152B23]/25 overflow-hidden">
              <div className="aspect-[16/10] bg-[#152B23]">
                <PoolImage
                  src={pool.imageUrl}
                  alt={pool.imageAlt}
                  category={pool.category}
                  title={pool.title}
                />
              </div>
              <figcaption className="px-4 py-2 bg-[#152B23] text-white flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <span>{pool.title}</span>
                <span className="text-[#FFBF32]">
                  Target: {formatUnit(metrics.targetMin, pool.unitSingular, pool.unitPlural)}
                </span>
              </figcaption>
            </figure>
          )}

          {/* Shared Requirements & Category Specs */}
          <section
            aria-label="Shared requirements and specifications"
            className="bg-white border border-[#C6D8CE] p-5 sm:p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-bold text-[#152B23]">
                Shared requirements & acceptable specs
              </h2>
              <span className="px-2 py-0.5 bg-[#EAF7EF] border border-[#C6D8CE] font-mono text-[10px] uppercase text-[#152B23]">
                Pool consensus
              </span>
            </div>

            {pool.categorySpecs.length > 0 && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {pool.categorySpecs.map((spec) => (
                  <div key={spec.label} className="p-3 bg-[#F6F1E5]/60 border border-[#C6D8CE]/80">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
                      {spec.label}
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold text-[#152B23]">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <ul className="space-y-2 pt-1">
              {pool.sharedRequirements.map((req, idx) => (
                <li key={idx} className="flex items-start gap-2.5 text-sm text-[#152B23]">
                  <span className="font-mono text-xs font-semibold text-[#516B61] mt-0.5">
                    0{idx + 1}.
                  </span>
                  <span>{req}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Organizer Note (matching tally-pool.jpg) */}
          <section
            aria-label="Organizer note"
            className="bg-[#F6F1E5] border border-[#C6D8CE] p-5 flex items-start gap-3.5"
          >
            <div
              aria-hidden="true"
              className="w-9 h-9 bg-[#FFBF32] border border-[#152B23] flex items-center justify-center font-mono text-xs font-bold text-[#152B23] shrink-0"
            >
              {getInitials(pool.organizerName).replace(/\./g, '')}
            </div>
            <div className="space-y-1">
              <p className="font-mono text-xs text-[#516B61]">
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
            className="bg-white border border-[#C6D8CE] p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#C6D8CE]">
              <h2 className="font-heading text-lg font-bold text-[#152B23] flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#516B61]" aria-hidden="true" />
                <span>Pool discussion ({pool.discussion.length})</span>
              </h2>
              <span className="font-mono text-[11px] text-[#516B61]">
                Contact details stay private
              </span>
            </div>

            {pool.discussion.length === 0 ? (
              <p className="text-sm text-[#516B61] py-2">
                No messages yet. Ask a question about specs, timing, or delivery before joining.
              </p>
            ) : (
              <ol className="space-y-3">
                {pool.discussion.map((msg) => (
                  <li
                    key={msg.id}
                    className={`p-3.5 border ${
                      msg.isOrganizerUpdate
                        ? 'bg-[#EAF7EF]/70 border-[#152B23]/30'
                        : 'bg-[#F6F1E5]/40 border-[#C6D8CE]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#516B61]">
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
                className="block font-mono text-[11px] uppercase tracking-wider text-[#516B61]"
              >
                Post to discussion as {session?.actor.name}
              </label>
              <textarea
                id="discussion-input"
                rows={2}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Ask about options, pickup timing, or offer terms…"
                className="w-full p-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm text-[#152B23]"
              />
              {commentError && <p className="text-xs text-[#A63A2B]">{commentError}</p>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 bg-[#152B23] hover:bg-[#28463B] text-white font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
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
          className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t-2 border-[#152B23] px-3 py-2 flex items-center justify-between gap-2.5 shadow-[0_-2px_10px_rgba(21,43,35,0.12)]"
        >
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold text-[#152B23] tabular-nums truncate">
              {stage === 'offer_open' || stage === 'unlocked' || stage === 'expired'
                ? `${metrics.confirmedUnits} of ${metrics.targetMin} ${pool.unitPlural}`
                : `${metrics.eligibleInterestedUnits} of ${metrics.targetMin} ${pool.unitPlural}`}
            </p>
            <p className="font-mono text-[10px] text-[#516B61] truncate">
              {getStageLabel(stage)}
            </p>
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
