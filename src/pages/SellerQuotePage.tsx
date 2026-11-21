import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, History, ShieldCheck } from 'lucide-react';
import { canAccessSellerRoute } from '../domain/tallyEngine.ts';
import type { SellerOffer } from '../domain/types.ts';
import { ApiRequestError, type SellerPacketResponse, useTally } from '../lib/api.ts';
import { formatCurrency, formatDeadlineCompact, formatUnit } from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import { QuoteReceipt } from '../components/QuoteReceipt.tsx';
import { RoleGate } from '../components/RoleGate.tsx';

interface QuoteFormState {
  sellerName: string;
  sellerLocation: string;
  matchingScope: string;
  unitPrice: string;
  knownFees: string;
  feeLabel: string;
  taxAndRegistrationNote: string;
  minQuantity: string;
  maxQuantity: string;
  fulfillmentMethod: string;
  closeDateLocal: string; // YYYY-MM-DDTHH:mm in Pacific
  timezoneLabel: string;
  claimByDate: string;
  privateClaimInstructions: string;
  revisionSummary: string;
}

function isoToPacificInput(iso: string): string {
  // Default fixture Dec 14, 2026 18:00 Pacific = 2026-12-15T02:00:00Z
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '2026-12-14T18:00';
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Los_Angeles',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function pacificInputToIso(val: string): string {
  // Standard Pacific time in Dec is UTC-08:00
  if (!val || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) return '';
  return `${val}:00-08:00`;
}

function buildInitialForm(packet: SellerPacketResponse): QuoteFormState {
  const existing = packet.currentOffer;
  if (existing) {
    return {
      sellerName: existing.sellerName,
      sellerLocation: existing.sellerLocation,
      matchingScope: existing.matchingScope,
      unitPrice: String(existing.unitPrice),
      knownFees: String(existing.knownFees),
      feeLabel: existing.feeLabel,
      taxAndRegistrationNote: existing.taxAndRegistrationNote,
      minQuantity: String(existing.minQuantity),
      maxQuantity: String(existing.maxQuantity),
      fulfillmentMethod: existing.fulfillmentMethod,
      closeDateLocal: isoToPacificInput(existing.closeAt),
      timezoneLabel: existing.timezoneLabel || 'Pacific',
      claimByDate: existing.claimByDate,
      privateClaimInstructions: existing.privateClaimInstructions,
      revisionSummary: '',
    };
  }

  const isMaverick = packet.poolId === 'pool-maverick-xlt';
  return {
    sellerName: isMaverick ? 'Alder Motor Co.' : 'Pacific Northwest Group Supply (Fictional)',
    sellerLocation: isMaverick
      ? 'Portland, OR (Fictional demo dealership)'
      : `${packet.location} (Fictional demo seller)`,
    matchingScope: isMaverick
      ? '2026 Ford Maverick XLT Hybrid AWD · Portland metro pickup · Standard XLT Equipment Group'
      : `${packet.title} · Matching shared pool requirements`,
    unitPrice: isMaverick ? '27900' : '1200',
    knownFees: isMaverick ? '395' : '75',
    feeLabel: isMaverick ? 'Dealer documentation fee' : 'Handling & delivery fee',
    taxAndRegistrationNote: isMaverick
      ? 'Excludes Oregon privilege tax, title, and DMV registration.'
      : 'Excludes applicable local tax.',
    minQuantity: String(packet.minQuantity),
    maxQuantity: String(packet.maxQuantity),
    fulfillmentMethod: isMaverick
      ? 'Direct buyer-to-seller purchase & delivery at Alder Motor Co. (Portland)'
      : `Direct buyer fulfillment (${packet.deliveryOrDestination})`,
    closeDateLocal: '2026-12-14T18:00',
    timezoneLabel: 'Pacific',
    claimByDate: '2026-12-20',
    privateClaimInstructions: isMaverick
      ? 'SIMULATED DEMO INSTRUCTIONS: Present reference code to Alder Motor Co. Fleet Desk in Portland before Dec 20, 2026 to complete direct buyer-to-seller paperwork and payment. No real payment or reservation has been made.'
      : 'SIMULATED DEMO INSTRUCTIONS: Contact the seller desk directly with your claim reference code before the claim-by date.',
    revisionSummary: '',
  };
}

