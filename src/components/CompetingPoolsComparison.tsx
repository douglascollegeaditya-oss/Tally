import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Check,
  Info,
  MapPin,
  PlusCircle,
  RefreshCw,
  Tag,
} from 'lucide-react';
import { evaluateMemberEligibility } from '../domain/tallyEngine.ts';
import type { SimilarPoolCandidate, SimilarPoolMatchLevel } from '../domain/types.ts';
import { ApiRequestError, type ClientPool, useTally } from '../lib/api.ts';
import {
  formatCalendarDate,
  formatCurrency,
  formatDateTimePacific,
  formatShortDate,
  formatUnit,
  getStageLabel,
  getStageToneClasses,
} from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import { SegmentedTally } from './SegmentedTally.tsx';

export interface ComparisonQuerySummary {
  title: string;
  category?: string;
  location?: string;
  goalDate?: string;
  specsText?: string;
}

interface CompetingPoolsComparisonProps {
  candidates: SimilarPoolCandidate[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRefreshCandidates?: () => void;
  referencePool?: ClientPool | null;
  querySummary?: ComparisonQuerySummary | null;
  emptyTitle?: string;
  emptyDescription?: string;
  onJoinSuccess?: (poolId: string, poolTitle: string) => void;
}

function getMatchBadgeClasses(level: SimilarPoolMatchLevel, unavailable: boolean): string {
  if (unavailable) {
    return 'bg-[#F6F1E5] text-[#516B61] border-[#C6D8CE]';
  }
  switch (level) {
    case 'strong_match':
      return 'bg-[#152B23] text-[#FFBF32] border-[#152B23]';
    case 'same_item_different_terms':
      return 'bg-[#F6F1E5] text-[#152B23] border-[#152B23]';
    case 'possible_match':
      return 'bg-[#FDF0EE] text-[#A63A2B] border-[#E8C2BC]';
  }
}

function getPoolMeter(pool: ClientPool) {
  const m = pool.metrics;
  const st = m.effectiveStage;
  if (st === 'offer_open') {
    return {
      current: m.confirmedUnits,
      target: m.targetMin,
      verb: 'confirmed',
      rightLabel:
        m.remainingToMinimum === 0 ? 'Minimum met' : `${m.remainingToMinimum} more to unlock`,
      secondaryNote: `${formatUnit(m.eligibleInterestedUnits, pool.unitSingular, pool.unitPlural)} interested · ${formatUnit(m.confirmedUnits, pool.unitSingular, pool.unitPlural)} confirmed`,
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
      secondaryNote: null,
    };
  }
  if (st === 'expired') {
    return {
      current: m.confirmedUnits,
      target: m.targetMin,
      verb: 'confirmed',
      rightLabel: 'Closed short',
      secondaryNote: null,
    };
  }
  if (st === 'closed') {
    return {
      current: m.fulfilledUnits || m.confirmedUnits,
      target: m.targetMin,
      verb: 'fulfilled',
      rightLabel: 'Completed',
      secondaryNote: null,
    };
  }
  return {
    current: m.eligibleInterestedUnits,
    target: m.targetMin,
    verb: 'interested',
    rightLabel:
      m.remainingToMinimum === 0 ? 'Ready for quote' : `${m.remainingToMinimum} more needed`,
    secondaryNote:
      m.excludedUnits > 0
        ? `${formatUnit(m.excludedUnits, pool.unitSingular, pool.unitPlural)} excluded (incompatible options)`
        : null,
  };
}

function getCandidateDestination(pool: ClientPool, actorId: string, role: string): string {
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

function getCandidateOpenLabel(pool: ClientPool, actorId: string, role: string): string {
  const st = pool.metrics.effectiveStage;
  if (st === 'offer_open') return 'Review quote & confirm';
  if (st === 'expired') return 'View expired offer';
  if (st === 'closed') return 'View completed outcome';
  if (st === 'unlocked') {
    const member = pool.members.find((m) => m.userId === actorId);
    if (role === 'buyer' && member && (member.status === 'confirmed' || member.status === 'fulfilled')) {
      return 'Open claim pass';
    }
    return 'View unlocked deal';
  }
  return 'Open pool';
}

function CandidateCard({
  candidate,
  onRefreshCandidates,
  onJoinSuccess,
}: {
  candidate: SimilarPoolCandidate;
  onRefreshCandidates?: () => void;
  onJoinSuccess?: (poolId: string, poolTitle: string) => void;
}) {
  const { session, role, busy, joinPoolAction } = useTally();
  const actorId = session?.actor.id ?? 'buyer-maya';
  const { pool, quoteSummary } = candidate;
  const stage = pool.metrics.effectiveStage;
  const meter = getPoolMeter(pool);
  const unavailable = candidate.availability === 'unlocked' || candidate.availability === 'ended';

  const [joinOpen, setJoinOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const g of pool.optionGroups) {
      defaults[g.id] = g.allowedValues[0] || g.allValues[0] || '';
    }
    return defaults;
  });
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinedInline, setJoinedInline] = useState(false);

  const draftEligibility = useMemo(
    () =>
      evaluateMemberEligibility(pool, {
        id: 'preview',
        userId: actorId,
        displayName: 'You',
        location: pool.location,
        quantity,
        selectedOptions,
        joinedAt: '',
        status: 'interested',
      }),
    [pool, actorId, quantity, selectedOptions]
  );

  const structuredHighlights = useMemo(() => {
    const items: string[] = [];
    for (const g of pool.optionGroups) {
      if (g.allowedValues.length > 0) {
        items.push(`${g.label}: ${g.allowedValues.join(', ')}`);
      }
    }
    if (items.length === 0) {
      for (const spec of pool.categorySpecs.slice(0, 3)) {
        if (spec.value.trim()) {
          items.push(`${spec.label}: ${spec.value}`);
        }
      }
    }
    return items.slice(0, 3);
  }, [pool.optionGroups, pool.categorySpecs]);

  const handleQuickJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    try {
      // Server validates live stage & availability before committing
      await joinPoolAction(pool.id, {
        quantity,
        selectedOptions,
      });
      setJoinOpen(false);
      setJoinedInline(true);
      onJoinSuccess?.(pool.id, pool.title);
      onRefreshCandidates?.();
    } catch (err) {
      const msg =
        err instanceof ApiRequestError
          ? err.error.message
          : 'Could not join this pool right now.';
      setJoinError(msg);
      // Recheck candidates if pool state changed (e.g. closed or offer opened)
      onRefreshCandidates?.();
    }
  };

  const dest = getCandidateDestination(pool, actorId, role);
  const openLabel = getCandidateOpenLabel(pool, actorId, role);

  return (
    <article
      aria-label={`Candidate pool: ${pool.title}`}
      className={`bg-white border p-4 sm:p-5 space-y-4 ${
        unavailable
          ? 'border-[#C6D8CE] bg-[#F6F1E5]/35'
          : candidate.matchLevel === 'strong_match'
            ? 'border-2 border-[#152B23] shadow-[3px_3px_0px_#152B23]'
            : 'border-[#152B23]/60'
      }`}
    >
      {/* Header Row: Match Level + Stage */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider ${getMatchBadgeClasses(
              candidate.matchLevel,
              unavailable
            )}`}
          >
            {candidate.matchLabel}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
            {pool.category}
          </span>
        </div>
        <span
          className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider ${getStageToneClasses(
            stage
          )}`}
        >
          {getStageLabel(stage)}
        </span>
      </div>

      {/* Item, Location, Timing, Structured Variant/Options */}
      <div className="space-y-2">
        <h3 className="font-heading text-base sm:text-lg font-bold leading-snug text-[#152B23]">
          {pool.title}
        </h3>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#516B61] font-mono">
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{pool.location}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {stage === 'closed'
                ? 'Completed cohort'
                : pool.currentOffer
                  ? `Closes ${formatShortDate(pool.currentOffer.closeAt)} · Claim by ${formatCalendarDate(pool.currentOffer.claimByDate)}`
                  : `Target ${formatCalendarDate(pool.goalDate)}`}
            </span>
          </span>
        </div>

        {structuredHighlights.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {structuredHighlights.map((item) => (
              <span
                key={item}
                className="px-2 py-0.5 bg-[#EAF7EF]/70 border border-[#C6D8CE] font-mono text-[10px] text-[#152B23]"
              >
                {item}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Shared Momentum / Participant Progress */}
      <div className="space-y-1.5 pt-2 border-t border-[#C6D8CE]/70">
        <SegmentedTally
          current={meter.current}
          target={meter.target}
          unitSingular={pool.unitSingular}
          unitPlural={pool.unitPlural}
          verb={meter.verb}
          rightLabel={meter.rightLabel}
          compact
        />
        {meter.secondaryNote && (
          <p className="font-mono text-[11px] text-[#516B61]">{meter.secondaryNote}</p>
        )}
      </div>

      {/* Published Seller Quote vs Honest No-Quote State */}
      {quoteSummary.hasQuote && quoteSummary.subtotal !== undefined ? (
        <div className="p-3 bg-[#F6F1E5] border border-[#152B23]/30 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
              <Tag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {quoteSummary.sellerName} · Offer v{quoteSummary.version}
              </span>
            </span>
            <span className="font-mono text-sm font-bold text-[#152B23] tabular-nums">
              {formatCurrency(quoteSummary.subtotal)} subtotal
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#152B23]">
            <p className="font-mono text-[11px] tabular-nums">
              Unit: <strong>{formatCurrency(quoteSummary.unitPrice ?? 0)}</strong>
              {quoteSummary.knownFees && quoteSummary.knownFees > 0
                ? ` + ${formatCurrency(quoteSummary.knownFees)} ${quoteSummary.feeLabel || 'fees'}`
                : ' · $0 dealer fees'}
            </p>
            <p className="font-mono text-[11px] text-[#516B61] tabular-nums">
              Group range: {quoteSummary.minQuantity}–{quoteSummary.maxQuantity} {pool.unitPlural}
            </p>
          </div>
          {quoteSummary.matchingScope && (
            <p className="text-xs text-[#152B23]">
              <strong className="font-mono text-[10px] uppercase text-[#516B61]">Terms: </strong>
              {quoteSummary.matchingScope}
              {quoteSummary.fulfillmentMethod ? ` · ${quoteSummary.fulfillmentMethod}` : ''}
            </p>
          )}
          {quoteSummary.taxAndRegistrationNote && (
            <p className="text-[11px] text-[#516B61]">{quoteSummary.taxAndRegistrationNote}</p>
          )}
          {quoteSummary.closeAt && stage === 'offer_open' && (
            <p className="font-mono text-[10px] uppercase text-[#152B23]">
              Confirm by {formatDateTimePacific(quoteSummary.closeAt, quoteSummary.timezoneLabel)}
            </p>
          )}
        </div>
      ) : (
        <div className="p-3 bg-[#EAF7EF]/45 border border-[#C6D8CE] flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
            No quote published yet
          </span>
          <span className="text-xs text-[#516B61]">
            {stage === 'gathering' &&
              'Price is quoted by a seller once minimum buyer interest is reached.'}
            {stage === 'ready_for_quote' && 'Minimum met — ready for organizer to request a quote.'}
            {stage === 'quote_requested' && 'Quote requested — waiting for seller pricing.'}
            {(stage === 'closed' || stage === 'expired' || stage === 'unlocked') &&
              (pool.outcomeSummary || 'No active quote available.')}
          </span>
        </div>
      )}

      {/* Explainability: Why It Matched & Key Differences */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
        <div className="p-2.5 bg-[#EAF7EF]/50 border border-[#C6D8CE] space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#152B23]">
            Why this matched
          </p>
          <ul className="space-y-1 text-[#152B23]">
            {candidate.matchReasons.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <Check className="w-3.5 h-3.5 text-[#152B23] shrink-0 mt-0.5" aria-hidden="true" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        {candidate.differences.length > 0 ? (
          <div className="p-2.5 bg-[#FDF0EE]/70 border border-[#E8C2BC] space-y-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#A63A2B]">
              Differences to check
            </p>
            <ul className="space-y-1 text-[#152B23]">
              {candidate.differences.map((diff, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <AlertTriangle
                    className="w-3.5 h-3.5 text-[#A63A2B] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>{diff}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="p-2.5 bg-[#F6F1E5]/60 border border-[#C6D8CE] space-y-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61]">
              Fit check
            </p>
            <p className="text-[#152B23]">
              Location, specs, and timing align closely with your purchase criteria.
            </p>
          </div>
        )}
      </div>

      {/* Inline Quick Join Form (only when pool is actively accepting buyers) */}
      {joinOpen && candidate.canQuickJoin && role !== 'seller' && (
        <form
          onSubmit={handleQuickJoinSubmit}
          className="p-3.5 bg-[#F6F1E5] border border-[#152B23] space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
              Join {pool.title}
            </p>
            <button
              type="button"
              onClick={() => setJoinOpen(false)}
              className="font-mono text-[11px] text-[#516B61] underline hover:text-[#152B23] cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {pool.optionGroups.map((group) => (
              <div key={group.id} className="space-y-1">
                <label
                  htmlFor={`compare-opt-${pool.id}-${group.id}`}
                  className="block font-mono text-[10px] uppercase text-[#152B23]"
                >
                  {group.label} {group.required ? '(Required)' : '(Preference)'}
                </label>
                <select
                  id={`compare-opt-${pool.id}-${group.id}`}
                  value={selectedOptions[group.id] || ''}
                  onChange={(e) =>
                    setSelectedOptions((prev) => ({
                      ...prev,
                      [group.id]: e.target.value,
                    }))
                  }
                  className="w-full h-9 px-2 bg-white border border-[#152B23]/40 text-xs text-[#152B23]"
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
                htmlFor={`compare-qty-${pool.id}`}
                className="block font-mono text-[10px] uppercase text-[#152B23]"
              >
                Quantity ({pool.unitPlural})
              </label>
              <input
                id={`compare-qty-${pool.id}`}
                type="number"
                min={1}
                max={10}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-24 h-9 px-2.5 bg-white border border-[#152B23]/40 font-mono text-xs text-[#152B23]"
              />
            </div>
          </div>

          {!draftEligibility.eligible ? (
            <p className="p-2 bg-[#FDF0EE] border border-[#E8C2BC] text-[11px] text-[#A63A2B]">
              {draftEligibility.reasons.join(' ')} Select an eligible option or create a separate
              pool instead.
            </p>
          ) : (
            <p className="text-[11px] text-[#152B23]">
              Non-binding interest — you only confirm after seeing a published seller quote.
            </p>
          )}

          {joinError && (
            <p role="alert" className="p-2 bg-[#FDF0EE] border border-[#A63A2B] text-xs text-[#A63A2B]">
              {joinError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
            >
              {busy
                ? 'Saving interest…'
                : `Confirm interest (${formatUnit(quantity, pool.unitSingular, pool.unitPlural)})`}
            </button>
          </div>
        </form>
      )}

      {/* Safe Next Steps Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#C6D8CE]/70">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={dest}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 border font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              unavailable
                ? 'bg-white text-[#152B23] border-[#C6D8CE] hover:border-[#152B23]'
                : stage === 'offer_open' || !candidate.canQuickJoin
                  ? 'bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border-[#152B23]'
                  : 'bg-white hover:bg-[#152B23] text-[#152B23] hover:text-white border-[#152B23]'
            }`}
          >
            <span>{openLabel}</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>

          {candidate.canQuickJoin && role !== 'seller' && !joinOpen && !joinedInline && (
            <button
              type="button"
              onClick={() => {
                setJoinError(null);
                setJoinOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Join this pool</span>
            </button>
          )}
        </div>

        <div className="font-mono text-[11px] text-[#516B61]">
          {joinedInline || candidate.alreadyMember ? (
            <span className="inline-flex items-center gap-1 text-[#152B23] font-semibold">
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>In this pool</span>
            </span>
          ) : candidate.alreadyOrganizer ? (
            <span>You organize this pool</span>
          ) : candidate.availability === 'offer_review_only' ? (
            <span>Review published quote before confirming</span>
          ) : candidate.availability === 'unlocked' ? (
            <span>Unlocked — not accepting new interest</span>
          ) : candidate.availability === 'ended' ? (
            <span>Unavailable / ended</span>
          ) : role === 'seller' ? (
            <span>Switch to Buyer persona to join</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function CompetingPoolsComparison({
  candidates,
  loading = false,
  error = null,
  onRetry,
  onRefreshCandidates,
  referencePool,
  querySummary,
  emptyTitle = 'No matching buying pools found',
  emptyDescription = 'No existing pools in this session match this item and specification.',
  onJoinSuccess,
}: CompetingPoolsComparisonProps) {
  const openCount = candidates.filter(
    (c) => c.availability === 'joinable' || c.availability === 'offer_review_only'
  ).length;
  const unavailableCount = candidates.length - openCount;

  return (
    <div className="space-y-4">
      {/* Reference Pool Summary Strip (when comparing from Explore or Pool Detail) */}
      {referencePool && (
        <div className="p-4 bg-[#F6F1E5] border border-[#152B23]/40 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61]">
              Comparing against
            </span>
            <span
              className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider ${getStageToneClasses(
                referencePool.metrics.effectiveStage
              )}`}
            >
              {getStageLabel(referencePool.metrics.effectiveStage)}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <h3 className="font-heading text-base font-bold text-[#152B23]">
              {referencePool.title}
            </h3>
            <span className="font-mono text-xs text-[#152B23] tabular-nums">
              {referencePool.currentOffer
                ? `${formatCurrency(referencePool.currentOffer.subtotal)} subtotal (${referencePool.currentOffer.sellerName})`
                : 'No quote published yet'}
            </span>
          </div>
          <p className="font-mono text-[11px] text-[#516B61]">
            {referencePool.location} ·{' '}
            {referencePool.metrics.effectiveStage === 'offer_open' ||
            referencePool.metrics.effectiveStage === 'unlocked' ||
            referencePool.metrics.effectiveStage === 'expired'
              ? `${referencePool.metrics.confirmedUnits}/${referencePool.metrics.targetMin} ${referencePool.unitPlural} confirmed`
              : `${referencePool.metrics.eligibleInterestedUnits}/${referencePool.metrics.targetMin} ${referencePool.unitPlural} interested`}{' '}
            · Target {formatCalendarDate(referencePool.goalDate)}
          </p>
        </div>
      )}

      {/* Query Criteria Strip (when checking a draft or Explore search) */}
      {querySummary && !referencePool && (
        <div className="p-3.5 bg-[#F6F1E5] border border-[#C6D8CE] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="space-y-0.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
              Checked purchase criteria
            </p>
            <p className="text-[#152B23] font-medium">
              {querySummary.title}
              {querySummary.category ? ` · ${querySummary.category}` : ''}
              {querySummary.location ? ` · ${querySummary.location}` : ''}
              {querySummary.goalDate ? ` · Target ${formatCalendarDate(querySummary.goalDate)}` : ''}
            </p>
            {querySummary.specsText && (
              <p className="font-mono text-[11px] text-[#516B61]">{querySummary.specsText}</p>
            )}
          </div>
          {onRefreshCandidates && (
            <button
              type="button"
              disabled={loading}
              onClick={onRefreshCandidates}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#C6D8CE] hover:border-[#152B23] font-mono text-[11px] uppercase text-[#152B23] cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Recheck</span>
            </button>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div
          role="status"
          aria-live="polite"
          className="p-6 bg-white border border-[#C6D8CE] flex items-center gap-3 text-sm text-[#152B23]"
        >
          <RefreshCw className="w-4 h-4 animate-spin text-[#516B61] shrink-0" aria-hidden="true" />
          <span>Checking live buying pools in this session for same-item matches…</span>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div
          role="alert"
          className="p-4 bg-[#FDF0EE] border border-[#A63A2B] space-y-2.5 text-sm text-[#A63A2B]"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold">Could not check existing pools</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#A63A2B] font-mono text-[11px] font-semibold uppercase text-[#A63A2B] hover:bg-[#A63A2B] hover:text-white cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Try again</span>
            </button>
          )}
        </div>
      )}

      {/* Empty / No Matches State */}
      {!loading && !error && candidates.length === 0 && (
        <div className="p-6 bg-white border border-[#C6D8CE] space-y-2">
          <div className="flex items-center gap-2 text-[#152B23]">
            <Info className="w-4 h-4 text-[#516B61] shrink-0" aria-hidden="true" />
            <p className="font-mono text-xs font-semibold uppercase tracking-wider">{emptyTitle}</p>
          </div>
          <p className="text-sm text-[#516B61]">{emptyDescription}</p>
        </div>
      )}

      {/* Candidate List */}
      {!loading && !error && candidates.length > 0 && (
        <div className="space-y-3">
          <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#516B61]"
          >
            <span>
              {candidates.length} similar {candidates.length === 1 ? 'pool' : 'pools'} found
              {openCount > 0 ? ` (${openCount} open)` : ''}
              {unavailableCount > 0 ? ` · ${unavailableCount} unavailable/ended` : ''}
            </span>
            <span>Ranked by fit, location, timing &amp; live quote</span>
          </div>

          <div className="space-y-3">
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.pool.id}
                candidate={candidate}
                onRefreshCandidates={onRefreshCandidates}
                onJoinSuccess={onJoinSuccess}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
