import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, History, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { canAccessSellerRoute } from '../domain/tallyEngine.ts';
import type {
  DistanceUnit,
  QuoteFeeItem,
  SellerOffer,
  TrailerInclusion,
  VehicleCondition,
  VehicleSpecProfile,
  VehicleSubType,
} from '../domain/types.ts';
import {
  normalizeQuoteItemizedFees,
  VEHICLE_TYPE_LIST,
} from '../domain/vehicleEngine.ts';
import { ApiRequestError, type SellerPacketResponse, useTally } from '../lib/api.ts';
import { formatCurrency, formatDeadlineCompact, formatUnit } from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import { QuoteReceipt } from '../components/QuoteReceipt.tsx';
import { RoleGate } from '../components/RoleGate.tsx';

interface FeeDraftRow {
  id: string;
  label: string;
  status: 'fixed' | 'unknown';
  amount: string;
  note: string;
}

interface QuoteFormState {
  sellerName: string;
  sellerLocation: string;
  matchingScope: string;
  unitPrice: string;
  itemizedFees: FeeDraftRow[];
  taxAndRegistrationNote: string;
  paymentTerms: string;
  includedItemsText: string;
  excludedItemsText: string;
  minQuantity: string;
  maxQuantity: string;
  fulfillmentMethod: string;
  closeDateLocal: string; // YYYY-MM-DDTHH:mm in Pacific
  timezoneLabel: string;
  claimByDate: string;
  privateClaimInstructions: string;
  revisionSummary: string;
  // Structured quoted vehicle specs (for Vehicles motor-vehicle pools)
  qVehType: VehicleSubType | '';
  qVehCondition: VehicleCondition | '';
  qVehMake: string;
  qVehModel: string;
  qVehYear: string;
  qVehTrim: string;
  qVehPowertrain: string;
  qVehDrivetrain: string;
  qVehTransmission: string;
  qVehBodyConfig: string;
  qVehAxleConfig: string;
  qVehCabOrSleeper: string;
  qVehTrailerInclusion: TrailerInclusion | '';
  qVehBusType: string;
  qVehSeatingCapacity: string;
  qVehAccessibility: string;
  qVehMileageValue: string;
  qVehMileageUnit: DistanceUnit;
}

function isoToPacificInput(iso: string): string {
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
  if (!val || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) return '';
  return `${val}:00-08:00`;
}

function extractVehicleFormDefaults(source?: VehicleSpecProfile) {
  return {
    qVehType: source?.vehicleType ?? ('' as VehicleSubType | ''),
    qVehCondition: source?.condition ?? ('' as VehicleCondition | ''),
    qVehMake: source?.make ?? '',
    qVehModel: source?.model ?? '',
    qVehYear:
      source?.year !== undefined
        ? String(source.year)
        : source?.yearMin !== undefined
          ? String(source.yearMin)
          : '',
    qVehTrim: source?.trim ?? '',
    qVehPowertrain: source?.powertrain ?? '',
    qVehDrivetrain: source?.drivetrain ?? '',
    qVehTransmission: source?.transmission ?? '',
    qVehBodyConfig: source?.bodyConfiguration ?? '',
    qVehAxleConfig: source?.axleConfiguration ?? '',
    qVehCabOrSleeper: source?.cabOrSleeper ?? '',
    qVehTrailerInclusion: source?.trailerInclusion ?? ('' as TrailerInclusion | ''),
    qVehBusType: source?.busType ?? '',
    qVehSeatingCapacity:
      source?.seatingCapacity !== undefined ? String(source.seatingCapacity) : '',
    qVehAccessibility: source?.accessibilityRequirement ?? '',
    qVehMileageValue:
      source?.mileage?.value !== undefined
        ? String(source.mileage.value)
        : source?.maxMileage?.value !== undefined
          ? String(source.maxMileage.value)
          : '',
    qVehMileageUnit: source?.mileage?.unit ?? source?.maxMileage?.unit ?? ('mi' as DistanceUnit),
  };
}