export function SellerQuotePage({ token }: { token: string }) {
  const { role, busy, fetchSellerPacket, publishSellerOfferAction, session } = useTally();

  const [packet, setPacket] = useState<SellerPacketResponse | null>(null);
  const [loadingPacket, setLoadingPacket] = useState(true);
  const [packetError, setPacketError] = useState<{ code?: string; message: string } | null>(null);

  const [form, setForm] = useState<QuoteFormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [publishedBanner, setPublishedBanner] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!canAccessSellerRoute(role)) {
      setLoadingPacket(false);
      return;
    }
    setLoadingPacket(true);
    setPacketError(null);
    fetchSellerPacket(token)
      .then((data) => {
        if (!active) return;
        setPacket(data);
        setForm((prev) => prev ?? buildInitialForm(data));
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiRequestError) {
          setPacketError({ code: err.error.code, message: err.error.message });
        } else {
          setPacketError({ message: 'Unable to load seller request packet.' });
        }
      })
      .finally(() => {
        if (active) setLoadingPacket(false);
      });
    return () => {
      active = false;
    };
  }, [token, role, fetchSellerPacket, session?.updatedAt]);

  if (!canAccessSellerRoute(role)) {
    return (
      <RoleGate
        title="Private seller quote form"
        requiredRole="seller"
        reason="This private quote link is restricted to the Seller role so buyers and other users cannot alter or submit seller offers."
        backTo="/"
        backLabel="Back to Explore"
      />
    );
  }

  if (loadingPacket) {
    return (
      <div className="bg-white border border-[#C6D8CE] p-8 text-center font-mono text-xs uppercase text-[#516B61]">
        Loading aggregate buyer request…
      </div>
    );
  }

  if (packetError || !packet || !form) {
    return (
      <div className="bg-white border border-[#A63A2B] p-6 max-w-lg mx-auto space-y-3">
        <h1 className="font-display text-xl text-[#152B23] uppercase">Seller link unavailable</h1>
        <p className="text-sm text-[#516B61]">
          {packetError?.message || 'This seller request token was not found in your demo session.'}
        </p>
        <Link
          to="/"
          className="inline-flex px-4 py-2 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase"
        >
          Back to Explore
        </Link>
      </div>
    );
  }

  const unitPriceNum = Number(form.unitPrice);
  const feesNum = Number(form.knownFees);
  const calcSubtotal =
    (Number.isFinite(unitPriceNum) ? unitPriceNum : 0) + (Number.isFinite(feesNum) ? feesNum : 0);
  const isRevising = packet.currentOffer !== undefined;
  const isLocked =
    packet.metrics.effectiveStage === 'unlocked' || packet.metrics.effectiveStage === 'closed';

  const previewOffer: SellerOffer = {
    version: isRevising ? packet.currentOffer!.version + 1 : 1,
    sellerName: form.sellerName || 'Seller name',
    sellerLocation: form.sellerLocation || packet.location,
    matchingScope: form.matchingScope || packet.title,
    currency: 'USD',
    unitPrice: Number.isFinite(unitPriceNum) ? unitPriceNum : 0,
    knownFees: Number.isFinite(feesNum) ? feesNum : 0,
    feeLabel: form.feeLabel || 'Known fee',
    subtotal: calcSubtotal,
    taxAndRegistrationNote: form.taxAndRegistrationNote,
    minQuantity: Number(form.minQuantity) || packet.minQuantity,
    maxQuantity: Number(form.maxQuantity) || packet.maxQuantity,
    fulfillmentMethod: form.fulfillmentMethod,
    closeAt: pacificInputToIso(form.closeDateLocal) || '2026-12-15T02:00:00Z',
    timezoneLabel: form.timezoneLabel || 'Pacific',
    claimByDate: form.claimByDate || '2026-12-20',
    publishedAt: packet.demoNow,
    privateClaimInstructions: form.privateClaimInstructions,
    privateReferencePrefix: 'PREVIEW',
  };

  const updateField = <K extends keyof QuoteFormState>(key: K, val: QuoteFormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: val } : prev));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setFieldErrors({});
    setPublishedBanner(null);

    const closeIso = pacificInputToIso(form.closeDateLocal);

    try {
      const res = await publishSellerOfferAction(token, {
        sellerName: form.sellerName,
        sellerLocation: form.sellerLocation,
        matchingScope: form.matchingScope,
        currency: 'USD',
        unitPrice: Number(form.unitPrice),
        knownFees: Number(form.knownFees),
        feeLabel: form.feeLabel,
        taxAndRegistrationNote: form.taxAndRegistrationNote,
        minQuantity: Number(form.minQuantity),
        maxQuantity: Number(form.maxQuantity),
        fulfillmentMethod: form.fulfillmentMethod,
        closeAt: closeIso,
        timezoneLabel: form.timezoneLabel,
        claimByDate: form.claimByDate,
        privateClaimInstructions: form.privateClaimInstructions,
        revisionSummary: form.revisionSummary || undefined,
      });

      setPublishedBanner(
        res.isRevision
          ? `Revised Offer v${res.offer.version} published! Prior confirmations were cleared and buyers must reconfirm.`
          : `Offer v${res.offer.version} published (${formatCurrency(res.offer.subtotal)} subtotal). Buyers can now review and confirm.`
      );
      const updated = await fetchSellerPacket(token);
      setPacket(updated);
      setForm(buildInitialForm(updated));
    } catch (err) {
      // Preserve draft values on any validation error!
      if (err instanceof ApiRequestError) {
        setSubmitError(err.error.message);
        if (err.error.fieldErrors) setFieldErrors(err.error.fieldErrors);
      } else {
        setSubmitError('Unable to publish seller quote.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#C6D8CE]">
        <Link
          to={`/pools/${packet.poolId}`}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-[#152B23] underline underline-offset-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>View public pool listing</span>
        </Link>
        <span className="px-2.5 py-0.5 bg-[#152B23] text-[#FFBF32] font-mono text-[11px] uppercase tracking-wider">
          Seller workspace · Simulated demo
        </span>
      </div>

      {/* Aggregate Buyer Request Summary */}
      <section
        aria-label="Aggregate buyer demand packet"
        className="bg-white border border-[#152B23]/30 p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-[#516B61]">
              Buyer group quote request · {packet.category} · {packet.location}
            </p>
            <h1 className="mt-1 font-display text-2xl sm:text-3xl text-[#152B23] uppercase">
              {packet.title}
            </h1>
          </div>
          <div className="p-3 bg-[#EAF7EF] border border-[#152B23] text-right shrink-0">
            <p className="font-mono text-[10px] uppercase text-[#516B61]">Eligible demand</p>
            <p className="font-display text-2xl text-[#152B23] tabular-nums">
              {formatUnit(packet.metrics.eligibleInterestedUnits, packet.unitSingular, packet.unitPlural)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#C6D8CE]">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase text-[#516B61] mb-1.5">
              Shared buyer requirements
            </p>
            <ul className="space-y-1 text-xs text-[#152B23]">
              {packet.sharedRequirements.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-mono text-[11px] font-semibold uppercase text-[#516B61] mb-1.5">
              Aggregate quantities by variant (no buyer PII)
            </p>
            <ul className="space-y-1 text-xs font-mono text-[#152B23]">
              {packet.metrics.variantBreakdown.map((v) => (
                <li key={v.variantLabel} className="flex justify-between gap-2">
                  <span className="truncate">{v.variantLabel}</span>
                  <span className="font-semibold shrink-0 tabular-nums">×{v.eligibleUnits}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#516B61]">
          <ShieldCheck className="w-4 h-4 text-[#152B23] shrink-0" aria-hidden="true" />
          <span>
            Buyers only unlock your direct fulfillment instructions after your minimum quantity
            confirms before the deadline.
          </span>
        </div>
      </section>

      {publishedBanner && (
        <div
          role="status"
          className="p-4 bg-[#152B23] text-white border-2 border-[#152B23] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 text-sm">
            <Check className="w-4 h-4 text-[#FFBF32] shrink-0" aria-hidden="true" />
            <span>{publishedBanner}</span>
          </div>
          <Link
            to={`/pools/${packet.poolId}/offer`}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#FFBF32] text-[#152B23] font-mono text-xs font-semibold uppercase shrink-0"
          >
            <span>Open buyer offer review</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* Main Split: Quote Form Left, Live Buyer Receipt Preview Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handlePublish}
          noValidate
          className="lg:col-span-6 bg-white border border-[#C6D8CE] p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#C6D8CE]">
            <h2 className="font-heading text-lg font-bold text-[#152B23]">
              {isRevising
                ? `Revise conditional offer (will publish Version ${packet.currentOffer!.version + 1})`
                : 'Publish conditional seller quote (Version 1)'}
            </h2>
          </div>

          {isLocked && (
            <div className="p-3 bg-[#F6F1E5] border border-[#152B23] text-xs text-[#152B23]">
              This offer has already unlocked at minimum quantity and can no longer be edited.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="s-name" className="block font-mono text-[11px] uppercase text-[#152B23]">
                Seller name *
              </label>
              <input
                id="s-name"
                value={form.sellerName}
                onChange={(e) => updateField('sellerName', e.target.value)}
                disabled={isLocked}
                className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm"
              />
              {fieldErrors.sellerName && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.sellerName}</p>
              )}
            </div>

            <div>
              <label htmlFor="s-loc" className="block font-mono text-[11px] uppercase text-[#152B23]">
                Seller location
              </label>
              <input
                id="s-loc"
                value={form.sellerLocation}
                onChange={(e) => updateField('sellerLocation', e.target.value)}
                disabled={isLocked}
                className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="s-scope" className="block font-mono text-[11px] uppercase text-[#152B23]">
              Matching specification & scope *
            </label>
            <textarea
              id="s-scope"
              rows={2}
              value={form.matchingScope}
              onChange={(e) => updateField('matchingScope', e.target.value)}
              disabled={isLocked}
              className="mt-1 w-full p-2.5 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm"
            />
            {fieldErrors.matchingScope && (
              <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.matchingScope}</p>
            )}
          </div>

          {/* Pricing & Calculated Subtotal */}
          <div className="p-4 bg-[#F6F1E5]/70 border border-[#C6D8CE] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="s-price" className="block font-mono text-[11px] uppercase text-[#152B23]">
                  Unit price (USD) *
                </label>
                <input
                  id="s-price"
                  type="number"
                  min={1}
                  step="1"
                  value={form.unitPrice}
                  onChange={(e) => updateField('unitPrice', e.target.value)}
                  disabled={isLocked}
                  className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] font-mono text-sm"
                />
                {fieldErrors.unitPrice && (
                  <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.unitPrice}</p>
                )}
              </div>

              <div>
                <label htmlFor="s-fees" className="block font-mono text-[11px] uppercase text-[#152B23]">
                  Known fees (USD) *
                </label>
                <input
                  id="s-fees"
                  type="number"
                  min={0}
                  step="1"
                  value={form.knownFees}
                  onChange={(e) => updateField('knownFees', e.target.value)}
                  disabled={isLocked}
                  className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] font-mono text-sm"
                />
                {fieldErrors.knownFees && (
                  <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.knownFees}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="s-feelabel" className="block font-mono text-[11px] uppercase text-[#152B23]">
                  Fee label *
                </label>
                <input
                  id="s-feelabel"
                  value={form.feeLabel}
                  onChange={(e) => updateField('feeLabel', e.target.value)}
                  disabled={isLocked}
                  className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                />
                {fieldErrors.feeLabel && (
                  <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.feeLabel}</p>
                )}
              </div>

              <div className="flex flex-col justify-end">
                <div className="h-10 px-3 bg-[#152B23] text-white flex items-center justify-between font-mono text-xs">
                  <span>Calculated subtotal</span>
                  <strong className="text-[#FFBF32] tabular-nums">
                    {formatCurrency(calcSubtotal)}
                  </strong>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="s-tax" className="block font-mono text-[11px] uppercase text-[#152B23]">
                Tax & registration treatment
              </label>
              <input
                id="s-tax"
                value={form.taxAndRegistrationNote}
                onChange={(e) => updateField('taxAndRegistrationNote', e.target.value)}
                disabled={isLocked}
                className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
              />
            </div>
          </div>

          {/* Quantities & Deadlines */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="s-min" className="block font-mono text-[11px] uppercase text-[#152B23]">
                Minimum ({packet.unitPlural}) *
              </label>
              <input
                id="s-min"
                type="number"
                min={2}
                value={form.minQuantity}
                onChange={(e) => updateField('minQuantity', e.target.value)}
                disabled={isLocked}
                className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] font-mono text-sm"
              />
              {fieldErrors.minQuantity && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.minQuantity}</p>
              )}
            </div>

            <div>
              <label htmlFor="s-cap" className="block font-mono text-[11px] uppercase text-[#152B23]">
                Cap ({packet.unitPlural}) *
              </label>
              <input
                id="s-cap"
                type="number"
                min={2}
                value={form.maxQuantity}
                onChange={(e) => updateField('maxQuantity', e.target.value)}
                disabled={isLocked}
                className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] font-mono text-sm"
              />
              {fieldErrors.maxQuantity && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.maxQuantity}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="s-close" className="block font-mono text-[11px] uppercase text-[#152B23]">
                Offer closes (Pacific time) *
              </label>
              <input
                id="s-close"
                type="datetime-local"
                value={form.closeDateLocal}
                onChange={(e) => updateField('closeDateLocal', e.target.value)}
                disabled={isLocked}
                className="mt-1 w-full h-10 px-2.5 bg-[#EAF7EF]/40 border border-[#C6D8CE] font-mono text-xs"
              />
              {fieldErrors.closeAt && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.closeAt}</p>
              )}
            </div>

            <div>
              <label htmlFor="s-claim" className="block font-mono text-[11px] uppercase text-[#152B23]">
                Claim / pickup by *
              </label>
              <input
                id="s-claim"
                type="date"
                value={form.claimByDate}
                onChange={(e) => updateField('claimByDate', e.target.value)}
                disabled={isLocked}
                className="mt-1 w-full h-10 px-2.5 bg-[#EAF7EF]/40 border border-[#C6D8CE] font-mono text-xs"
              />
              {fieldErrors.claimByDate && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.claimByDate}</p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="s-fulfill" className="block font-mono text-[11px] uppercase text-[#152B23]">
              Fulfillment method *
            </label>
            <input
              id="s-fulfill"
              value={form.fulfillmentMethod}
              onChange={(e) => updateField('fulfillmentMethod', e.target.value)}
              disabled={isLocked}
              className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] text-sm"
            />
            {fieldErrors.fulfillmentMethod && (
              <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.fulfillmentMethod}</p>
            )}
          </div>

          <div>
            <label htmlFor="s-priv" className="block font-mono text-[11px] uppercase text-[#152B23]">
              Private claim instructions (shown ONLY after unlock, simulated)
            </label>
            <textarea
              id="s-priv"
              rows={2}
              value={form.privateClaimInstructions}
              onChange={(e) => updateField('privateClaimInstructions', e.target.value)}
              disabled={isLocked}
              className="mt-1 w-full p-2.5 bg-[#EAF7EF]/40 border border-[#C6D8CE] text-xs"
            />
          </div>

          {isRevising && (
            <div>
              <label htmlFor="s-rev" className="block font-mono text-[11px] uppercase text-[#A63A2B]">
                Revision summary for buyers (reconfirmation required)
              </label>
              <input
                id="s-rev"
                value={form.revisionSummary}
                onChange={(e) => updateField('revisionSummary', e.target.value)}
                placeholder="e.g., Adjusted vehicle price or extended deadline"
                disabled={isLocked}
                className="mt-1 w-full h-10 px-3 bg-[#F6F1E5] border border-[#152B23]/40 text-sm"
              />
            </div>
          )}

          {submitError && (
            <p role="alert" className="p-3 bg-[#FDF0EE] border border-[#A63A2B] text-xs text-[#A63A2B]">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || isLocked}
            className="w-full py-3.5 px-4 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-50"
          >
            {busy
              ? 'Publishing…'
              : isRevising
                ? `Publish revised Offer v${packet.currentOffer!.version + 1} (requires reconfirmation)`
                : 'Publish seller quote to pool'}
          </button>
        </form>

        {/* Live Buyer Preview & Offer History Right 6 cols */}
        <div className="lg:col-span-6 space-y-5 lg:sticky lg:top-20">
          <QuoteReceipt
            offer={previewOffer}
            unitSingular={packet.unitSingular}
            unitPlural={packet.unitPlural}
            previewMode
          />

          {packet.offerHistory.length > 0 && (
            <section className="bg-white border border-[#C6D8CE] p-5 space-y-3">
              <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23] flex items-center gap-2">
                <History className="w-4 h-4 text-[#516B61]" aria-hidden="true" />
                <span>Previous published versions ({packet.offerHistory.length})</span>
              </h2>
              <div className="space-y-2">
                {packet.offerHistory.map((old) => (
                  <div
                    key={old.version}
                    className="p-3 bg-[#F6F1E5]/60 border border-[#C6D8CE] text-xs flex flex-wrap justify-between gap-2"
                  >
                    <span className="font-mono font-semibold text-[#152B23]">
                      Version {old.version} · Min {old.minQuantity} · Closed{' '}
                      {formatDeadlineCompact(old.closeAt)}
                    </span>
                    <span className="font-mono tabular-nums text-[#516B61]">
                      {formatCurrency(old.subtotal)} subtotal
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
