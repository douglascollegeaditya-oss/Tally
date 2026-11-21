import { FileText } from 'lucide-react';
import type { SellerOffer } from '../domain/types.ts';
import { formatCalendarDate, formatCurrency, formatDateTimePacific } from '../lib/format.ts';

interface QuoteReceiptProps {
  offer: SellerOffer;
  unitSingular: string;
  unitPlural: string;
  quantity?: number;
  previewMode?: boolean;
}

export function QuoteReceipt({
  offer,
  unitSingular,
  unitPlural,
  quantity = 1,
  previewMode = false,
}: QuoteReceiptProps) {
  const unitLabelCapital =
    unitSingular.charAt(0).toUpperCase() + unitSingular.slice(1).toLowerCase();
  const multipliedSubtotal = offer.subtotal * quantity;

  return (
    <section
      aria-label="Conditional seller quote receipt"
      className="bg-white border border-[#152B23]/25"
    >
      {/* Top receipt header strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-[#C6D8CE] bg-[#F6F1E5]/60">
        <div className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-wider text-[#516B61]">
          <FileText className="w-3.5 h-3.5 text-[#152B23]" aria-hidden="true" />
          <span>
            {previewMode ? 'Buyer receipt preview' : `Official seller quote · Version ${offer.version}`}
          </span>
        </div>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
          {offer.sellerName}
        </span>
      </div>

      {/* Main receipt body */}
      <div className="p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="font-display text-xl tracking-tight text-[#152B23] uppercase">
            {offer.sellerName}
          </h2>
          <p className="mt-0.5 text-sm text-[#516B61]">{offer.sellerLocation}</p>
        </div>

        {/* Itemized ledger */}
        <div className="border-t border-b border-[#C6D8CE] py-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="text-[#152B23]">{unitLabelCapital} price</span>
            <span className="font-mono font-semibold text-[#152B23] tabular-nums">
              {formatCurrency(offer.unitPrice)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="text-[#516B61]">{offer.feeLabel}</span>
            <span className="font-mono font-medium text-[#152B23] tabular-nums">
              {formatCurrency(offer.knownFees)}
            </span>
          </div>
        </div>

        {/* Subtotal */}
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
              Subtotal {quantity > 1 ? `(${quantity} ${unitPlural})` : `(per ${unitSingular})`}
            </p>
            <p className="text-xs text-[#516B61] mt-0.5">{offer.taxAndRegistrationNote}</p>
          </div>
          <p className="font-display text-2xl sm:text-3xl text-[#152B23] tabular-nums">
            {formatCurrency(quantity > 1 ? multipliedSubtotal : offer.subtotal)}
          </p>
        </div>

        {/* Specification box (soft sage matching tally-offer.jpg) */}
        <div className="bg-[#EAF7EF] border border-[#C6D8CE] p-4 space-y-2">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
            Matching specification & terms
          </p>
          <p className="text-sm text-[#152B23] leading-relaxed">{offer.matchingScope}</p>
          <div className="pt-2 border-t border-[#C6D8CE]/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="block font-mono text-[10px] uppercase text-[#516B61]">
                Group threshold
              </span>
              <span className="font-semibold text-[#152B23] tabular-nums">
                Min {offer.minQuantity} · Cap {offer.maxQuantity} {unitPlural}
              </span>
            </div>
            <div>
              <span className="block font-mono text-[10px] uppercase text-[#516B61]">
                Offer closes
              </span>
              <span className="font-semibold text-[#152B23]">
                {formatDateTimePacific(offer.closeAt, offer.timezoneLabel)}
              </span>
            </div>
            <div>
              <span className="block font-mono text-[10px] uppercase text-[#516B61]">
                Claim / pickup by
              </span>
              <span className="font-semibold text-[#152B23]">
                {formatCalendarDate(offer.claimByDate)}
              </span>
            </div>
          </div>
        </div>

        {/* Fulfillment & simulated disclosure */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#516B61] pt-1">
          <span>Fulfillment: {offer.fulfillmentMethod}</span>
          <span className="font-mono text-[11px]">
            Direct seller payment after unlock · Simulated demo
          </span>
        </div>
      </div>
    </section>
  );
}