function buildInitialForm(packet: SellerPacketResponse): QuoteFormState {
  const existing = packet.currentOffer;
  if (existing) {
    const feeRows: FeeDraftRow[] =
      existing.itemizedFees && existing.itemizedFees.length > 0
        ? existing.itemizedFees.map((f) => ({
            id: f.id,
            label: f.label,
            status: f.status,
            amount: f.status === 'fixed' && f.amount !== undefined ? String(f.amount) : '',
            note: f.note ?? '',
          }))
        : [
            {
              id: 'fee-1',
              label: existing.feeLabel || 'Dealer documentation fee',
              status: existing.knownFeesUnknown ? 'unknown' : 'fixed',
              amount: existing.knownFeesUnknown ? '' : String(existing.knownFees),
              note: '',
            },
          ];

    return {
      sellerName: existing.sellerName,
      sellerLocation: existing.sellerLocation,
      matchingScope: existing.matchingScope,
      unitPrice: String(existing.unitPrice),
      itemizedFees: feeRows,
      taxAndRegistrationNote: existing.taxTreatment || existing.taxAndRegistrationNote,
      paymentTerms: existing.paymentTerms ?? '',
      includedItemsText: (existing.includedItems ?? []).join('\n'),
      excludedItemsText: (existing.excludedItems ?? []).join('\n'),
      minQuantity: String(existing.minQuantity),
      maxQuantity: String(existing.maxQuantity),
      fulfillmentMethod: existing.fulfillmentMethod,
      closeDateLocal: isoToPacificInput(existing.closeAt),
      timezoneLabel: existing.timezoneLabel || 'Pacific',
      claimByDate: existing.claimByDate,
      privateClaimInstructions: existing.privateClaimInstructions,
      revisionSummary: '',
      ...extractVehicleFormDefaults(existing.quotedVehicle ?? packet.vehicleSpecs),
    };
  }

  const isMaverick = packet.poolId === 'pool-maverick-xlt';
  const isVehicleMotor =
    packet.category === 'Vehicles' && packet.vehicleSpecs?.assetClass !== 'accessory';
  return {
    sellerName: isMaverick ? 'Alder Motor Co.' : 'Pacific Northwest Group Supply (Fictional)',
    sellerLocation: isMaverick
      ? 'Portland, OR (Fictional demo dealership)'
      : `${packet.location} (Fictional demo seller)`,
    matchingScope: isMaverick
      ? '2026 Ford Maverick XLT Hybrid AWD · Portland metro pickup · Standard XLT Equipment Group'
      : `${packet.title} · Matching shared pool requirements`,
    unitPrice: isMaverick ? '27900' : '1200',
    itemizedFees: [
      {
        id: 'fee-1',
        label: isMaverick ? 'Dealer documentation fee' : 'Handling & delivery fee',
        status: 'fixed',
        amount: isMaverick ? '395' : '75',
        note: '',
      },
    ],
    taxAndRegistrationNote: isMaverick
      ? 'Excludes Oregon privilege tax, title, and DMV registration.'
      : 'Excludes applicable local sales/use tax, title, and registration.',
    paymentTerms: isVehicleMotor
      ? 'Direct buyer-to-dealer wire, certified funds, or buyer-arranged financing after unlock.'
      : 'Direct buyer-to-seller payment upon unlock.',
    includedItemsText: isMaverick
      ? 'Factory 2026 Ford Maverick XLT Hybrid AWD\nStandard XLT Equipment Group\nPre-delivery inspection'
      : '',
    excludedItemsText: isMaverick
      ? 'State privilege/sales tax, title & DMV registration\nOptional dealer add-ons or extended service plans'
      : packet.vehicleSpecs?.vehicleType === 'semi_tractor'
        ? 'Semi-trailer (tractor unit only)\nFederal Excise Tax (FET), IRP/IFTA registration & state taxes'
        : '',
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
    ...extractVehicleFormDefaults(packet.vehicleSpecs),
  };
}

