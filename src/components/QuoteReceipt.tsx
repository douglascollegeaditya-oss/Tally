import { AlertTriangle, CheckCircle2, FileText, Info, XCircle } from 'lucide-react';
import type { Pool, SellerOffer } from '../domain/types.ts';
import { evaluateQuoteCompatibility } from '../domain/vehicleEngine.ts';
import { formatCalendarDate, formatCurrency, formatDateTimePacific } from '../lib/format.ts';
import { VehicleSpecsDisplay } from './VehicleSpecsDisplay.tsx';

interface QuoteReceiptProps {
  offer: SellerOffer;
  unitSingular: string;
  unitPlural: string;
  quantity?: number;
  previewMode?: boolean;
  pool?: Pick<Pool, 'category' | 'title' | 'vehicleSpecs' | 'sharedRequirements'>;
}

export function QuoteReceipt({
  offer,
  unitSingular,
  unitPlural,
  quantity = 1,
  previewMode = false,
  pool,
}: QuoteReceiptProps) {
  const unitLabelCapital =
    unitSingular.charAt(0).toUpperCase() + unitSingular.slice(1).toLowerCase();
  const multipliedSubtotal = offer.subtotal * quantity;
  const currency = offer.currency || 'USD';

  const quoteCompat =
    pool && pool.category === 'Vehicles' ? evaluateQuoteCompatibility(pool, offer) : null;

  const itemizedFees = offer.itemizedFees && offer.itemizedFees.length > 0 ? offer.itemizedFees : null;
  const hasUnknownFees =
    offer.knownFeesUnknown === true ||
    Boolean(itemizedFees?.some((f) => f.status === 'unknown'));

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
            {previewMode
              ? 'Buyer receipt preview'
              : `Official seller quote · Version ${offer.version} (${currency})`}
          </span>
        </div>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
          {offer.sellerName}
        </span>
      </div>

      {/* Main receipt body */}
      <div className="p-5 sm:p-6 space-y-5">
        {/* Spec conflict / verification callouts for Vehicle pools */}
        {quoteCompat && !quoteCompat.compatible && (
          <div
            role="alert"
            data-testid="quote-spec-conflict-alert"
            className="p-4 bg-[#FDF0EE] border-2 border-[#A63A2B] space-y-2 text-xs text-[#152B23]"
          >
            <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[#A63A2B]">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Quote conflicts with required pool specifications</span>
            </div>
            <p className="text-[#4B231D]">
              This dealer quote differs from one or more required specifications in this buying
              pool. Do not confirm unless you have verified the discrepancy with the organizer and
              dealer.
            </p>
            <ul className="list-disc pl-4 space-y-1 font-medium text-[#A63A2B]">
              {quoteCompat.conflicts.map((conflict, idx) => (
                <li key={idx}>{conflict}</li>
              ))}
            </ul>
          </div>
        )}

        {quoteCompat &&
          quoteCompat.compatible &&
          quoteCompat.status === 'possible_verify' &&
          quoteCompat.unverifiedFields.length > 0 && (
            <div
              role="note"
              data-testid="quote-spec-verify-note"
              className="p-3.5 bg-[#FFFDF5] border border-[#D49B00] text-xs text-[#152B23] space-y-1"
            >
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#8A5406] flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Verify unspecified vehicle terms with dealer</span>
              </p>
              <p className="text-[#516B61]">
                Not explicitly stated in this quote: {quoteCompat.unverifiedFields.join(', ')}.
              </p>
            </div>
          )}

        <div>
          <h2 className="font-display text-xl tracking-tight text-[#152B23] uppercase">
            {offer.sellerName}
          </h2>
          <p className="mt-0.5 text-sm text-[#516B61]">{offer.sellerLocation}</p>
        </div>

        {/* Quoted Vehicle Configuration (when supplied on Vehicles quotes) */}
        {offer.quotedVehicle && (
          <VehicleSpecsDisplay
            specs={offer.quotedVehicle}
            title="Quoted vehicle & configuration"
          />
        )}

        {/* Itemized ledger */}
        <div className="border-t border-b border-[#C6D8CE] py-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="text-[#152B23]">
              Per-{unitSingular} price ({currency})
            </span>
            <span className="font-mono font-semibold text-[#152B23] tabular-nums">
              {formatCurrency(offer.unitPrice)}
            </span>
          </div>

          {itemizedFees ? (
            itemizedFees.map((fee) => (
              <div key={fee.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-[#516B61]">
                  {fee.label}
                  {fee.note ? (
                    <span className="block text-[11px] text-[#6B7872]">{fee.note}</span>
                  ) : null}
                </span>
                {fee.status === 'unknown' ? (
                  <span className="font-mono text-xs font-semibold uppercase text-[#8A5406] shrink-0">
                    Unknown / TBD
                  </span>
                ) : (
                  <span className="font-mono font-medium text-[#152B23] tabular-nums shrink-0">
                    {fee.amount === 0 ? '$0 (explicitly $0)' : formatCurrency(fee.amount ?? 0)}
                  </span>
                )}
              </div>
            ))
          ) : (
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-[#516B61]">{offer.feeLabel || 'Known fees'}</span>
              {hasUnknownFees ? (
                <span className="font-mono text-xs font-semibold uppercase text-[#8A5406]">
                  Unknown / TBD
                </span>
              ) : (
                <span className="font-mono font-medium text-[#152B23] tabular-nums">
                  {offer.knownFees === 0
                    ? '$0 (explicitly $0)'
                    : formatCurrency(offer.knownFees)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Subtotal */}
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="space-y-0.5 max-w-md">
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
              {hasUnknownFees
                ? `Base + fixed fees subtotal ${quantity > 1 ? `(${quantity} ${unitPlural})` : `(per ${unitSingular})`}`
                : `Subtotal ${quantity > 1 ? `(${quantity} ${unitPlural})` : `(per ${unitSingular})`}`}
            </p>
            {hasUnknownFees && (
              <p className="text-xs font-medium text-[#8A5406]">
                Excludes Unknown / TBD fee items listed above — final out-the-door total requires
                dealer confirmation.
              </p>
            )}
            <p className="text-xs text-[#516B61]">
              {offer.taxTreatment || offer.taxAndRegistrationNote}
            </p>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl sm:text-3xl text-[#152B23] tabular-nums">
              {formatCurrency(quantity > 1 ? multipliedSubtotal : offer.subtotal)}
            </p>
            {hasUnknownFees && (
              <p className="font-mono text-[10px] font-semibold uppercase text-[#8A5406]">
                + TBD fee items
              </p>
            )}
          </div>
        </div>

        {/* Included & Explicitly Excluded Items */}
        {((offer.includedItems && offer.includedItems.length > 0) ||
          (offer.excludedItems && offer.excludedItems.length > 0)) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {offer.includedItems && offer.includedItems.length > 0 && (
              <div className="p-3.5 bg-[#EFF5F1] border border-[#C6D8CE] space-y-1.5">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#1E4334]">
                  Included in quote
                </p>
                <ul className="space-y-1 text-[#152B23]">
                  {offer.includedItems.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 leading-snug">
                      <CheckCircle2
                        className="w-3.5 h-3.5 text-[#1E4334] shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {offer.excludedItems && offer.excludedItems.length > 0 && (
              <div className="p-3.5 bg-[#FDF4F2] border border-[#E6C4BE] space-y-1.5">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#A63A2B]">
                  Not included / excluded
                </p>
                <ul className="space-y-1 text-[#152B23]">
                  {offer.excludedItems.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 leading-snug">
                      <XCircle
                        className="w-3.5 h-3.5 text-[#A63A2B] shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Specification box (soft sage matching tally-offer.jpg) */}
        <div className="bg-[#EAF7EF] border border-[#C6D8CE] p-4 space-y-2.5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
            Matching specification &amp; terms
          </p>
          <p className="text-sm text-[#152B23] leading-relaxed">{offer.matchingScope}</p>
          {offer.paymentTerms && (
            <p className="text-xs text-[#152B23]">
              <strong className="font-mono text-[10px] uppercase text-[#516B61]">
                Payment terms:{' '}
              </strong>
              {offer.paymentTerms}
            </p>
          )}
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
                Offer expires
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
            Direct seller payment after unlock · No tax/financing estimate · Simulated demo
          </span>
        </div>
      </div>
    </section>
  );
}
