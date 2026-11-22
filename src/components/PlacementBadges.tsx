import React, { useState } from 'react';
import { Award, Info, Megaphone } from 'lucide-react';
import type { Pool, PoolMetrics } from '../domain/types.ts';
import {
  getPoolPlacementInfo,
  TALLY_CERTIFIED_DISCLAIMER,
} from '../domain/vehicleEngine.ts';

interface PlacementBadgesProps {
  pool: Pick<Pool, 'stage' | 'tallyCertification' | 'paidPlacement'> & {
    metrics?: Pick<PoolMetrics, 'effectiveStage'>;
  };
  /** Compact mode for Explore/Comparison cards; detailed mode for Pool Detail header */
  variant?: 'card' | 'detail';
  showDisclosurePanel?: boolean;
}

export function PlacementBadges({
  pool,
  variant = 'card',
  showDisclosurePanel = false,
}: PlacementBadgesProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const info = getPoolPlacementInfo(pool);

  if (!info.isPaidFeatured && !info.isTallyCertified) {
    return null;
  }

  const cert = pool.tallyCertification;
  const paid = pool.paidPlacement;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" data-testid="placement-badges">
        {info.isPaidFeatured && (
          <span
            className={`inline-flex items-center gap-1 rounded-[4px] border border-[#D4971F] bg-[#FFF4D6] font-mono font-bold uppercase tracking-[0.07em] text-[#7A4B00] ${
              variant === 'detail' ? 'px-2.5 py-1 text-[11px]' : 'px-2 py-0.5 text-[10px]'
            }`}
            title={
              paid?.sponsorName
                ? `Paid featured placement by ${paid.sponsorName} (demo example)`
                : 'Paid featured placement'
            }
          >
            <Megaphone className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{paid?.label || 'Sponsored · Featured'}</span>
          </span>
        )}

        {info.isTallyCertified && (
          <span
            className={`inline-flex items-center gap-1 rounded-[4px] border border-[#1E4334] bg-[#1E4334] font-mono font-bold uppercase tracking-[0.07em] text-[#FFBF32] ${
              variant === 'detail' ? 'px-2.5 py-1 text-[11px]' : 'px-2 py-0.5 text-[10px]'
            }`}
            title={TALLY_CERTIFIED_DISCLAIMER}
          >
            <Award className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{cert?.label || 'Tally Certified bulk deal'}</span>
          </span>
        )}

        {info.isTallyCertified && !showDisclosurePanel && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setInfoOpen((v) => !v);
            }}
            aria-expanded={infoOpen}
            className="tally-tactile inline-flex items-center gap-1 rounded-[4px] border border-[#DDD7C8] bg-[#FBF9F4] px-1.5 py-0.5 text-[10px] font-medium text-[#526059] hover:border-[#1E4334] hover:text-[#152B23]"
          >
            <Info className="h-3 w-3" aria-hidden="true" />
            <span>What is this?</span>
          </button>
        )}
      </div>

      {info.isTallyCertified && (showDisclosurePanel || infoOpen) && (
        <div
          className="rounded-[6px] border border-[#CBE0D5] bg-[#F2F7F4] px-3 py-2.5 text-xs leading-relaxed text-[#1E3B30]"
          role="note"
          data-testid="tally-certified-disclosure"
        >
          <p className="font-semibold text-[#152B23]">
            About Tally Certified bulk deals
            {cert?.isDemoExample ? ' (Fictional demo example)' : ''}
          </p>
          <p className="mt-1">
            {cert?.summary ||
              'Tally coordinated this bulk deal directly with a participating dealer for qualifying buyers.'}
            {cert?.partnerDealerLabel ? ` Participating dealer: ${cert.partnerDealerLabel}.` : ''}
          </p>
          <p className="mt-1 text-[11px] text-[#455A51]">
            {cert?.disclaimer || TALLY_CERTIFIED_DISCLAIMER}
          </p>
        </div>
      )}

      {info.isPaidFeatured && showDisclosurePanel && (
        <p className="text-[11px] text-[#7A5416]" data-testid="paid-placement-disclosure">
          <strong>Sponsored · Featured placement:</strong> Paid featured listings rank ahead of
          Tally Certified and organic listings within matching Explore filters, never override
          vehicle compatibility or availability.
          {paid?.sponsorName ? ` Sponsor: ${paid.sponsorName}.` : ''}
        </p>
      )}
    </div>
  );
}