function buildQuotedVehicleFromForm(
  form: QuoteFormState,
  packet: SellerPacketResponse
): VehicleSpecProfile | undefined {
  if (packet.category !== 'Vehicles' || packet.vehicleSpecs?.assetClass === 'accessory') {
    return undefined;
  }
  const qv: VehicleSpecProfile = { assetClass: 'vehicle' };
  if (form.qVehType) qv.vehicleType = form.qVehType;
  if (form.qVehCondition) qv.condition = form.qVehCondition;
  if (form.qVehMake.trim()) qv.make = form.qVehMake.trim();
  if (form.qVehModel.trim()) qv.model = form.qVehModel.trim();
  if (form.qVehYear.trim() && Number.isFinite(Number(form.qVehYear.trim()))) {
    qv.year = Math.round(Number(form.qVehYear.trim()));
  }
  if (form.qVehTrim.trim()) qv.trim = form.qVehTrim.trim();
  if (form.qVehPowertrain.trim()) qv.powertrain = form.qVehPowertrain.trim();
  if (form.qVehDrivetrain.trim()) qv.drivetrain = form.qVehDrivetrain.trim();
  if (form.qVehTransmission.trim()) qv.transmission = form.qVehTransmission.trim();
  if (form.qVehBodyConfig.trim()) qv.bodyConfiguration = form.qVehBodyConfig.trim();
  if (form.qVehAxleConfig.trim()) qv.axleConfiguration = form.qVehAxleConfig.trim();
  if (form.qVehCabOrSleeper.trim()) qv.cabOrSleeper = form.qVehCabOrSleeper.trim();
  if (form.qVehTrailerInclusion) qv.trailerInclusion = form.qVehTrailerInclusion;
  if (form.qVehBusType.trim()) qv.busType = form.qVehBusType.trim();
  if (form.qVehSeatingCapacity.trim() && Number.isFinite(Number(form.qVehSeatingCapacity.trim()))) {
    qv.seatingCapacity = Math.round(Number(form.qVehSeatingCapacity.trim()));
  }
  if (form.qVehAccessibility.trim()) qv.accessibilityRequirement = form.qVehAccessibility.trim();
  if (form.qVehMileageValue.trim() && Number.isFinite(Number(form.qVehMileageValue.trim()))) {
    qv.mileage = { value: Number(form.qVehMileageValue.trim()), unit: form.qVehMileageUnit };
  }
  // Carry forward any numeric weight specs from existing offer if unmodified
  if (packet.currentOffer?.quotedVehicle) {
    const prev = packet.currentOffer.quotedVehicle;
    if (prev.gvwr) qv.gvwr = prev.gvwr;
    if (prev.gcwr) qv.gcwr = prev.gcwr;
    if (prev.payloadCapacity) qv.payloadCapacity = prev.payloadCapacity;
    if (prev.towingCapacity) qv.towingCapacity = prev.towingCapacity;
  }
  return qv;
}

