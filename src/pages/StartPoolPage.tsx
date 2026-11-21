import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy } from 'lucide-react';
import { POOL_CATEGORIES, type PoolCategory, type PoolSpecField } from '../domain/types.ts';
import { ApiRequestError, useTally } from '../lib/api.ts';
import { formatCalendarDate } from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import { SegmentedTally } from '../components/SegmentedTally.tsx';

interface DraftState {
  category: PoolCategory;
  title: string;
  subtitle: string;
  location: string;
  deliveryOrDestination: string;
  minQuantity: number;
  maxQuantity: number;
  goalDate: string;
  organizerNote: string;
  requirementsText: string;
  // Category-specific typed fields
  vehModel: string;
  vehTrim: string;
  aptMoveIn: string;
  aptUnitSize: string;
  furnSku: string;
  furnDelivery: string;
  collEdition: string;
  collCondition: string;
  hotelDest: string;
  hotelCheckIn: string;
  hotelCheckOut: string;
  hotelRoomType: string;
  otherUnitSingular: string;
  otherUnitPlural: string;
}

const DEFAULT_UNITS: Record<PoolCategory, { singular: string; plural: string }> = {
  Vehicles: { singular: 'vehicle', plural: 'vehicles' },
  Apartments: { singular: 'household', plural: 'households' },
  Furniture: { singular: 'furniture unit', plural: 'furniture units' },
  Collectibles: { singular: 'copy', plural: 'copies' },
  Hotels: { singular: 'room', plural: 'rooms' },
  Other: { singular: 'unit', plural: 'units' },
};

const INITIAL_DRAFT: DraftState = {
  category: 'Furniture',
  title: '',
  subtitle: '',
  location: 'Portland metro',
  deliveryOrDestination: 'Portland metro local delivery',
  minQuantity: 6,
  maxQuantity: 10,
  goalDate: '2026-12-28',
  organizerNote: '',
  requirementsText: '',
  vehModel: '2026 Toyota RAV4 Hybrid',
  vehTrim: 'XLE AWD',
  aptMoveIn: '2027-02-01',
  aptUnitSize: '1 Bedroom',
  furnSku: 'SKU-OAK-84',
  furnDelivery: 'Portland metro local delivery',
  collEdition: 'First Pressing 180g LP',
  collCondition: 'Sealed Mint (M)',
  hotelDest: 'Bend, OR',
  hotelCheckIn: '2027-01-22',
  hotelCheckOut: '2027-01-24',
  hotelRoomType: 'King or Double Queen',
  otherUnitSingular: 'home',
  otherUnitPlural: 'homes',
};

