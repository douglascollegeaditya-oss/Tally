import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  Clock,
  History,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import { evaluateMemberEligibility } from '../domain/tallyEngine.ts';
import { ApiRequestError, useTally } from '../lib/api.ts';
import {
  formatCalendarDate,
  formatCurrency,
  formatDateTimePacific,
  formatDeadlineCompact,
  formatShortDate,
  formatUnit,
  getPoolShortCode,
} from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import { QuoteReceipt } from '../components/QuoteReceipt.tsx';
import { SegmentedTally } from '../components/SegmentedTally.tsx';

export function OfferReviewPage({ poolId }: { poolId: string }) {
  const {
    session,
    role,
    busy,
    confirmOfferAction,
    withdrawConfirmationAction,
    passOfferAction,
    toggleFollowAction,
    refresh,
  } = useTally();

  const [actionError, setActionError] = useState<{ code?: string; message: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const inlineActionRef = useRef<HTMLDivElement | null>(null);
  const [inlineActionVisible, setInlineActionVisible] = useState(true);

  const pool = session?.pools.find((p) => p.id === poolId);
  const actorId = session?.actor.id ?? 'buyer-maya';

  useEffect(() => {
    const el = inlineActionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]) {
          setInlineActionVisible(entries[0].isIntersecting);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [pool?.id, pool?.currentOffer?.version, pool?.metrics.effectiveStage]);

  if (!pool) {
    return (
      <div className="bg-white border border-[#C6D8CE] p-8 max-w-lg mx-auto text-center space-y-3">
        <h1 className="font-display text-2xl text-[#152B23] uppercase">Pool not found</h1>
        <Link
          to="/"
          className="inline-flex items-center px-4 py-2 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase"
        >
          Back to Explore
        </Link>
      </div>
    );
  }

  const offer = pool.currentOffer;
  if (!offer) {
    return (
      <div className="bg-white border border-[#C6D8CE] p-8 max-w-xl mx-auto space-y-4">
        <p className="font-mono text-xs uppercase text-[#516B61]">No seller offer published yet</p>
        <h1 className="font-display text-2xl text-[#152B23] uppercase">{pool.title}</h1>
        <p className="text-sm text-[#516B61]">
          {pool.metrics.effectiveStage === 'quote_requested'
            ? 'The organizer has requested a seller quote. Buyers will review exact terms here once published.'
            : 'This pool is still gathering eligible demand before requesting a seller quote.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to={`/pools/${pool.id}`}
            className="px-4 py-2.5 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase"
          >
            Back to pool page
          </Link>
          {role === 'seller' && pool.sellerToken && (
            <Link
              to={`/s/${pool.sellerToken}`}
              className="px-4 py-2.5 bg-[#152B23] text-white font-mono text-xs font-semibold uppercase"
            >
              Open seller quote form
            </Link>
          )}
        </div>
      </div>
    );
  }

  const metrics = pool.metrics;
  const stage = metrics.effectiveStage;
  const member = pool.members.find((m) => m.userId === actorId);
  const memberEligibility = member ? evaluateMemberEligibility(pool, member) : null;
  const isConfirmedCurrent =
    member !== undefined &&
    (member.status === 'confirmed' || member.status === 'fulfilled') &&
    member.confirmedVersion === offer.version &&
    !member.needsReconfirmation;
  const needsReconfirm = member?.needsReconfirmation === true;
  const isPassed = member?.status === 'passed';
  const isWaitlisted = member?.status === 'waitlisted';
  const isFollowing = pool.followers.includes(actorId);

  const handleConfirm = async () => {
    setActionError(null);
    try {
      await confirmOfferAction(pool.id, offer.version);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setActionError({ code: err.error.code, message: err.error.message });
      } else {
        setActionError({ message: 'Unable to confirm offer right now.' });
      }
    }
  };

  const handleWithdraw = async () => {
    setActionError(null);
    try {
      await withdrawConfirmationAction(pool.id);
    } catch (err) {
      setActionError({
        message: err instanceof ApiRequestError ? err.error.message : 'Unable to withdraw.',
      });
    }
  };

  const handlePass = async () => {
    setActionError(null);
    try {
      await passOfferAction(pool.id);
    } catch (err) {
      setActionError({
        message: err instanceof ApiRequestError ? err.error.message : 'Unable to record pass.',
      });
    }
  };

  const eligibleMembers = pool.members.filter((m) => evaluateMemberEligibility(pool, m).eligible);
  const excludedMembers = pool.members.filter((m) => !evaluateMemberEligibility(pool, m).eligible);

  // Explicit status headline for exact user requirements
  const statusCallout = (() => {
    if (stage === 'unlocked') {
      return {
        tone: 'unlocked' as const,
        headline: 'Your group price is unlocked',
        detail: `${metrics.confirmedUnits} of ${metrics.targetMin} ${pool.unitPlural} confirmed before the deadline. Confirmed buyers can now view private simulated seller claim instructions.`,
      };
    }
    if (stage === 'expired') {
      const shortBy = Math.max(1, metrics.targetMin - metrics.confirmedUnits);
      return {
        tone: 'expired' as const,
        headline:
          shortBy === 1
            ? 'Offer expired one buyer short'
            : `Offer expired ${shortBy} ${pool.unitPlural} short`,
        detail: `Closed at ${formatDateTimePacific(offer.closeAt, offer.timezoneLabel)} with ${
          metrics.confirmedUnits
        } of ${metrics.targetMin} ${pool.unitPlural} confirmed. No active claim or voucher was issued.`,
      };
    }
    if (metrics.remainingToMinimum === 1 && isConfirmedCurrent) {
      return {
        tone: 'pending-one' as const,
        headline: 'One more buyer to unlock the price.',
        detail:
          'Your confirmation is recorded for this version. No voucher, locked allocation, or payment link is issued until the final buyer confirms.',
      };
    }
    if (isWaitlisted || (metrics.isCapReached && !isConfirmedCurrent)) {
      return {
        tone: 'waitlist' as const,
        headline: 'Offer cap reached — waitlist open',
        detail: `All ${offer.maxQuantity} ${pool.unitPlural} in this offer cap are currently spoken for.`,
      };
    }
    return null;
  })();

  return (
    <div className="space-y-3 sm:space-y-5">
      {/* Stitch Offer Breadcrumb & Step Bar (matching tally-offer.jpg) */}
      <div className="space-y-1.5 sm:space-y-2 pb-2 sm:pb-3 border-b border-[#C6D8CE]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 sm:gap-2 font-mono text-xs text-[#516B61] min-w-0">
            <Link
              to={`/pools/${pool.id}`}
              className="inline-flex items-center gap-1 text-[#152B23] underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Back to pool</span>
            </Link>
            <span aria-hidden="true" className="shrink-0">/</span>
            <span className="shrink-0">{pool.category}</span>
            <span aria-hidden="true" className="shrink-0">/</span>
            <span className="text-[#152B23] font-medium truncate">{pool.title}</span>
          </nav>

          <span className="px-2.5 py-0.5 bg-[#DFF2E6] border border-[#C6D8CE] font-mono text-[11px] text-[#516B61]">
            Pool #{getPoolShortCode(pool)} · {pool.location}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="text-[#516B61]">1. Gathering buyers (Completed)</span>
          <span className="text-[#516B61]" aria-hidden="true">→</span>
          <span className="text-[#516B61]">2. Requesting quotes (Completed)</span>
          <span className="text-[#516B61]" aria-hidden="true">→</span>
          <span className="px-2 py-0.5 bg-[#FFBF32] border border-[#152B23] text-[#152B23] font-semibold">
            3.{' '}
            {stage === 'unlocked'
              ? 'Group price unlocked'
              : stage === 'expired'
                ? 'Offer expired'
                : `Offer open (v${offer.version})`}
          </span>
        </div>
      </div>

      {/* Main Title + Close Time Header (matching tally-offer.jpg) */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-[22px] leading-tight sm:text-4xl tracking-tight text-[#152B23] uppercase">
            {pool.title}
          </h1>
          <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-[#516B61]">
            Conditional group offer v{offer.version} from {offer.sellerName} for {pool.location}{' '}
            buyers.
          </p>
        </div>
        <div className="font-mono text-xs font-semibold uppercase tracking-wider text-[#A63A2B] flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>
            {stage === 'expired'
              ? `Closed ${formatDeadlineCompact(offer.closeAt)}`
              : `Offer closes ${formatDeadlineCompact(offer.closeAt)}`}
          </span>
        </div>
      </div>

      {/* Revision Alert Banner if Version > 1 */}
      {offer.version > 1 && (
        <div
          role="status"
          className="bg-[#F6F1E5] border-2 border-[#152B23] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="space-y-1">
            <p className="font-mono text-xs font-semibold uppercase text-[#152B23]">
              Seller revised terms — Offer Version {offer.version}
            </p>
            <p className="text-sm text-[#152B23]">{offer.revisionSummary}</p>
            {needsReconfirm && (
              <p className="text-xs font-semibold text-[#A63A2B]">
                Your earlier confirmation was cleared. Review Version {offer.version} and confirm
                again to be counted.
              </p>
            )}
          </div>
          {pool.offerHistory.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#152B23] font-mono text-xs uppercase cursor-pointer shrink-0"
            >
              <History className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{showHistory ? 'Hide previous versions' : `Compare v1–v${offer.version}`}</span>
            </button>
          )}
        </div>
      )}

      {/* Primary Status Callout (Unlocked / One more buyer / Expired one buyer short) */}
      {statusCallout && (
        <div
          role="status"
          className={`p-4 sm:p-5 border-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            statusCallout.tone === 'unlocked'
              ? 'bg-[#152B23] border-[#152B23] text-white'
              : statusCallout.tone === 'expired'
                ? 'bg-[#FDF0EE] border-[#A63A2B] text-[#152B23]'
                : 'bg-[#F6F1E5] border-[#152B23] text-[#152B23]'
          }`}
        >
          <div className="space-y-1">
            <h2
              className={`font-display text-xl sm:text-2xl uppercase ${
                statusCallout.tone === 'unlocked'
                  ? 'text-[#FFBF32]'
                  : statusCallout.tone === 'expired'
                    ? 'text-[#A63A2B]'
                    : 'text-[#152B23]'
              }`}
            >
              {statusCallout.headline}
            </h2>
            <p
              className={`text-sm ${
                statusCallout.tone === 'unlocked' ? 'text-white/90' : 'text-[#516B61]'
              }`}
            >
              {statusCallout.detail}
            </p>
          </div>

          {statusCallout.tone === 'unlocked' && role === 'buyer' && isConfirmedCurrent && (
            <Link
              to={`/pools/${pool.id}/claim`}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#FFBF32] font-mono text-xs font-semibold uppercase tracking-wider whitespace-nowrap shrink-0"
            >
              <span>Open private claim pass</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          )}

          {statusCallout.tone === 'expired' && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggleFollowAction(pool.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 border font-mono text-xs font-semibold uppercase cursor-pointer ${
                  isFollowing
                    ? 'bg-[#152B23] text-[#FFBF32] border-[#152B23]'
                    : 'bg-white text-[#152B23] border-[#152B23] hover:bg-[#F6F1E5]'
                }`}
              >
                {isFollowing ? (
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{isFollowing ? 'Following next pool' : 'Follow for next pool'}</span>
              </button>
              <Link
                to={`/?cat=${encodeURIComponent(pool.category)}`}
                className="px-3.5 py-2.5 bg-white border border-[#C6D8CE] hover:border-[#152B23] font-mono text-xs uppercase text-[#152B23]"
              >
                Browse {pool.category}
              </Link>
              <Link
                to="/start"
                className="px-3.5 py-2.5 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase text-[#152B23]"
              >
                Start new pool
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Asymmetric 2-Column Workspace — Commitment Tracker stays first on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right Column on Desktop, FIRST on Mobile: Commitment Tracker & Roster */}
        <div className="lg:col-span-5 order-1 lg:order-2 space-y-5">
          {/* Commitment Tracker Card (matches tally-offer.jpg right-top) */}
          <section
            aria-label="Commitment tracker"
            className="bg-white border-2 border-[#152B23] shadow-[3px_3px_0px_#152B23] p-4 sm:p-5 space-y-3 sm:space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#C6D8CE]">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#516B61]">
                Commitment tracker
              </span>
              <span className="font-mono text-[11px] font-semibold uppercase text-[#A63A2B]">
                {stage === 'expired'
                  ? 'Deadline passed'
                  : `Closes ${formatDeadlineCompact(offer.closeAt)}`}
              </span>
            </div>

            <SegmentedTally
              current={metrics.confirmedUnits}
              target={metrics.targetMin}
              unitSingular={pool.unitSingular}
              unitPlural={pool.unitPlural}
              verb="confirmed"
              variant="checks"
              rightLabel={
                stage === 'unlocked'
                  ? `${metrics.fulfilledUnits} fulfilled`
                  : stage === 'expired'
                    ? `${metrics.remainingToMinimum} short`
                    : `${metrics.remainingToMinimum} awaiting`
              }
            />

            {/* Buyer's personal fit + total right next to the primary decision control */}
            {role !== 'seller' && (
              <div className="p-2.5 sm:p-3 bg-[#F6F1E5] border border-[#C6D8CE] space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono uppercase text-[10px] text-[#516B61]">
                    Your eligible quantity
                  </span>
                  <span className="font-mono font-semibold text-[#152B23] tabular-nums">
                    {member && memberEligibility?.eligible
                      ? `${formatUnit(member.quantity, pool.unitSingular, pool.unitPlural)} · ${formatCurrency(
                          offer.subtotal * member.quantity
                        )}`
                      : 'Not eligible'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-[#516B61]">
                  <span>Cutoff: {formatDateTimePacific(offer.closeAt, offer.timezoneLabel)}</span>
                  <span>Pickup by {formatCalendarDate(offer.claimByDate)}</span>
                </div>
              </div>
            )}

            {/* Error / Stale Version Recovery */}
            {actionError && (
              <div
                role="alert"
                className="p-3 bg-[#FDF0EE] border border-[#A63A2B] text-xs text-[#A63A2B] space-y-2"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{actionError.message}</span>
                </div>
                {actionError.code === 'STALE_OFFER_VERSION' && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      void refresh();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#A63A2B] font-mono text-[11px] uppercase cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" aria-hidden="true" />
                    Load latest offer version
                  </button>
                )}
              </div>
            )}

            {/* Decision Controls (observed for compact mobile sticky bar handoff) */}
            <div ref={inlineActionRef}>
            {role === 'seller' ? (
              <div className="space-y-2">
                <p className="text-xs text-[#516B61]">
                  Viewing as Seller persona. Edit or publish a revised version from your private
                  seller quote workspace.
                </p>
                {pool.sellerToken && stage !== 'unlocked' && (
                  <Link
                    to={`/s/${pool.sellerToken}`}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#152B23] text-white font-mono text-xs font-semibold uppercase tracking-wider"
                  >
                    <span>Revise offer in Seller workspace</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                )}
              </div>
            ) : stage === 'unlocked' ? (
              <div className="space-y-2.5">
                {role === 'buyer' && isConfirmedCurrent ? (
                  <Link
                    to={`/pools/${pool.id}/claim`}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider"
                  >
                    <span>
                      {member?.status === 'fulfilled'
                        ? 'View fulfilled pass'
                        : 'Open claim instructions & mark fulfilled'}
                    </span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                ) : (
                  <p className="text-xs text-[#516B61]">
                    Group price unlocked for confirmed buyers. Claim instructions are private to
                    confirmed buyer accounts.
                  </p>
                )}
              </div>
            ) : stage === 'expired' ? (
              <p className="text-xs text-[#A63A2B] font-medium">
                Confirmations closed at {formatDateTimePacific(offer.closeAt, offer.timezoneLabel)}.
                No voucher or allocation is active.
              </p>
            ) : !member ? (
              <div className="space-y-2">
                <p className="text-xs text-[#516B61]">
                  Join the pool with compatible options before confirming this offer.
                </p>
                <Link
                  to={`/pools/${pool.id}`}
                  className="w-full inline-flex items-center justify-center px-4 py-3 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase"
                >
                  Join pool first
                </Link>
              </div>
            ) : !memberEligibility?.eligible ? (
              <div className="p-3 bg-[#FDF0EE] border border-[#E8C2BC] text-xs text-[#A63A2B] space-y-1.5">
                <p className="font-semibold">Your preferences are excluded from this offer</p>
                <p>{memberEligibility?.reasons.join(' ')}</p>
                <Link
                  to={`/pools/${pool.id}`}
                  className="inline-block font-mono uppercase underline text-[#152B23]"
                >
                  Edit your options on pool page
                </Link>
              </div>
            ) : isConfirmedCurrent ? (
              <div className="space-y-2.5">
                <div className="p-3 bg-[#EAF7EF] border border-[#152B23] text-xs text-[#152B23] space-y-1">
                  <p className="font-mono font-semibold uppercase flex items-center gap-1.5">
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>Confirmed on Offer v{offer.version}</span>
                  </p>
                  <p className="text-[#516B61]">
                    Waiting for {metrics.remainingToMinimum} more{' '}
                    {metrics.remainingToMinimum === 1 ? pool.unitSingular : pool.unitPlural} to
                    unlock. No voucher or claim code exists until minimum is met.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleWithdraw()}
                  className="w-full py-2.5 border border-[#152B23]/40 bg-white hover:bg-[#F6F1E5] font-mono text-xs uppercase tracking-wider text-[#152B23] cursor-pointer disabled:opacity-60"
                >
                  Withdraw confirmation (allowed before unlock)
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleConfirm()}
                  className="w-full py-3.5 px-4 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-60"
                >
                  {busy
                    ? 'Recording…'
                    : metrics.isCapReached
                      ? 'Join offer waitlist'
                      : needsReconfirm
                        ? `Reconfirm Offer v${offer.version}`
                        : `Confirm Offer v${offer.version}`}
                </button>

                {!isPassed && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handlePass()}
                    className="w-full py-2 border border-[#C6D8CE] hover:border-[#152B23] bg-white text-[#516B61] hover:text-[#152B23] font-mono text-xs uppercase tracking-wider cursor-pointer disabled:opacity-60"
                  >
                    Pass on this offer
                  </button>
                )}

                {isPassed && (
                  <p className="text-xs text-center text-[#516B61]">
                    You passed on this offer. You can still confirm above before the close deadline.
                  </p>
                )}

                <p className="text-xs text-[#516B61] leading-relaxed">
                  The group price applies only when{' '}
                  {formatUnit(offer.minQuantity, pool.unitSingular, pool.unitPlural)} confirm before{' '}
                  {formatDeadlineCompact(offer.closeAt)}. Buyers pay the seller directly after
                  unlocking.
                </p>
              </div>
            )}
            </div>
          </section>

          {/* Buyer Roster Card (matches tally-offer.jpg right-bottom) */}
          <section
            aria-label="Buyer confirmation roster"
            className="bg-white border border-[#C6D8CE] p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#C6D8CE]">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
                Buyer roster
              </h2>
              <span className="font-mono text-[11px] text-[#516B61] tabular-nums">
                {metrics.confirmedUnits} confirmed · {metrics.remainingToMinimum} needed
              </span>
            </div>

            <ol className="divide-y divide-[#C6D8CE]/60 font-mono text-xs">
              {eligibleMembers.map((m, idx) => {
                const isYou = m.userId === actorId;
                const confirmedCur =
                  (m.status === 'confirmed' || m.status === 'fulfilled') &&
                  m.confirmedVersion === offer.version &&
                  !m.needsReconfirmation;
                return (
                  <li
                    key={m.id}
                    className={`py-2 px-2 flex items-center justify-between gap-2 ${
                      isYou ? 'bg-[#EAF7EF] font-semibold' : ''
                    }`}
                  >
                    <span className="truncate text-[#152B23]">
                      {idx + 1}. {isYou ? `You (${m.displayName})` : m.displayName}
                      {m.quantity > 1 ? ` ×${m.quantity}` : ''}
                    </span>
                    <span
                      className={`shrink-0 ${
                        m.status === 'fulfilled'
                          ? 'text-[#152B23] font-semibold'
                          : confirmedCur
                            ? 'text-[#152B23]'
                            : m.needsReconfirmation
                              ? 'text-[#A63A2B]'
                              : m.status === 'passed'
                                ? 'text-[#516B61] line-through'
                                : isYou
                                  ? 'text-[#A63A2B] uppercase text-[11px]'
                                  : 'text-[#516B61]'
                      }`}
                    >
                      {m.status === 'fulfilled'
                        ? '✓ Fulfilled'
                        : confirmedCur
                          ? '✓ Confirmed'
                          : m.needsReconfirmation
                            ? 'Reconfirm v' + offer.version
                            : m.status === 'passed'
                              ? 'Passed'
                              : m.status === 'waitlisted'
                                ? 'Waitlisted'
                                : isYou
                                  ? 'Awaiting decision'
                                  : 'Reviewing'}
                    </span>
                  </li>
                );
              })}
            </ol>

            {excludedMembers.length > 0 && (
              <div className="pt-2 border-t border-[#C6D8CE] text-[11px] text-[#516B61]">
                <span className="font-mono uppercase text-[#A63A2B] font-semibold">Excluded: </span>
                {excludedMembers.map((m) => `${m.displayName} (incompatible specs)`).join(', ')}
              </div>
            )}
          </section>
        </div>

        {/* Left Column on Desktop: Quote Receipt, Version History & Discussion Link */}
        <div className="lg:col-span-7 order-2 lg:order-1 space-y-5">
          <QuoteReceipt
            offer={offer}
            unitSingular={pool.unitSingular}
            unitPlural={pool.unitPlural}
            quantity={member && memberEligibility?.eligible ? member.quantity : 1}
          />

          {/* Offer Version History */}
          {pool.offerHistory.length > 0 && (
            <section
              aria-label="Previous offer versions"
              className="bg-white border border-[#C6D8CE] p-5 space-y-3"
            >
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                aria-expanded={showHistory}
                className="w-full flex items-center justify-between font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23] cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <History className="w-4 h-4 text-[#516B61]" aria-hidden="true" />
                  Offer version history ({pool.offerHistory.length} previous)
                </span>
                <span>{showHistory ? 'Hide' : 'Show'}</span>
              </button>

              {showHistory && (
                <div className="space-y-2.5 pt-2 border-t border-[#C6D8CE]">
                  {pool.offerHistory.map((old) => (
                    <div
                      key={old.version}
                      className="p-3 bg-[#F6F1E5]/70 border border-[#C6D8CE] text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-mono">
                        <strong className="text-[#152B23]">
                          Version {old.version} (Superseded)
                        </strong>
                        <span className="tabular-nums font-semibold text-[#516B61] line-through">
                          {formatCurrency(old.subtotal)} subtotal
                        </span>
                      </div>
                      <p className="text-[#516B61]">
                        Unit {formatCurrency(old.unitPrice)} + {old.feeLabel}{' '}
                        {formatCurrency(old.knownFees)} · Min {old.minQuantity} · Closed{' '}
                        {formatDeadlineCompact(old.closeAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Discussion link strip matching tally-offer.jpg */}
          <div className="bg-white border border-[#C6D8CE] px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
            <Link
              to={`/pools/${pool.id}`}
              className="inline-flex items-center gap-2 font-mono text-xs text-[#152B23] underline underline-offset-4 hover:text-[#28463B]"
            >
              <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{pool.discussion.length} messages in pool discussion →</span>
            </Link>
            <span className="font-mono text-[11px] text-[#516B61]">
              Version {offer.version} published {formatShortDate(offer.publishedAt)}
            </span>
          </div>
        </div>
      </div>
      {/* Compact Sticky Mobile Buyer Bar — mounts ONLY when inline decision control scrolls out of view */}
      {!inlineActionVisible &&
        role !== 'seller' &&
        (stage === 'offer_open' || (stage === 'unlocked' && role === 'buyer' && isConfirmedCurrent)) && (
          <div
            aria-label="Quick offer decision"
            className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t-2 border-[#152B23] px-3 py-2 flex items-center justify-between gap-2.5 shadow-[0_-2px_10px_rgba(21,43,35,0.12)]"
          >
            <div className="min-w-0">
              <p className="font-mono text-xs font-bold text-[#152B23] tabular-nums truncate">
                {metrics.confirmedUnits} of {metrics.targetMin} · {formatCurrency(offer.subtotal)}
              </p>
              <p className="font-mono text-[10px] text-[#516B61] truncate">
                {stage === 'unlocked'
                  ? 'Group price unlocked'
                  : `Closes ${formatDeadlineCompact(offer.closeAt)}`}
              </p>
            </div>

            {stage === 'unlocked' ? (
              <Link
                to={`/pools/${pool.id}/claim`}
                className="px-3.5 py-2 bg-[#FFBF32] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0"
              >
                Claim pass
              </Link>
            ) : !member ? (
              <Link
                to={`/pools/${pool.id}`}
                className="px-3.5 py-2 bg-[#FFBF32] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0"
              >
                Join pool
              </Link>
            ) : isConfirmedCurrent ? (
              <span className="px-2.5 py-1.5 bg-[#EAF7EF] border border-[#152B23] font-mono text-[10px] font-semibold uppercase text-[#152B23] whitespace-nowrap shrink-0">
                ✓ Confirmed v{offer.version}
              </span>
            ) : memberEligibility?.eligible ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirm()}
                className="px-3.5 py-2 bg-[#FFBF32] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                {busy
                  ? 'Saving…'
                  : needsReconfirm
                    ? `Reconfirm v${offer.version}`
                    : `Confirm v${offer.version}`}
              </button>
            ) : null}
          </div>
        )}
    </div>
  );
}