function buildQuoteFeeItemsFromDraft(rows: FeeDraftRow[]): QuoteFeeItem[] {
  const out: QuoteFeeItem[] = [];
  for (const r of rows) {
    const label = r.label.trim();
    if (!label) continue;
    if (r.status === 'unknown') {
      out.push({
        id: r.id,
        label,
        status: 'unknown',
        note: r.note.trim() || undefined,
      });
    } else {
      const amt = Number(r.amount);
      out.push({
        id: r.id,
        label,
        status: 'fixed',
        amount: Number.isFinite(amt) && amt >= 0 ? amt : 0,
        note: r.note.trim() || undefined,
      });
    }
  }
  return out;
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
  const feeItems = buildQuoteFeeItemsFromDraft(form.itemizedFees);
  const feeSummary = normalizeQuoteItemizedFees(feeItems, 0, 'Known fees');
  const calcSubtotal =
    (Number.isFinite(unitPriceNum) ? unitPriceNum : 0) + feeSummary.knownFeesTotal;
  const isRevising = packet.currentOffer !== undefined;
  const isLocked =
    packet.metrics.effectiveStage === 'unlocked' || packet.metrics.effectiveStage === 'closed';
  const isMotorVehiclePool =
    packet.category === 'Vehicles' && packet.vehicleSpecs?.assetClass !== 'accessory';

  const includedItems = form.includedItemsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const excludedItems = form.excludedItemsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const quotedVehicle = buildQuotedVehicleFromForm(form, packet);

  const previewOffer: SellerOffer = {
    version: isRevising ? packet.currentOffer!.version + 1 : 1,
    sellerName: form.sellerName || 'Seller name',
    sellerLocation: form.sellerLocation || packet.location,
    matchingScope: form.matchingScope || packet.title,
    currency: 'USD',
    unitPrice: Number.isFinite(unitPriceNum) ? unitPriceNum : 0,
    knownFees: feeSummary.knownFeesTotal,
    knownFeesUnknown: feeSummary.hasUnknownFees,
    feeLabel: feeSummary.feeLabel,
    itemizedFees: feeSummary.itemizedFees,
    subtotal: calcSubtotal,
    taxAndRegistrationNote: form.taxAndRegistrationNote,
    taxTreatment: form.taxAndRegistrationNote,
    paymentTerms: form.paymentTerms.trim() || undefined,
    includedItems: includedItems.length > 0 ? includedItems : undefined,
    excludedItems: excludedItems.length > 0 ? excludedItems : undefined,
    quotedVehicle,
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

  const updateFeeRow = (id: string, patch: Partial<FeeDraftRow>) => {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        itemizedFees: prev.itemizedFees.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      };
    });
  };

  const addFeeRow = () => {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        itemizedFees: [
          ...prev.itemizedFees,
          {
            id: `fee-${Date.now().toString(36)}`,
            label: '',
            status: 'fixed',
            amount: '0',
            note: '',
          },
        ],
      };
    });
  };

  const removeFeeRow = (id: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        itemizedFees: prev.itemizedFees.filter((row) => row.id !== id),
      };
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
        knownFees: feeSummary.knownFeesTotal,
        knownFeesUnknown: feeSummary.hasUnknownFees,
        feeLabel: feeSummary.feeLabel,
        itemizedFees: feeSummary.itemizedFees,
        taxAndRegistrationNote: form.taxAndRegistrationNote,
        taxTreatment: form.taxAndRegistrationNote,
        paymentTerms: form.paymentTerms.trim() || undefined,
        includedItems: includedItems.length > 0 ? includedItems : undefined,
        excludedItems: excludedItems.length > 0 ? excludedItems : undefined,
        quotedVehicle,
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
          : `Offer v${res.offer.version} published (${formatCurrency(res.offer.subtotal)}${
              res.offer.knownFeesUnknown ? ' + TBD fees' : ' subtotal'
            }). Buyers can now review and confirm.`
      );
      const updated = await fetchSellerPacket(token);
      setPacket(updated);
      setForm(buildInitialForm(updated));
    } catch (err) {
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
                Seller / dealer name *
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
                Dealer location
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

          {/* Quoted Vehicle & Configuration Section (only for motor-vehicle pools) */}
          {isMotorVehiclePool && (
            <div className="p-4 bg-[#FBF9F4] border border-[#C6D8CE] space-y-3">
              <div>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
                  Vehicle &amp; configuration actually quoted
                </p>
                <p className="text-[11px] text-[#516B61]">
                  Confirm exact build quoted. Any conflict with the pool&apos;s required specs will
                  be flagged prominently to buyers.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label htmlFor="sq-type" className="block font-mono text-[10px] uppercase text-[#516B61]">
                    Vehicle type
                  </label>
                  <select
                    id="sq-type"
                    value={form.qVehType}
                    onChange={(e) => updateField('qVehType', e.target.value as VehicleSubType | '')}
                    disabled={isLocked}
                    className="mt-1 w-full h-9 px-2 bg-white border border-[#C6D8CE] text-xs"
                  >
                    <option value="">Not specified</option>
                    {VEHICLE_TYPE_LIST.map((vt) => (
                      <option key={vt.id} value={vt.id}>
                        {vt.shortLabel}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sq-cond" className="block font-mono text-[10px] uppercase text-[#516B61]">
                    Condition
                  </label>
                  <select
                    id="sq-cond"
                    value={form.qVehCondition}
                    onChange={(e) =>
                      updateField('qVehCondition', e.target.value as VehicleCondition | '')
                    }
                    disabled={isLocked}
                    className="mt-1 w-full h-9 px-2 bg-white border border-[#C6D8CE] text-xs"
                  >
                    <option value="">Not specified</option>
                    <option value="new">New</option>
                    <option value="used">Used</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="sq-year" className="block font-mono text-[10px] uppercase text-[#516B61]">
                    Model year
                  </label>
                  <input
                    id="sq-year"
                    type="number"
                    min={1980}
                    max={2035}
                    value={form.qVehYear}
                    onChange={(e) => updateField('qVehYear', e.target.value)}
                    disabled={isLocked}
                    className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label htmlFor="sq-make" className="block font-mono text-[10px] uppercase text-[#516B61]">
                    Make
                  </label>
                  <input
                    id="sq-make"
                    value={form.qVehMake}
                    onChange={(e) => updateField('qVehMake', e.target.value)}
                    disabled={isLocked}
                    className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="sq-model" className="block font-mono text-[10px] uppercase text-[#516B61]">
                    Model
                  </label>
                  <input
                    id="sq-model"
                    value={form.qVehModel}
                    onChange={(e) => updateField('qVehModel', e.target.value)}
                    disabled={isLocked}
                    className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="sq-trim" className="block font-mono text-[10px] uppercase text-[#516B61]">
                    Trim / config
                  </label>
                  <input
                    id="sq-trim"
                    value={form.qVehTrim}
                    onChange={(e) => updateField('qVehTrim', e.target.value)}
                    disabled={isLocked}
                    className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label htmlFor="sq-pt" className="block font-mono text-[10px] uppercase text-[#516B61]">
                    Powertrain
                  </label>
                  <input
                    id="sq-pt"
                    value={form.qVehPowertrain}
                    onChange={(e) => updateField('qVehPowertrain', e.target.value)}
                    disabled={isLocked}
                    className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="sq-dt" className="block font-mono text-[10px] uppercase text-[#516B61]">
                    Drivetrain
                  </label>
                  <input
                    id="sq-dt"
                    value={form.qVehDrivetrain}
                    onChange={(e) => updateField('qVehDrivetrain', e.target.value)}
                    disabled={isLocked}
                    className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="sq-axle" className="block font-mono text-[10px] uppercase text-[#516B61]">
                    Axle (commercial)
                  </label>
                  <input
                    id="sq-axle"
                    value={form.qVehAxleConfig}
                    onChange={(e) => updateField('qVehAxleConfig', e.target.value)}
                    placeholder="e.g., 6x4 or 4x2"
                    disabled={isLocked}
                    className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] text-xs"
                  />
                </div>
              </div>

              {(form.qVehType === 'semi_tractor' || form.qVehType === 'commercial_van_truck') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="sq-cab" className="block font-mono text-[10px] uppercase text-[#516B61]">
                      Cab / sleeper or body
                    </label>
                    <input
                      id="sq-cab"
                      value={form.qVehCabOrSleeper || form.qVehBodyConfig}
                      onChange={(e) =>
                        form.qVehType === 'semi_tractor'
                          ? updateField('qVehCabOrSleeper', e.target.value)
                          : updateField('qVehBodyConfig', e.target.value)
                      }
                      disabled={isLocked}
                      className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] text-xs"
                    />
                  </div>
                  {form.qVehType === 'semi_tractor' && (
                    <div>
                      <label htmlFor="sq-trailer" className="block font-mono text-[10px] uppercase text-[#516B61]">
                        Trailer inclusion
                      </label>
                      <select
                        id="sq-trailer"
                        value={form.qVehTrailerInclusion}
                        onChange={(e) =>
                          updateField('qVehTrailerInclusion', e.target.value as TrailerInclusion | '')
                        }
                        disabled={isLocked}
                        className="mt-1 w-full h-9 px-2 bg-white border border-[#C6D8CE] text-xs"
                      >
                        <option value="">Not specified (assumed excluded)</option>
                        <option value="tractor_only">Tractor unit only (no trailer)</option>
                        <option value="includes_trailer">Explicitly includes trailer</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              {form.qVehType === 'bus' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label htmlFor="sq-bustype" className="block font-mono text-[10px] uppercase text-[#516B61]">
                      Bus type
                    </label>
                    <input
                      id="sq-bustype"
                      value={form.qVehBusType}
                      onChange={(e) => updateField('qVehBusType', e.target.value)}
                      disabled={isLocked}
                      className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="sq-seats" className="block font-mono text-[10px] uppercase text-[#516B61]">
                      Seating capacity
                    </label>
                    <input
                      id="sq-seats"
                      type="number"
                      min={1}
                      value={form.qVehSeatingCapacity}
                      onChange={(e) => updateField('qVehSeatingCapacity', e.target.value)}
                      disabled={isLocked}
                      className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="sq-ada" className="block font-mono text-[10px] uppercase text-[#516B61]">
                      Accessibility / ADA
                    </label>
                    <input
                      id="sq-ada"
                      value={form.qVehAccessibility}
                      onChange={(e) => updateField('qVehAccessibility', e.target.value)}
                      disabled={isLocked}
                      className="mt-1 w-full h-9 px-2.5 bg-white border border-[#C6D8CE] text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label htmlFor="s-scope" className="block font-mono text-[11px] uppercase text-[#152B23]">
              Matching specification &amp; scope *
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

          {/* Pricing & Itemized Fees (Distinguishing Fixed, $0, and Unknown/TBD) */}
          <div className="p-4 bg-[#F6F1E5]/70 border border-[#C6D8CE] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="s-price" className="block font-mono text-[11px] uppercase text-[#152B23]">
                  Per-{packet.unitSingular} price (USD) *
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

              <div className="flex flex-col justify-end">
                <div className="h-10 px-3 bg-[#152B23] text-white flex items-center justify-between font-mono text-xs">
                  <span>{feeSummary.hasUnknownFees ? 'Base + fixed subtotal' : 'Calculated subtotal'}</span>
                  <strong className="text-[#FFBF32] tabular-nums">
                    {formatCurrency(calcSubtotal)}
                    {feeSummary.hasUnknownFees ? ' + TBD' : ''}
                  </strong>
                </div>
              </div>
            </div>

            {/* Itemized Fees Editor */}
            <div className="space-y-2 pt-1 border-t border-[#C6D8CE]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase text-[#152B23]">
                  Itemized fees (distinguish $0 from Unknown / TBD)
                </span>
                {!isLocked && (
                  <button
                    type="button"
                    onClick={addFeeRow}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-[#152B23] font-mono text-[10px] uppercase cursor-pointer hover:bg-[#EAF7EF]"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" />
                    <span>Add fee line</span>
                  </button>
                )}
              </div>

              {form.itemizedFees.map((row) => (
                <div
                  key={row.id}
                  className="p-2.5 bg-white border border-[#C6D8CE] grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                >
                  <input
                    aria-label="Fee label"
                    value={row.label}
                    onChange={(e) => updateFeeRow(row.id, { label: e.target.value })}
                    placeholder="e.g., Documentation fee or Upfit delivery"
                    disabled={isLocked}
                    className="sm:col-span-5 h-9 px-2.5 border border-[#C6D8CE] text-xs"
                  />
                  <select
                    aria-label="Fee status"
                    value={row.status}
                    onChange={(e) =>
                      updateFeeRow(row.id, {
                        status: e.target.value as 'fixed' | 'unknown',
                        amount: e.target.value === 'unknown' ? '' : row.amount || '0',
                      })
                    }
                    disabled={isLocked}
                    className="sm:col-span-3 h-9 px-2 border border-[#C6D8CE] text-xs"
                  >
                    <option value="fixed">Fixed USD</option>
                    <option value="unknown">Unknown / TBD</option>
                  </select>
                  <div className="sm:col-span-3">
                    {row.status === 'fixed' ? (
                      <input
                        aria-label="Fee amount USD"
                        type="number"
                        min={0}
                        step="1"
                        value={row.amount}
                        onChange={(e) => updateFeeRow(row.id, { amount: e.target.value })}
                        disabled={isLocked}
                        className="w-full h-9 px-2 border border-[#C6D8CE] font-mono text-xs"
                      />
                    ) : (
                      <span className="block px-2 py-1.5 bg-[#FFF8E6] border border-[#E6C57A] font-mono text-[10px] text-[#8A5406] text-center uppercase">
                        TBD
                      </span>
                    )}
                  </div>
                  <div className="sm:col-span-1 flex justify-end">
                    {!isLocked && form.itemizedFees.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeFeeRow(row.id)}
                        aria-label="Remove fee row"
                        className="p-1.5 text-[#516B61] hover:text-[#A63A2B] cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label htmlFor="s-tax" className="block font-mono text-[11px] uppercase text-[#152B23]">
                Stated tax &amp; registration treatment
              </label>
              <input
                id="s-tax"
                value={form.taxAndRegistrationNote}
                onChange={(e) => updateField('taxAndRegistrationNote', e.target.value)}
                disabled={isLocked}
                className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
              />
            </div>

            <div>
              <label htmlFor="s-pay" className="block font-mono text-[11px] uppercase text-[#152B23]">
                Payment terms
              </label>
              <input
                id="s-pay"
                value={form.paymentTerms}
                onChange={(e) => updateField('paymentTerms', e.target.value)}
                placeholder="e.g., Direct buyer wire or certified funds at delivery"
                disabled={isLocked}
                className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
              />
            </div>
          </div>

          {/* Included vs Excluded Items */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="s-inc" className="block font-mono text-[11px] uppercase text-[#152B23]">
                What is included (one per line)
              </label>
              <textarea
                id="s-inc"
                rows={3}
                value={form.includedItemsText}
                onChange={(e) => updateField('includedItemsText', e.target.value)}
                placeholder={'Standard factory equipment\nPre-delivery inspection'}
                disabled={isLocked}
                className="mt-1 w-full p-2.5 bg-[#EAF7EF]/40 border border-[#C6D8CE] text-xs"
              />
            </div>
            <div>
              <label htmlFor="s-exc" className="block font-mono text-[11px] uppercase text-[#A63A2B]">
                Not included / excluded (one per line)
              </label>
              <textarea
                id="s-exc"
                rows={3}
                value={form.excludedItemsText}
                onChange={(e) => updateField('excludedItemsText', e.target.value)}
                placeholder={'Delivery transport / upfit\nSemi-trailer (if tractor only)\nTax, title & registration'}
                disabled={isLocked}
                className="mt-1 w-full p-2.5 bg-[#FDF4F2]/40 border border-[#E6C4BE] text-xs"
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
                Offer expires (Pacific time) *
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
                placeholder="e.g., Adjusted vehicle price or updated axle configuration"
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
            pool={{
              category: packet.category,
              title: packet.title,
              vehicleSpecs: packet.vehicleSpecs,
              sharedRequirements: packet.sharedRequirements,
            }}
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
                      {formatCurrency(old.subtotal)}
                      {old.knownFeesUnknown ? ' + TBD' : ' subtotal'}
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
