import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellPlus,
  Calendar,
  Check,
  Info,
  MapPin,
  PlusCircle,
  RefreshCw,
  SlidersHorizontal,
  Tag,
} from 'lucide-react';
import { evaluateMemberEligibility } from '../domain/tallyEngine.ts';
import type {
  SimilarPoolCandidate,
  SimilarPoolMatchLevel,
  SimilarPoolReference,
} from '../domain/types.ts';
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
import { getVehicleTypeLabel, isAccessoryPool } from '../domain/vehicleEngine.ts';
import { Link } from '../lib/router.tsx';
import { PlacementBadges } from './PlacementBadges.tsx';
import { SegmentedTally } from './SegmentedTally.tsx';

export interface ComparisonQuerySummary {
  title: string;
  category?: string;
  location?: string;
  goalDate?: string;
  windowLabel?: string;
  stageLabel?: string;
  specsText?: string;
}

interface CompetingPoolsComparisonProps {
  candidates: SimilarPoolCandidate[];
  referencePools?: SimilarPoolReference[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRefreshCandidates?: () => void;
  referencePool?: ClientPool | null;
  querySummary?: ComparisonQuerySummary | null;
  suggestedQuery?: string | null;
  onApplySuggestion?: (suggestedQuery: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  createAlertHref?: string;
  separatePoolHref?: string;
  onAdjustSearch?: () => void;
  onJoinSuccess?: (poolId: string, poolTitle: string) => void;
}

function getMatchToneText(level: SimilarPoolMatchLevel, unavailable: boolean): string {
  if (unavailable) return 'text-[#4E6359]';
  switch (level) {
    case 'strong_match':
      return 'text-[#1E4334] font-semibold';
    case 'same_item_different_terms':
      return 'text-[#152B23] font-semibold';
    case 'possible_match':
      return 'text-[#A63A2B] font-semibold';
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
    if (
      role === 'buyer' &&
      member &&
      (member.status === 'confirmed' || member.status === 'fulfilled')
    ) {
      return 'Open claim pass';
    }
    return 'View unlocked deal';
  }
  return 'Open pool';
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
  const variantSummary = useMemo(() => extractVariantSummary(pool), [pool]);

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

  const handleQuickJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    try {
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
        err instanceof ApiRequestError ? err.error.message : 'Could not join this pool right now.';
      setJoinError(msg);
      onRefreshCandidates?.();
    }
  };

  const dest = getCandidateDestination(pool, actorId, role);
  const openLabel = getCandidateOpenLabel(pool, actorId, role);
  const showConfirmedMetric =
    stage === 'offer_open' || stage === 'unlocked' || stage === 'expired' || stage === 'closed';

  return (
    <article
      aria-label={`Candidate pool: ${pool.title}`}
      className={`border p-5 sm:p-6 space-y-5 transition-colors ${
        unavailable
          ? 'bg-[#F6F4EC] border-[#CDD6CC]'
          : candidate.matchLevel === 'strong_match'
            ? 'bg-white border-2 border-[#1E4334] shadow-[3px_3px_0px_#152B23]'
            : 'bg-white border-[#8C9A86]'
      }`}
    >
      {/* Top Hierarchy: Quiet Unboxed Match Kicker + Single Crisp Stage Badge */}
      <div className="space-y-2 pb-3 border-b border-[#CDD6CC]/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
            <span className={getMatchToneText(candidate.matchLevel, unavailable)}>
              {candidate.matchLabel}
            </span>
            <span aria-hidden="true" className="text-[#8C9A86]">
              ·
            </span>
            <span className="text-[#4E6359]">
              {pool.category}
              {pool.category === 'Vehicles' && isAccessoryPool(pool)
                ? ' · Accessory'
                : pool.category === 'Vehicles' && pool.vehicleSpecs?.vehicleType
                  ? ` · ${getVehicleTypeLabel(pool.vehicleSpecs.vehicleType, true)}`
                  : ''}
            </span>
          </div>

          <span
            className={`px-2.5 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 ${getStageToneClasses(
              stage
            )}`}
          >
            {getStageLabel(stage)}
          </span>
        </div>
        <PlacementBadges pool={pool} variant="card" />
      </div>

      {/* Item, Meaningful Variant, Location & Purchase Window */}
      <div className="space-y-2">
        <h3 className="font-heading text-lg sm:text-xl font-bold leading-snug text-[#152B23]">
          {pool.title}
        </h3>

        {variantSummary && (
          <p className="text-sm text-[#1E4334] font-medium leading-snug">{variantSummary}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#4E6359] font-mono pt-0.5">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 shrink-0 text-[#8C9A86]" aria-hidden="true" />
            <span>{pool.location}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 shrink-0 text-[#8C9A86]" aria-hidden="true" />
            <span>
              {stage === 'closed'
                ? 'Completed cohort'
                : pool.currentOffer
                  ? `Closes ${formatShortDate(pool.currentOffer.closeAt)} · Claim by ${formatCalendarDate(pool.currentOffer.claimByDate)}`
                  : `Target ${formatCalendarDate(pool.goalDate)}`}
            </span>
          </span>
        </div>
      </div>

      {/* Participant Progress: Explicit Separation of Interested vs Confirmed vs Target */}
      <div className="space-y-3 pt-1">
        <dl className="grid grid-cols-3 gap-2 sm:gap-4 py-2.5 px-3 bg-[#F7F5EE] border border-[#CDD6CC]">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
              Interested
            </dt>
            <dd className="mt-0.5 font-mono text-sm sm:text-base font-semibold text-[#152B23] tabular-nums">
              {pool.metrics.eligibleInterestedUnits}
              <span className="text-[11px] font-normal text-[#4E6359] ml-1">
                {pool.metrics.eligibleInterestedUnits === 1 ? pool.unitSingular : pool.unitPlural}
              </span>
            </dd>
          </div>
          <div className="border-l border-[#CDD6CC] pl-2 sm:pl-4">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
              {stage === 'closed' ? 'Fulfilled' : 'Confirmed'}
            </dt>
            <dd className="mt-0.5 font-mono text-sm sm:text-base font-semibold text-[#152B23] tabular-nums">
              {showConfirmedMetric
                ? stage === 'closed'
                  ? pool.metrics.fulfilledUnits || pool.metrics.confirmedUnits
                  : pool.metrics.confirmedUnits
                : '0'}
              <span className="text-[11px] font-normal text-[#4E6359] ml-1">
                {showConfirmedMetric ? '' : '(after quote)'}
              </span>
            </dd>
          </div>
          <div className="border-l border-[#CDD6CC] pl-2 sm:pl-4">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
              Target min
            </dt>
            <dd className="mt-0.5 font-mono text-sm sm:text-base font-semibold text-[#1E4334] tabular-nums">
              {pool.metrics.targetMin}
              <span className="text-[11px] font-normal text-[#4E6359] ml-1">
                (cap {pool.metrics.targetCap})
              </span>
            </dd>
          </div>
        </dl>

        <SegmentedTally
          current={meter.current}
          target={meter.target}
          unitSingular={pool.unitSingular}
          unitPlural={pool.unitPlural}
          verb={meter.verb}
          rightLabel={meter.rightLabel}
          compact
        />
      </div>

      {/* Published Seller Quote vs Honest No-Quote State */}
      {quoteSummary.hasQuote && quoteSummary.subtotal !== undefined ? (
        <div className="p-4 bg-[#F6F1E5] border border-[#1E4334]/35 space-y-2">
          {quoteSummary.hasSpecConflicts && quoteSummary.specConflicts && quoteSummary.specConflicts.length > 0 && (
            <div
              role="alert"
              className="p-2.5 bg-[#FDF4F2] border border-[#A63A2B] text-xs text-[#A63A2B] space-y-1"
            >
              <p className="font-mono text-[10px] font-semibold uppercase flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Quote conflicts with required pool specifications</span>
              </p>
              <p className="text-[#152B23]">{quoteSummary.specConflicts.join(' ')}</p>
            </div>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#1E4334]">
              <Tag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {quoteSummary.sellerName} · Offer v{quoteSummary.version} (USD)
              </span>
            </span>
            <span className="font-mono text-base font-bold text-[#152B23] tabular-nums">
              {formatCurrency(quoteSummary.subtotal)}
              {quoteSummary.knownFeesUnknown ? ' + TBD fees' : ' subtotal'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#152B23]">
            <p className="font-mono text-[11px] tabular-nums">
              Unit price: <strong>{formatCurrency(quoteSummary.unitPrice ?? 0)}</strong>
              {quoteSummary.knownFeesUnknown
                ? quoteSummary.knownFees && quoteSummary.knownFees > 0
                  ? ` + ${formatCurrency(quoteSummary.knownFees)} fixed fees + TBD items`
                  : ' · Additional fees TBD / unknown'
                : quoteSummary.knownFees && quoteSummary.knownFees > 0
                  ? ` + ${formatCurrency(quoteSummary.knownFees)} ${quoteSummary.feeLabel || 'fees'}`
                  : ' · $0 seller fees'}
            </p>
            <p className="font-mono text-[11px] text-[#4E6359] tabular-nums">
              Applies to {quoteSummary.minQuantity}–{quoteSummary.maxQuantity} {pool.unitPlural}
            </p>
          </div>
          {quoteSummary.matchingScope && (
            <p className="text-xs text-[#152B23] leading-relaxed">
              <strong className="font-mono text-[10px] uppercase text-[#4E6359]">
                Inclusions &amp; terms:{' '}
              </strong>
              {quoteSummary.matchingScope}
              {quoteSummary.fulfillmentMethod ? ` · ${quoteSummary.fulfillmentMethod}` : ''}
            </p>
          )}
          {quoteSummary.taxAndRegistrationNote && (
            <p className="text-[11px] text-[#4E6359]">{quoteSummary.taxAndRegistrationNote}</p>
          )}
          {quoteSummary.closeAt && stage === 'offer_open' && (
            <p className="font-mono text-[11px] text-[#152B23]">
              Confirmation deadline:{' '}
              {formatDateTimePacific(quoteSummary.closeAt, quoteSummary.timezoneLabel)}
            </p>
          )}
        </div>
      ) : (
        <div className="px-4 py-3 bg-[#F7F5EE] border border-[#CDD6CC] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
            No quote published yet
          </span>
          <span className="text-xs text-[#4E6359]">
            {stage === 'gathering' &&
              'Pricing is only known after minimum interest is reached and a seller publishes a quote.'}
            {stage === 'ready_for_quote' &&
              'Minimum interest met — organizer can now request a seller quote.'}
            {stage === 'quote_requested' && 'Quote requested — awaiting seller pricing and terms.'}
            {(stage === 'closed' || stage === 'expired' || stage === 'unlocked') &&
              (pool.outcomeSummary || 'No active quote available.')}
          </span>
        </div>
      )}

      {/* Explainability: Clearly Separate Verified Evidence, Approximate Text Interpretation, Mismatches, and Unspecified Criteria */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="space-y-2.5">
          {candidate.matchReasons.length > 0 && (
            <div className="p-3 bg-[#F7F5EE] border border-[#CDD6CC] space-y-1.5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#1E4334]">
                Verified in your search
              </p>
              <ul className="space-y-1 text-[#152B23]">
                {candidate.matchReasons.map((reason, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 leading-snug">
                    <Check className="w-3.5 h-3.5 text-[#1E4334] shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {candidate.isApproximateMatch &&
            candidate.approximateInterpretations &&
            candidate.approximateInterpretations.length > 0 && (
              <div className="p-3 bg-[#FFFDF5] border border-[#D49B00] space-y-1.5">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#6B4A00]">
                  Approximate match interpretation
                </p>
                <ul className="space-y-1 text-[#152B23]">
                  {candidate.approximateInterpretations.map((note, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 leading-snug">
                      <Info className="w-3.5 h-3.5 text-[#8A5A00] shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
        </div>

        <div className="space-y-2.5">
          {candidate.differences.length > 0 && (
            <div className="p-3 bg-[#FDF4F2] border border-[#E6C4BE] space-y-1.5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#A63A2B]">
                Differences to check
              </p>
              <ul className="space-y-1 text-[#152B23]">
                {candidate.differences.map((diff, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 leading-snug">
                    <AlertTriangle
                      className="w-3.5 h-3.5 text-[#A63A2B] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <span>{diff}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {candidate.unspecifiedChecks && candidate.unspecifiedChecks.length > 0 && (
            <div className="p-3 bg-[#F6F1E5] border border-[#8C9A86] space-y-1.5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4E6359]">
                Not specified in search · verify before joining
              </p>
              <ul className="space-y-1 text-[#152B23]">
                {candidate.unspecifiedChecks.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 leading-snug">
                    <Info
                      className="w-3.5 h-3.5 text-[#4E6359] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!candidate.isApproximateMatch &&
            candidate.differences.length === 0 &&
            (!candidate.unspecifiedChecks || candidate.unspecifiedChecks.length === 0) && (
              <div className="p-3 bg-[#EFF3ED] border border-[#8C9A86] space-y-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#1E4334]">
                  All supplied criteria verified
                </p>
                <p className="text-[#152B23] leading-snug">
                  Category, item specifications, area, and target timing match what you supplied.
                </p>
              </div>
            )}
        </div>
      </div>

      {/* Inline Quick Join Form (only when pool is actively accepting buyers) */}
      {joinOpen && candidate.canQuickJoin && role !== 'seller' && (
        <form
          onSubmit={handleQuickJoinSubmit}
          className="p-4 bg-[#F6F1E5] border border-[#1E4334] space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
              Join {pool.title}
            </p>
            <button
              type="button"
              onClick={() => setJoinOpen(false)}
              className="font-mono text-[11px] text-[#4E6359] underline hover:text-[#152B23] cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  className="w-full h-10 px-2.5 bg-white border border-[#8C9A86] text-xs text-[#152B23]"
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
                onChange={(e) =>
                  setQuantity(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
                }
                className="w-24 h-10 px-2.5 bg-white border border-[#8C9A86] font-mono text-xs text-[#152B23]"
              />
            </div>
          </div>

          {!draftEligibility.eligible ? (
            <p className="p-2.5 bg-[#FDF4F2] border border-[#E6C4BE] text-xs text-[#A63A2B]">
              {draftEligibility.reasons.join(' ')} Choose a compatible option or create a separate
              pool instead.
            </p>
          ) : (
            <p className="text-xs text-[#152B23]">
              Non-binding interest — you only confirm after reviewing a published seller quote.
            </p>
          )}

          {joinError && (
            <p
              role="alert"
              className="p-2.5 bg-[#FDF4F2] border border-[#A63A2B] text-xs text-[#A63A2B]"
            >
              {joinError}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2.5 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            {busy
              ? 'Checking & saving…'
              : `Confirm interest (${formatUnit(quantity, pool.unitSingular, pool.unitPlural)})`}
          </button>
        </form>
      )}

      {/* Safe Next Steps Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#CDD6CC]/80">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={dest}
            className={`inline-flex items-center gap-1.5 px-4 py-2 border font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ${
              unavailable
                ? 'bg-white text-[#152B23] border-[#8C9A86] hover:border-[#152B23]'
                : stage === 'offer_open' || !candidate.canQuickJoin
                  ? 'bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border-[#152B23]'
                  : 'bg-white hover:bg-[#1E4334] text-[#152B23] hover:text-white border-[#152B23]'
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
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Join this pool</span>
            </button>
          )}
        </div>

        <div className="font-mono text-[11px] text-[#4E6359]">
          {joinedInline || candidate.alreadyMember ? (
            <span className="inline-flex items-center gap-1 text-[#1E4334] font-semibold">
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>In this pool</span>
            </span>
          ) : candidate.alreadyOrganizer ? (
            <span>You organize this pool</span>
          ) : candidate.availability === 'offer_review_only' ? (
            <span>Quote open — review terms before confirming</span>
          ) : candidate.availability === 'unlocked' ? (
            <span>Unlocked — join closed</span>
          ) : candidate.availability === 'ended' ? (
            <span>Ended — join unavailable</span>
          ) : role === 'seller' ? (
            <span>Switch to Buyer persona to join</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ReferenceOnlyCard({ reference }: { reference: SimilarPoolReference }) {
  const { pool, quoteSummary } = reference;
  const stage = pool.metrics.effectiveStage;
  const variantSummary = extractVariantSummary(pool);

  return (
    <article
      aria-label={`Reference only pool: ${pool.title}`}
      className="bg-[#F6F4EC] border border-[#8C9A86] p-4 sm:p-5 space-y-3"
    >
      <div className="space-y-2 pb-2 border-b border-[#CDD6CC]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
            <span className="font-semibold text-[#A63A2B]">{reference.reasonLabel}</span>
            <span aria-hidden="true" className="text-[#8C9A86]">
              ·
            </span>
            <span className="text-[#4E6359]">
              {pool.category}
              {pool.category === 'Vehicles' && isAccessoryPool(pool)
                ? ' · Accessory'
                : pool.category === 'Vehicles' && pool.vehicleSpecs?.vehicleType
                  ? ` · ${getVehicleTypeLabel(pool.vehicleSpecs.vehicleType, true)}`
                  : ''}
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
        <PlacementBadges pool={pool} variant="card" />
      </div>

      <div className="space-y-1">
        <h4 className="font-heading text-base font-bold text-[#152B23]">{pool.title}</h4>
        {variantSummary && <p className="text-xs text-[#4E6359]">{variantSummary}</p>}
        <p className="font-mono text-[11px] text-[#4E6359]">
          {pool.location} · Target {formatCalendarDate(pool.goalDate)} ·{' '}
          {quoteSummary.hasQuote && quoteSummary.subtotal !== undefined
            ? `${formatCurrency(quoteSummary.subtotal)}${quoteSummary.knownFeesUnknown ? ' + TBD fees' : ' subtotal'} (${quoteSummary.sellerName})`
            : 'No quote published yet'}
        </p>
      </div>

      <p className="p-2.5 bg-[#FDF4F2] border border-[#E6C4BE] text-xs text-[#152B23] flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-[#A63A2B] shrink-0 mt-0.5" aria-hidden="true" />
        <span>{reference.explanation}</span>
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Link
          to={`/pools/${pool.id}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#1E4334] text-[#152B23] hover:text-white border border-[#8C9A86] hover:border-[#1E4334] font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors"
        >
          <span>Inspect pool</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
        <span className="font-mono text-[11px] text-[#4E6359]">
          Reference only · Join disabled for incompatible specs
        </span>
      </div>
    </article>
  );
}

export function CompetingPoolsComparison({
  candidates,
  referencePools = [],
  loading = false,
  error = null,
  onRetry,
  onRefreshCandidates,
  referencePool,
  querySummary,
  suggestedQuery,
  onApplySuggestion,
  emptyTitle = 'No compatible open pool found',
  emptyDescription = 'No existing open pools in this session match your item, category, and specifications.',
  createAlertHref,
  separatePoolHref,
  onAdjustSearch,
  onJoinSuccess,
}: CompetingPoolsComparisonProps) {
  const openCount = candidates.filter(
    (c) => c.availability === 'joinable' || c.availability === 'offer_review_only'
  ).length;
  const unavailableCount = candidates.length - openCount;
  const allUnavailable = candidates.length > 0 && openCount === 0;
  const hasExactTextCandidate = candidates.some((c) => !c.isApproximateMatch);
  const activeSuggestion =
    !hasExactTextCandidate && suggestedQuery ? suggestedQuery : null;

  return (
    <div className="space-y-4">
      {/* Reference Pool Summary Strip (when comparing against an existing pool) */}
      {referencePool && (
        <div className="p-4 bg-[#F6F1E5] border border-[#8C9A86] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4E6359]">
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
          <p className="font-mono text-[11px] text-[#4E6359]">
            {referencePool.location} · {referencePool.metrics.eligibleInterestedUnits} interested ·{' '}
            {referencePool.metrics.confirmedUnits} confirmed · Target{' '}
            {referencePool.metrics.targetMin} {referencePool.unitPlural} · Goal{' '}
            {formatCalendarDate(referencePool.goalDate)}
          </p>
        </div>
      )}

      {/* Active Search Criteria Summary */}
      {querySummary && !referencePool && (
        <div className="p-4 bg-[#F6F1E5] border border-[#CDD6CC] flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4E6359]">
              Active comparison criteria
            </p>
            <p className="text-sm font-semibold text-[#152B23]">{querySummary.title}</p>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-[#4E6359]">
              <span>Category: {querySummary.category || 'Any'}</span>
              <span aria-hidden="true">·</span>
              <span>Location: {querySummary.location || 'Any location'}</span>
              {querySummary.goalDate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Target: {formatCalendarDate(querySummary.goalDate)}</span>
                </>
              )}
              {querySummary.windowLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Window: {querySummary.windowLabel}</span>
                </>
              )}
              {querySummary.stageLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Stage: {querySummary.stageLabel}</span>
                </>
              )}
              {querySummary.specsText && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#1E4334]">{querySummary.specsText}</span>
                </>
              )}
            </div>
          </div>
          {onRefreshCandidates && (
            <button
              type="button"
              disabled={loading}
              onClick={onRefreshCandidates}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#8C9A86] hover:border-[#1E4334] font-mono text-[11px] uppercase text-[#152B23] cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Recheck live</span>
            </button>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div
          role="status"
          aria-live="polite"
          className="p-6 bg-white border border-[#CDD6CC] flex items-center gap-3 text-sm text-[#152B23]"
        >
          <RefreshCw className="w-4 h-4 animate-spin text-[#1E4334] shrink-0" aria-hidden="true" />
          <span>Checking live buying pools in this session for same-item matches…</span>
        </div>
      )}

      {/* Retryable Error State */}
      {!loading && error && (
        <div
          role="alert"
          className="p-5 bg-[#FDF4F2] border border-[#A63A2B] space-y-3 text-sm text-[#A63A2B]"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold">Could not check existing pools</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#A63A2B] font-mono text-[11px] font-semibold uppercase text-[#A63A2B] hover:bg-[#A63A2B] hover:text-white cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Try again</span>
            </button>
          )}
        </div>
      )}

      {/* Useful Empty State (0 compatible pools) */}
      {!loading && !error && candidates.length === 0 && (
        <div className="p-6 bg-white border border-[#CDD6CC] space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[#152B23]">
              <Info className="w-4 h-4 text-[#1E4334] shrink-0" aria-hidden="true" />
              <p className="font-mono text-xs font-semibold uppercase tracking-wider">{emptyTitle}</p>
            </div>
            <p className="text-sm text-[#4E6359] leading-relaxed">
              {querySummary?.title ? (
                <>
                  No compatible open pool matched{' '}
                  <strong className="text-[#152B23]">&ldquo;{querySummary.title}&rdquo;</strong>
                  {querySummary.category ? ` in ${querySummary.category}` : ''}
                  {querySummary.specsText ? ` (${querySummary.specsText})` : ''}
                  {querySummary.location ? ` near ${querySummary.location}` : ''}.{' '}
                </>
              ) : null}
              {emptyDescription}
            </p>
          </div>

          {(onAdjustSearch || createAlertHref || separatePoolHref) && (
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {onAdjustSearch && (
                <button
                  type="button"
                  onClick={onAdjustSearch}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#F6F1E5] text-[#152B23] border border-[#8C9A86] hover:border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider cursor-pointer whitespace-nowrap"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Adjust search</span>
                </button>
              )}
              {createAlertHref && (
                <Link
                  to={createAlertHref}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                >
                  <BellPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Create item alert</span>
                </Link>
              )}
              {separatePoolHref && (
                <Link
                  to={separatePoolHref}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#1E4334] hover:bg-[#152B23] text-white border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                >
                  <span>Start a separate pool</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Notice when all matched same-item pools are ended / unavailable */}
      {!loading && !error && allUnavailable && (
        <div className="p-4 bg-[#F6F1E5] border border-[#8C9A86] space-y-2">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
            No compatible open pool — past or unlocked cohorts shown for reference
          </p>
          <p className="text-xs text-[#4E6359]">
            The matching {candidates.length === 1 ? 'pool below is' : 'pools below are'} no longer
            accepting new buyers. You can inspect past terms below, save an item alert, or start a
            fresh buying pool.
          </p>
        </div>
      )}

      {/* Compatible Candidate List */}
      {!loading && !error && candidates.length > 0 && (
        <div className="space-y-4">
          {activeSuggestion && onApplySuggestion && (
            <div className="p-3 bg-[#FFFDF5] border border-[#D49B00] flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-[#152B23]">
                Showing approximate matches for{' '}
                <strong>&ldquo;{querySummary?.title}&rdquo;</strong>.
              </p>
              <button
                type="button"
                onClick={() => onApplySuggestion(activeSuggestion)}
                className="px-3 py-1.5 bg-white hover:bg-[#1E4334] text-[#152B23] hover:text-white border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider cursor-pointer transition-colors"
              >
                Search &ldquo;{activeSuggestion}&rdquo;
              </button>
            </div>
          )}

          <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#4E6359]"
          >
            <span>
              {candidates.length} compatible {candidates.length === 1 ? 'pool' : 'pools'} found
              {openCount > 0 ? ` · ${openCount} open` : ''}
              {unavailableCount > 0 ? ` · ${unavailableCount} unavailable/ended` : ''}
            </span>
            <span>Ranked by exactness, verified fit &amp; published quote</span>
          </div>

          <div className="space-y-4">
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

      {/* Reference-Only Incompatible Variants (never merged into compatible candidates) */}
      {!loading && !error && referencePools.length > 0 && (
        <section aria-label="Reference only incompatible variant pools" className="space-y-3 pt-2">
          <div className="space-y-0.5">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
              Reference only — incompatible variant ({referencePools.length})
            </h3>
            <p className="text-xs text-[#4E6359]">
              These same-category pools are for a different model year, trim, powertrain,
              drivetrain, unit size, or SKU. They are excluded from your compatible matches so
              groups stay uniform for seller quotes.
            </p>
          </div>
          <div className="space-y-3">
            {referencePools.map((ref) => (
              <ReferenceOnlyCard key={ref.pool.id} reference={ref} />
            ))}
          </div>
        </section>
      )}

      {/* Deliberate "Create separate pool anyway" footer when matches exist on Explore */}
      {!loading && !error && candidates.length > 0 && separatePoolHref && (
        <div className="p-4 bg-[#F6F1E5] border border-[#CDD6CC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs text-[#152B23] leading-relaxed">
            None of these pools fit your exact specs, city, or timing window? You can still start a
            separate buying pool.
          </p>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {createAlertHref && (
              <Link
                to={createAlertHref}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#1E4334] text-[#152B23] hover:text-white border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors"
              >
                <BellPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Create item alert</span>
              </Link>
            )}
            <Link
              to={separatePoolHref}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#1E4334] hover:bg-[#152B23] text-white border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors"
            >
              <span>Create separate pool anyway</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