export function StartPoolPage() {
  const { sessionId, busy, createPoolAction, showBanner } = useTally();
  const storageKey = `tally_start_draft_${sessionId}`;

  const [draft, setDraft] = useState<DraftState>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) return { ...INITIAL_DRAFT, ...(JSON.parse(saved) as Partial<DraftState>) };
    } catch {
      // Ignore parse errors
    }
    return INITIAL_DRAFT;
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [publishedPoolId, setPublishedPoolId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Preserve draft automatically per session
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      // Ignore storage quota errors
    }
  }, [draft, storageKey]);

  const unitSingular =
    draft.category === 'Other'
      ? draft.otherUnitSingular.trim() || 'unit'
      : DEFAULT_UNITS[draft.category].singular;
  const unitPlural =
    draft.category === 'Other'
      ? draft.otherUnitPlural.trim() || 'units'
      : DEFAULT_UNITS[draft.category].plural;

  const updateField = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const buildCategorySpecs = (): {
    specs: PoolSpecField[];
    primaryLabel: string;
    primaryValues: string[];
  } => {
    switch (draft.category) {
      case 'Vehicles':
        return {
          specs: [
            { label: 'Model', value: draft.vehModel },
            { label: 'Trim', value: draft.vehTrim },
            { label: 'Pickup', value: draft.deliveryOrDestination },
          ],
          primaryLabel: 'Model & trim',
          primaryValues: [`${draft.vehModel} ${draft.vehTrim}`.trim()],
        };
      case 'Apartments':
        return {
          specs: [
            {
              label: 'Move-in target',
              value: draft.aptMoveIn
                ? formatCalendarDate(draft.aptMoveIn, { includeYear: true })
                : 'TBD',
            },
            { label: 'Unit size', value: draft.aptUnitSize },
            { label: 'Area', value: draft.location },
          ],
          primaryLabel: 'Unit size',
          primaryValues: [draft.aptUnitSize],
        };
      case 'Furniture':
        return {
          specs: [
            { label: 'SKU / Model', value: draft.furnSku },
            { label: 'Delivery', value: draft.furnDelivery || draft.deliveryOrDestination },
            { label: 'Unit', value: `${unitSingular} / ${unitPlural}` },
          ],
          primaryLabel: 'Item SKU',
          primaryValues: [draft.furnSku],
        };
      case 'Collectibles':
        return {
          specs: [
            { label: 'Edition', value: draft.collEdition },
            { label: 'Condition', value: draft.collCondition },
            { label: 'Shipping', value: draft.deliveryOrDestination },
          ],
          primaryLabel: 'Edition & condition',
          primaryValues: [`${draft.collEdition} (${draft.collCondition})`],
        };
      case 'Hotels':
        return {
          specs: [
            { label: 'Destination', value: draft.hotelDest },
            {
              label: 'Check-in / Check-out',
              value:
                draft.hotelCheckIn && draft.hotelCheckOut
                  ? `${formatCalendarDate(draft.hotelCheckIn)} – ${formatCalendarDate(draft.hotelCheckOut, { includeYear: true })}`
                  : `${draft.hotelCheckIn} to ${draft.hotelCheckOut}`,
            },
            { label: 'Room type', value: draft.hotelRoomType },
          ],
          primaryLabel: 'Room type',
          primaryValues: [draft.hotelRoomType],
        };
      case 'Other':
      default:
        return {
          specs: [
            { label: 'Unit counted', value: `${unitSingular} / ${unitPlural}` },
            { label: 'Fulfillment', value: draft.deliveryOrDestination },
          ],
          primaryLabel: 'Shared specification',
          primaryValues: ['Matches group specification'],
        };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const errs: Record<string, string> = {};

    if (draft.title.trim().length < 4) {
      errs.title = 'Enter a descriptive pool title (at least 4 characters).';
    }
    if (draft.location.trim().length < 2) {
      errs.location = 'Enter a location or shipping region.';
    }
    if (!Number.isInteger(draft.minQuantity) || draft.minQuantity < 2) {
      errs.minQuantity = 'Minimum quantity must be at least 2.';
    }
    if (draft.maxQuantity < draft.minQuantity) {
      errs.maxQuantity = 'Maximum cap must be at least the minimum quantity.';
    }
    if (!draft.goalDate) {
      errs.goalDate = 'Select a target goal date.';
    }
    const reqs = draft.requirementsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (reqs.length === 0) {
      errs.requirementsText = 'Add at least one shared requirement (one per line).';
    }
    if (draft.category === 'Hotels' && draft.hotelCheckIn && draft.hotelCheckOut && draft.hotelCheckOut <= draft.hotelCheckIn) {
      errs.hotelCheckOut = 'Check-out date must be after check-in date.';
    }
    if (draft.category === 'Other' && (!draft.otherUnitSingular.trim() || !draft.otherUnitPlural.trim())) {
      errs.otherUnitSingular = 'Enter both singular and plural unit labels.';
    }

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setSubmitError('Fix the highlighted fields before publishing.');
      return;
    }

    const { specs, primaryLabel, primaryValues } = buildCategorySpecs();

    try {
      const poolId = await createPoolAction({
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim() || undefined,
        category: draft.category,
        location: draft.location.trim(),
        deliveryOrDestination:
          draft.category === 'Hotels'
            ? draft.hotelDest.trim()
            : draft.category === 'Furniture'
              ? draft.furnDelivery.trim()
              : draft.deliveryOrDestination.trim() || draft.location.trim(),
        unitSingular,
        unitPlural,
        minQuantity: draft.minQuantity,
        maxQuantity: draft.maxQuantity,
        goalDate: draft.goalDate,
        organizerNote: draft.organizerNote.trim(),
        sharedRequirements: reqs,
        categorySpecs: specs,
        primaryOptionLabel: primaryLabel,
        primaryOptionValues: primaryValues,
      });
      window.localStorage.removeItem(storageKey);
      setPublishedPoolId(poolId);
      showBanner('success', 'Your new buying pool is live on Explore and My pools.');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setSubmitError(err.error.message);
        if (err.error.fieldErrors) setFieldErrors(err.error.fieldErrors);
      } else {
        setSubmitError('Unable to publish pool.');
      }
    }
  };

  if (publishedPoolId) {
    const shareUrl = `${window.location.origin}/pools/${publishedPoolId}?session=${encodeURIComponent(
      sessionId
    )}`;

    const handleCopy = () => {
      navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    };

    return (
      <div className="max-w-2xl mx-auto bg-white border-2 border-[#152B23] shadow-[4px_4px_0px_#152B23] p-6 sm:p-8 space-y-5">
        <span className="inline-block px-2.5 py-1 bg-[#152B23] text-[#FFBF32] font-mono text-[11px] font-semibold uppercase tracking-wider">
          Pool published
        </span>
        <h1 className="font-display text-2xl sm:text-3xl text-[#152B23] uppercase">
          {draft.title}
        </h1>
        <p className="text-sm text-[#516B61]">
          Your pool is now listed on Explore and My pools with 1 of {draft.minQuantity}{' '}
          {unitPlural} counted. Share the link below inside this preview session to gather
          compatible buyers.
        </p>

        <div className="p-4 bg-[#F6F1E5] border border-[#C6D8CE] space-y-2">
          <label
            htmlFor="published-pool-link"
            className="block font-mono text-[11px] font-semibold uppercase text-[#516B61]"
          >
            Copyable pool link
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="published-pool-link"
              readOnly
              value={shareUrl}
              className="flex-1 h-10 px-3 bg-white border border-[#152B23]/30 font-mono text-xs text-[#152B23]"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center gap-1.5 px-4 h-10 bg-[#152B23] text-white font-mono text-xs uppercase cursor-pointer"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? 'Copied' : 'Copy link'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            to={`/pools/${publishedPoolId}`}
            className="inline-flex items-center gap-2 px-5 py-3 bg-[#FFBF32] hover:bg-[#F2B01E] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]"
          >
            <span>Open new pool</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <Link
            to={`/pools/${publishedPoolId}/organize`}
            className="inline-flex items-center px-4 py-3 bg-[#152B23] text-white hover:bg-[#28463B] font-mono text-xs font-semibold uppercase tracking-wider"
          >
            Manage pool
          </Link>
          <Link
            to="/"
            className="inline-flex items-center px-4 py-3 bg-white border border-[#C6D8CE] hover:border-[#152B23] font-mono text-xs uppercase text-[#152B23]"
          >
            View on Explore
          </Link>
          <Link
            to="/my-pools"
            className="inline-flex items-center px-4 py-3 bg-white border border-[#C6D8CE] hover:border-[#152B23] font-mono text-xs uppercase text-[#152B23]"
          >
            Open My pools
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#C6D8CE]">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-[#152B23] underline underline-offset-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to Explore</span>
        </Link>
        <span className="font-mono text-[11px] text-[#516B61]">Draft auto-saved locally</span>
      </div>

      <div>
        <h1 className="font-display text-2xl sm:text-4xl text-[#152B23] uppercase">
          Start a buying pool
        </h1>
        <p className="mt-1 text-sm text-[#516B61]">
          Define shared requirements tightly so one seller can quote a single clean group price.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form Left 7 cols */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="lg:col-span-7 bg-white border border-[#C6D8CE] p-5 sm:p-6 space-y-5"
        >
          {/* Category Picker */}
          <fieldset className="space-y-2">
            <legend className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
              1. Category
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {POOL_CATEGORIES.map((cat) => {
                const active = draft.category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => updateField('category', cat)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 border font-mono text-[11px] uppercase tracking-wider cursor-pointer ${
                      active
                        ? 'bg-[#152B23] text-white border-[#152B23]'
                        : 'bg-[#EAF7EF]/60 text-[#152B23] border-[#C6D8CE] hover:border-[#152B23]'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Basic Info */}
          <div className="space-y-3 pt-2 border-t border-[#C6D8CE]">
            <div>
              <label
                htmlFor="pool-title"
                className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
              >
                Pool title *
              </label>
              <input
                id="pool-title"
                type="text"
                value={draft.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder={
                  draft.category === 'Vehicles'
                    ? 'e.g., 2026 Toyota RAV4 Hybrid XLE AWD'
                    : draft.category === 'Furniture'
                      ? 'e.g., Solid White Oak 84" Dining Bench Set'
                      : 'e.g., Neighborhood group buy title'
                }
                className="mt-1 w-full h-11 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm"
              />
              {fieldErrors.title && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.title}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="pool-location"
                  className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
                >
                  Location / metro *
                </label>
                <input
                  id="pool-location"
                  type="text"
                  value={draft.location}
                  onChange={(e) => updateField('location', e.target.value)}
                  className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm"
                />
                {fieldErrors.location && (
                  <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.location}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="pool-delivery"
                  className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
                >
                  Pickup, shipping, or destination
                </label>
                <input
                  id="pool-delivery"
                  type="text"
                  value={draft.deliveryOrDestination}
                  onChange={(e) => updateField('deliveryOrDestination', e.target.value)}
                  className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm"
                />
              </div>
            </div>
          </div>

          {/* Category-Aware Typed Fields */}
          <div className="p-4 bg-[#F6F1E5]/70 border border-[#C6D8CE] space-y-3">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
              2. {draft.category} specifications
            </p>

            {draft.category === 'Vehicles' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="veh-model" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Model & year
                  </label>
                  <input
                    id="veh-model"
                    value={draft.vehModel}
                    onChange={(e) => updateField('vehModel', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="veh-trim" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Trim & drivetrain
                  </label>
                  <input
                    id="veh-trim"
                    value={draft.vehTrim}
                    onChange={(e) => updateField('vehTrim', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
              </div>
            )}

            {draft.category === 'Apartments' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="apt-movein" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Target move-in date
                  </label>
                  <input
                    id="apt-movein"
                    type="date"
                    value={draft.aptMoveIn}
                    onChange={(e) => updateField('aptMoveIn', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="apt-size" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Unit size
                  </label>
                  <select
                    id="apt-size"
                    value={draft.aptUnitSize}
                    onChange={(e) => updateField('aptUnitSize', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  >
                    <option value="Studio">Studio</option>
                    <option value="1 Bedroom">1 Bedroom</option>
                    <option value="2 Bedroom">2 Bedroom</option>
                  </select>
                </div>
              </div>
            )}

            {draft.category === 'Furniture' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="furn-sku" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    SKU / item model
                  </label>
                  <input
                    id="furn-sku"
                    value={draft.furnSku}
                    onChange={(e) => updateField('furnSku', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="furn-deliv" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Delivery zone
                  </label>
                  <input
                    id="furn-deliv"
                    value={draft.furnDelivery}
                    onChange={(e) => updateField('furnDelivery', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
              </div>
            )}

            {draft.category === 'Collectibles' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="coll-ed" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Edition / pressing
                  </label>
                  <input
                    id="coll-ed"
                    value={draft.collEdition}
                    onChange={(e) => updateField('collEdition', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="coll-cond" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Condition grade
                  </label>
                  <input
                    id="coll-cond"
                    value={draft.collCondition}
                    onChange={(e) => updateField('collCondition', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
              </div>
            )}

            {draft.category === 'Hotels' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="hotel-dest" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Destination
                  </label>
                  <input
                    id="hotel-dest"
                    value={draft.hotelDest}
                    onChange={(e) => updateField('hotelDest', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="hotel-room" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Room type
                  </label>
                  <input
                    id="hotel-room"
                    value={draft.hotelRoomType}
                    onChange={(e) => updateField('hotelRoomType', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="hotel-in" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Check-in
                  </label>
                  <input
                    id="hotel-in"
                    type="date"
                    value={draft.hotelCheckIn}
                    onChange={(e) => updateField('hotelCheckIn', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="hotel-out" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Check-out
                  </label>
                  <input
                    id="hotel-out"
                    type="date"
                    value={draft.hotelCheckOut}
                    onChange={(e) => updateField('hotelCheckOut', e.target.value)}
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] font-mono text-sm"
                  />
                  {fieldErrors.hotelCheckOut && (
                    <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.hotelCheckOut}</p>
                  )}
                </div>
              </div>
            )}

            {draft.category === 'Other' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="other-sing" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Custom singular unit *
                  </label>
                  <input
                    id="other-sing"
                    value={draft.otherUnitSingular}
                    onChange={(e) => updateField('otherUnitSingular', e.target.value)}
                    placeholder="e.g., home, cord, kit"
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="other-plur" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Custom plural unit *
                  </label>
                  <input
                    id="other-plur"
                    value={draft.otherUnitPlural}
                    onChange={(e) => updateField('otherUnitPlural', e.target.value)}
                    placeholder="e.g., homes, cords, kits"
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
                {fieldErrors.otherUnitSingular && (
                  <p className="sm:col-span-2 text-xs text-[#A63A2B]">
                    {fieldErrors.otherUnitSingular}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Threshold, Cap, Goal Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#C6D8CE]">
            <div>
              <label
                htmlFor="pool-min"
                className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
              >
                Minimum ({unitPlural}) *
              </label>
              <input
                id="pool-min"
                type="number"
                min={2}
                max={100}
                value={draft.minQuantity}
                onChange={(e) => updateField('minQuantity', Number(e.target.value) || 2)}
                className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] font-mono text-sm"
              />
              {fieldErrors.minQuantity && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.minQuantity}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="pool-max"
                className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
              >
                Maximum cap
              </label>
              <input
                id="pool-max"
                type="number"
                min={2}
                max={150}
                value={draft.maxQuantity}
                onChange={(e) => updateField('maxQuantity', Number(e.target.value) || 2)}
                className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] font-mono text-sm"
              />
              {fieldErrors.maxQuantity && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.maxQuantity}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="pool-goal"
                className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
              >
                Goal date *
              </label>
              <input
                id="pool-goal"
                type="date"
                value={draft.goalDate}
                onChange={(e) => updateField('goalDate', e.target.value)}
                className="mt-1 w-full h-10 px-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] font-mono text-sm"
              />
              {fieldErrors.goalDate && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.goalDate}</p>
              )}
            </div>
          </div>

          {/* Shared Requirements & Organizer Note */}
          <div className="space-y-3 pt-2 border-t border-[#C6D8CE]">
            <div>
              <label
                htmlFor="pool-reqs"
                className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
              >
                Shared requirements (one per line) *
              </label>
              <textarea
                id="pool-reqs"
                rows={3}
                value={draft.requirementsText}
                onChange={(e) => updateField('requirementsText', e.target.value)}
                placeholder={'Standard factory trim with zero add-ons\nLocal Portland pickup before Jan 10'}
                className="mt-1 w-full p-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm"
              />
              {fieldErrors.requirementsText && (
                <p className="mt-1 text-xs text-[#A63A2B]">{fieldErrors.requirementsText}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="pool-note"
                className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
              >
                Organizer note
              </label>
              <textarea
                id="pool-note"
                rows={2}
                value={draft.organizerNote}
                onChange={(e) => updateField('organizerNote', e.target.value)}
                placeholder="Explain why pooling this item unlocks a better group quote…"
                className="mt-1 w-full p-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm"
              />
            </div>
          </div>

          {submitError && (
            <p role="alert" className="p-3 bg-[#FDF0EE] border border-[#A63A2B] text-xs text-[#A63A2B]">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3.5 px-4 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
          >
            {busy ? 'Publishing pool…' : 'Publish pool to directory'}
          </button>
        </form>

        {/* Live Directory Card Preview Right 5 cols */}
        <aside aria-label="Live pool card preview" className="lg:col-span-5 lg:sticky lg:top-20 space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#516B61]">
            Live Explore card preview
          </p>
          <div className="bg-white border-2 border-[#152B23] shadow-[3px_3px_0px_#152B23] p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61]">
                {draft.category}
              </span>
              <span className="px-2 py-0.5 bg-[#EAF7EF] border border-[#C6D8CE] font-mono text-[10px] font-semibold uppercase text-[#152B23]">
                Gathering buyers
              </span>
            </div>

            <div>
              <h2 className="font-display text-xl text-[#152B23] uppercase">
                {draft.title.trim() || 'Your buying pool title'}
              </h2>
              <p className="mt-1 text-xs text-[#516B61]">
                {draft.location || 'Location'} · Target{' '}
                {draft.goalDate ? formatCalendarDate(draft.goalDate) : 'date'}
              </p>
            </div>

            <SegmentedTally
              current={1}
              target={Math.max(2, draft.minQuantity)}
              unitSingular={unitSingular}
              unitPlural={unitPlural}
              verb="interested"
              rightLabel={`${Math.max(1, draft.minQuantity - 1)} more needed`}
            />

            <div className="p-3 bg-[#F6F1E5] border border-[#C6D8CE] text-xs space-y-1">
              <p className="font-mono text-[10px] uppercase text-[#516B61]">Unit counted</p>
              <p className="font-semibold text-[#152B23]">
                1 {unitSingular} / {draft.minQuantity} {unitPlural} minimum (cap {draft.maxQuantity})
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
