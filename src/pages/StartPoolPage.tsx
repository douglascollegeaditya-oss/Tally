import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Copy, Search } from 'lucide-react';
import {
  buildDraftFromSearchPrefill,
  INITIAL_START_POOL_DRAFT,
  resolveInitialStartPoolDraft,
  type ResolvedStartPoolDraft,
  type StartPoolDraftState,
} from '../domain/startPoolDraft.ts';
import {
  POOL_CATEGORIES,
  type PoolCategory,
  type PoolSpecField,
  type SimilarPoolCandidate,
  type SimilarPoolQueryInput,
  type SimilarPoolReference,
} from '../domain/types.ts';
import { ApiRequestError, useTally } from '../lib/api.ts';
import { formatCalendarDate } from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import {
  CompetingPoolsComparison,
  type ComparisonQuerySummary,
} from '../components/CompetingPoolsComparison.tsx';
import { SegmentedTally } from '../components/SegmentedTally.tsx';

const DEFAULT_UNITS: Record<PoolCategory, { singular: string; plural: string }> = {
  Vehicles: { singular: 'vehicle', plural: 'vehicles' },
  Apartments: { singular: 'household', plural: 'households' },
  Furniture: { singular: 'furniture unit', plural: 'furniture units' },
  Collectibles: { singular: 'copy', plural: 'copies' },
  Hotels: { singular: 'room', plural: 'rooms' },
  Other: { singular: 'unit', plural: 'units' },
};

function readSavedDraft(storageKey: string): Partial<StartPoolDraftState> | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<StartPoolDraftState>;
  } catch {
    return null;
  }
}

export function StartPoolPage() {
  const { sessionId, busy, createPoolAction, findSimilarPoolsAction, showBanner } = useTally();
  const { searchParams } = useRouter();
  const storageKey = `tally_start_draft_${sessionId}`;

  const qParam = searchParams.get('q');
  const catParam = searchParams.get('cat');
  const locParam = searchParams.get('loc');

  const [initialResolution] = useState<ResolvedStartPoolDraft>(() =>
    resolveInitialStartPoolDraft(readSavedDraft(storageKey), {
      q: qParam,
      cat: catParam,
      loc: locParam,
    })
  );

  const [draft, setDraft] = useState<StartPoolDraftState>(initialResolution.draft);
  const [prefilledWithoutCategory, setPrefilledWithoutCategory] = useState<boolean>(
    initialResolution.prefilledWithoutCategory
  );
  const [pendingSearchPrefill, setPendingSearchPrefill] = useState<
    ResolvedStartPoolDraft['pendingSearchPrefill']
  >(initialResolution.pendingSearchPrefill);

  const [step, setStep] = useState<'form' | 'compare'>('form');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [publishedPoolId, setPublishedPoolId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Step 2: competing pool check state
  const [similarCandidates, setSimilarCandidates] = useState<SimilarPoolCandidate[]>([]);
  const [similarReferencePools, setSimilarReferencePools] = useState<SimilarPoolReference[]>([]);
  const [checkingSimilar, setCheckingSimilar] = useState(false);
  const [similarError, setSimilarError] = useState<string | null>(null);
  const [checkedPoolCount, setCheckedPoolCount] = useState<number>(0);
  const [joinedExistingPool, setJoinedExistingPool] = useState<{ id: string; title: string } | null>(
    null
  );

  const submitAttemptIdRef = useRef<string>(`req-${Math.random().toString(36).slice(2, 10)}`);
  const compareHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const didInitRef = useRef(false);

  // Re-resolve when session or URL prefill params change after initial mount
  useEffect(() => {
    if (!didInitRef.current) {
      didInitRef.current = true;
      return;
    }
    const resolved = resolveInitialStartPoolDraft(readSavedDraft(storageKey), {
      q: qParam,
      cat: catParam,
      loc: locParam,
    });
    setDraft(resolved.draft);
    setPrefilledWithoutCategory(resolved.prefilledWithoutCategory);
    setPendingSearchPrefill(resolved.pendingSearchPrefill);
    setFieldErrors({});
    setSubmitError(null);
    setStep('form');
  }, [storageKey, qParam, catParam, locParam]);

  // Persist draft only once the user has deliberately edited a field
  useEffect(() => {
    if (!draft.userEdited) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      // Ignore storage quota errors
    }
  }, [draft, storageKey]);

  useEffect(() => {
    if (step === 'compare') {
      compareHeadingRef.current?.focus();
    }
  }, [step]);

  const unitSingular = !draft.category
    ? 'unit'
    : draft.category === 'Other'
      ? draft.otherUnitSingular.trim() || 'unit'
      : DEFAULT_UNITS[draft.category].singular;
  const unitPlural = !draft.category
    ? 'units'
    : draft.category === 'Other'
      ? draft.otherUnitPlural.trim() || 'units'
      : DEFAULT_UNITS[draft.category].plural;

  const updateField = <K extends keyof StartPoolDraftState>(
    key: K,
    value: StartPoolDraftState[K]
  ) => {
    submitAttemptIdRef.current = `req-${Math.random().toString(36).slice(2, 10)}`;
    setDraft((prev) => ({ ...prev, [key]: value, userEdited: true }));
    if (key === 'category' && value) {
      setPrefilledWithoutCategory(false);
    }
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
    modelOrVariant: string;
  } => {
    const pushIfPresent = (arr: PoolSpecField[], label: string, val: string) => {
      const trimmed = val.trim();
      if (trimmed) arr.push({ label, value: trimmed });
    };

    switch (draft.category) {
      case 'Vehicles': {
        const specs: PoolSpecField[] = [];
        pushIfPresent(specs, 'Model', draft.vehModel);
        pushIfPresent(specs, 'Trim', draft.vehTrim);
        pushIfPresent(specs, 'Pickup', draft.deliveryOrDestination || draft.location);
        const combined = `${draft.vehModel.trim()} ${draft.vehTrim.trim()}`.trim();
        return {
          specs,
          primaryLabel: 'Model & trim',
          primaryValues: combined ? [combined] : [draft.title.trim() || 'Matches group specification'],
          modelOrVariant: combined,
        };
      }
      case 'Apartments': {
        const specs: PoolSpecField[] = [];
        if (draft.aptMoveIn) {
          specs.push({
            label: 'Move-in target',
            value: formatCalendarDate(draft.aptMoveIn, { includeYear: true }),
          });
        }
        pushIfPresent(specs, 'Unit size', draft.aptUnitSize);
        pushIfPresent(specs, 'Area', draft.location);
        return {
          specs,
          primaryLabel: 'Unit size',
          primaryValues: draft.aptUnitSize.trim()
            ? [draft.aptUnitSize.trim()]
            : ['Matches group specification'],
          modelOrVariant: draft.aptUnitSize.trim(),
        };
      }
      case 'Furniture': {
        const specs: PoolSpecField[] = [];
        pushIfPresent(specs, 'SKU / Model', draft.furnSku);
        pushIfPresent(specs, 'Delivery', draft.furnDelivery || draft.deliveryOrDestination);
        specs.push({ label: 'Unit', value: `${unitSingular} / ${unitPlural}` });
        return {
          specs,
          primaryLabel: 'Item SKU',
          primaryValues: draft.furnSku.trim()
            ? [draft.furnSku.trim()]
            : ['Matches group specification'],
          modelOrVariant: draft.furnSku.trim(),
        };
      }
      case 'Collectibles': {
        const specs: PoolSpecField[] = [];
        pushIfPresent(specs, 'Edition', draft.collEdition);
        pushIfPresent(specs, 'Condition', draft.collCondition);
        pushIfPresent(specs, 'Shipping', draft.deliveryOrDestination);
        const combined = [draft.collEdition.trim(), draft.collCondition.trim()]
          .filter(Boolean)
          .join(' · ');
        return {
          specs,
          primaryLabel: 'Edition & condition',
          primaryValues: combined ? [combined] : ['Matches group specification'],
          modelOrVariant: combined,
        };
      }
      case 'Hotels': {
        const specs: PoolSpecField[] = [];
        pushIfPresent(specs, 'Destination', draft.hotelDest);
        if (draft.hotelCheckIn && draft.hotelCheckOut) {
          specs.push({
            label: 'Check-in / Check-out',
            value: `${formatCalendarDate(draft.hotelCheckIn)} – ${formatCalendarDate(
              draft.hotelCheckOut,
              { includeYear: true }
            )}`,
          });
        }
        pushIfPresent(specs, 'Room type', draft.hotelRoomType);
        return {
          specs,
          primaryLabel: 'Room type',
          primaryValues: draft.hotelRoomType.trim()
            ? [draft.hotelRoomType.trim()]
            : ['Matches group specification'],
          modelOrVariant: draft.hotelRoomType.trim(),
        };
      }
      case 'Other':
      default: {
        const specs: PoolSpecField[] = [
          { label: 'Unit counted', value: `${unitSingular} / ${unitPlural}` },
        ];
        pushIfPresent(specs, 'Fulfillment', draft.deliveryOrDestination);
        return {
          specs,
          primaryLabel: 'Shared specification',
          primaryValues: ['Matches group specification'],
          modelOrVariant: '',
        };
      }
    }
  };

  const buildSimilarQuery = (): SimilarPoolQueryInput => {
    const { specs, primaryValues, modelOrVariant } = buildCategorySpecs();
    return {
      category: draft.category || undefined,
      title: draft.title.trim(),
      location: draft.location.trim() || undefined,
      goalDate: draft.goalDate || undefined,
      modelOrVariant: modelOrVariant || undefined,
      primaryOptionValues: primaryValues.filter((v) => v !== 'Matches group specification'),
      categorySpecs: specs,
      includeUnavailable: true,
    };
  };

  const validateDraft = (): boolean => {
    const errs: Record<string, string> = {};

    if (!draft.category) {
      errs.category =
        'Select a category that matches your item before checking for similar pools.';
    }
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
    if (
      draft.category === 'Hotels' &&
      draft.hotelCheckIn &&
      draft.hotelCheckOut &&
      draft.hotelCheckOut <= draft.hotelCheckIn
    ) {
      errs.hotelCheckOut = 'Check-out date must be after check-in date.';
    }
    if (
      draft.category === 'Other' &&
      (!draft.otherUnitSingular.trim() || !draft.otherUnitPlural.trim())
    ) {
      errs.otherUnitSingular = 'Enter both singular and plural unit labels.';
    }

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setSubmitError('Fix the highlighted fields before checking for similar pools.');
      return false;
    }

    setFieldErrors({});
    setSubmitError(null);
    return true;
  };

  const runSimilarCheck = async () => {
    setCheckingSimilar(true);
    setSimilarError(null);
    try {
      const result = await findSimilarPoolsAction(buildSimilarQuery());
      setSimilarCandidates(result.candidates);
      setSimilarReferencePools(result.referencePools ?? []);
      setCheckedPoolCount(result.checkedPoolCount);
    } catch (err) {
      setSimilarError(
        err instanceof ApiRequestError
          ? err.error.message
          : 'Could not reach the server to check existing pools.'
      );
    } finally {
      setCheckingSimilar(false);
    }
  };

  // Step 1 submit: validate and check for existing same-item pools WITHOUT silently creating a pool
  const handleCheckSimilarStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateDraft()) return;
    setJoinedExistingPool(null);
    setStep('compare');
    await runSimilarCheck();
  };

  // Step 2 explicit publish: only called when the buyer chooses to create a separate pool
  const handlePublishPool = async () => {
    if (!validateDraft() || !draft.category) {
      setStep('form');
      return;
    }

    const selectedCategory: PoolCategory = draft.category;
    const reqs = draft.requirementsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const { specs, primaryLabel, primaryValues } = buildCategorySpecs();

    setSubmitError(null);
    try {
      const poolId = await createPoolAction({
        clientRequestId: submitAttemptIdRef.current,
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim() || undefined,
        category: selectedCategory,
        location: draft.location.trim(),
        deliveryOrDestination:
          draft.category === 'Hotels'
            ? draft.hotelDest.trim() || draft.location.trim()
            : draft.category === 'Furniture'
              ? draft.furnDelivery.trim() || draft.deliveryOrDestination.trim() || draft.location.trim()
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
        if (err.error.fieldErrors) {
          setFieldErrors(err.error.fieldErrors);
          setStep('form');
        }
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
          <button
            type="button"
            onClick={() => {
              submitAttemptIdRef.current = `req-${Math.random().toString(36).slice(2, 10)}`;
              window.localStorage.removeItem(storageKey);
              setDraft({ ...INITIAL_START_POOL_DRAFT });
              setPrefilledWithoutCategory(false);
              setPendingSearchPrefill(null);
              setFieldErrors({});
              setSubmitError(null);
              setStep('form');
              setSimilarCandidates([]);
              setSimilarReferencePools([]);
              setJoinedExistingPool(null);
              setPublishedPoolId(null);
            }}
            className="inline-flex items-center px-4 py-3 bg-white border border-[#C6D8CE] hover:border-[#152B23] font-mono text-xs uppercase text-[#152B23] cursor-pointer"
          >
            Start another pool
          </button>
        </div>
      </div>
    );
  }

  const { modelOrVariant } = buildCategorySpecs();
  const querySummary: ComparisonQuerySummary = {
    title: draft.title.trim(),
    category: draft.category || undefined,
    location: draft.location.trim() || undefined,
    goalDate: draft.goalDate || undefined,
    specsText: modelOrVariant ? `Spec / variant: ${modelOrVariant}` : undefined,
  };
  const createAlertParams = new URLSearchParams({ create: '1' });
  if (draft.title.trim()) createAlertParams.set('q', draft.title.trim());
  if (draft.category) createAlertParams.set('cat', draft.category);
  const createAlertHref = `/alerts?${createAlertParams.toString()}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#CDD6CC]">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-[#152B23] underline underline-offset-4 hover:text-[#1E4334]"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to Explore</span>
        </Link>

        {/* Clear 2-Step Indicator */}
        <ol
          aria-label="Pool creation steps"
          className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider"
        >
          <li
            aria-current={step === 'form' ? 'step' : undefined}
            className={`px-2.5 py-0.5 border ${
              step === 'form'
                ? 'bg-[#1E4334] text-[#FFBF32] border-[#1E4334] font-semibold'
                : 'bg-[#EFF3ED] text-[#1E4334] border-[#8C9A86]'
            }`}
          >
            1. Purchase details
          </li>
          <li aria-hidden="true" className="text-[#8C9A86]">
            →
          </li>
          <li
            aria-current={step === 'compare' ? 'step' : undefined}
            className={`px-2.5 py-0.5 border ${
              step === 'compare'
                ? 'bg-[#1E4334] text-[#FFBF32] border-[#1E4334] font-semibold'
                : 'bg-white text-[#4E6359] border-[#CDD6CC]'
            }`}
          >
            2. Check similar pools &amp; publish
          </li>
        </ol>
      </div>

      <div>
        <h1 className="font-display text-2xl sm:text-4xl text-[#152B23] uppercase">
          {step === 'compare' ? 'Compare existing pools before publishing' : 'Start a buying pool'}
        </h1>
        <p className="mt-1 text-sm text-[#516B61]">
          {step === 'compare'
            ? 'Join an existing group for faster momentum or a published seller quote, or continue creating your own pool if location, timing, or specs differ.'
            : 'Describe your purchase first. We will check for existing pools buying the same item before creating a new one.'}
        </p>
      </div>

      {step === 'compare' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                ref={compareHeadingRef}
                tabIndex={-1}
                className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23] focus:outline-none"
              >
                Existing pools checked ({checkedPoolCount} in this session)
              </h2>
              <button
                type="button"
                onClick={() => setStep('form')}
                className="inline-flex items-center gap-1.5 font-mono text-xs uppercase text-[#152B23] underline underline-offset-4 hover:text-[#28463B] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Edit purchase details</span>
              </button>
            </div>

            {joinedExistingPool && (
              <div
                role="status"
                aria-live="polite"
                className="p-4 bg-[#EAF7EF] border-2 border-[#152B23] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <p className="font-mono text-xs font-semibold uppercase text-[#152B23]">
                    Joined existing pool
                  </p>
                  <p className="text-sm text-[#152B23]">
                    You added your interest to <strong>{joinedExistingPool.title}</strong> instead
                    of starting a duplicate pool.
                  </p>
                </div>
                <Link
                  to={`/pools/${joinedExistingPool.id}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#152B23] text-white font-mono text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                >
                  <span>Open pool</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              </div>
            )}

            <CompetingPoolsComparison
              candidates={similarCandidates}
              referencePools={similarReferencePools}
              loading={checkingSimilar}
              error={similarError}
              onRetry={() => void runSimilarCheck()}
              onRefreshCandidates={() => void runSimilarCheck()}
              querySummary={querySummary}
              emptyTitle="No compatible open pool found"
              emptyDescription="No existing pools in this session match this item, category, and specification. You can adjust your purchase details, save an item alert, or publish your separate buying pool."
              createAlertHref={createAlertHref}
              onAdjustSearch={() => setStep('form')}
              onJoinSuccess={(id, title) => setJoinedExistingPool({ id, title })}
            />
          </div>

          {/* Right Column: Explicit Non-Blocking Decision Card */}
          <aside
            aria-label="Publish decision"
            className="lg:col-span-4 lg:sticky lg:top-20 space-y-4"
          >
            <div className="bg-white border-2 border-[#152B23] shadow-[4px_4px_0px_#152B23] p-5 space-y-4">
              <div className="space-y-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61]">
                  Your draft pool
                </p>
                <h3 className="font-display text-xl text-[#152B23] uppercase">
                  {draft.title.trim()}
                </h3>
                <p className="text-xs text-[#516B61]">
                  {draft.category} · {draft.location} · Target {formatCalendarDate(draft.goalDate)}
                </p>
                {modelOrVariant && (
                  <p className="font-mono text-[11px] text-[#152B23]">Spec: {modelOrVariant}</p>
                )}
              </div>

              <div className="p-3 bg-[#F6F1E5] border border-[#C6D8CE] text-xs space-y-1 text-[#152B23]">
                <p className="font-mono text-[10px] uppercase text-[#516B61]">Threshold &amp; cap</p>
                <p className="font-semibold">
                  {draft.minQuantity} {unitPlural} minimum · {draft.maxQuantity} max cap
                </p>
              </div>

              {submitError && (
                <p
                  role="alert"
                  className="p-3 bg-[#FDF0EE] border border-[#A63A2B] text-xs text-[#A63A2B]"
                >
                  {submitError}
                </p>
              )}

              <div className="space-y-2.5 pt-1">
                {similarCandidates.length > 0 && !checkingSimilar && (
                  <p className="text-xs text-[#516B61] leading-relaxed">
                    Existing pools do not fit your specs, city, or timing? Tally never forces a
                    match—you can still publish a separate pool below.
                  </p>
                )}

                <button
                  type="button"
                  disabled={busy || checkingSimilar}
                  onClick={() => void handlePublishPool()}
                  className="w-full py-3.5 px-4 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
                >
                  {busy
                    ? 'Publishing pool…'
                    : similarError
                      ? 'Publish separate pool anyway'
                      : similarCandidates.length > 0
                        ? 'Create separate pool anyway'
                        : 'Publish new buying pool'}
                </button>

                <button
                  type="button"
                  onClick={() => setStep('form')}
                  className="w-full py-2.5 px-4 bg-white hover:bg-[#F6F1E5] text-[#152B23] border border-[#C6D8CE] hover:border-[#152B23] font-mono text-xs uppercase tracking-wider cursor-pointer"
                >
                  Back to edit details
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form Left 7 cols */}
        <form
          onSubmit={handleCheckSimilarStep}
          noValidate
          className="lg:col-span-7 bg-white border border-[#C6D8CE] p-5 sm:p-6 space-y-5"
        >
          {pendingSearchPrefill && (
            <div
              role="status"
              aria-live="polite"
              className="p-3.5 bg-[#F6F1E5] border border-[#1E4334] space-y-2.5"
            >
              <p className="text-xs text-[#152B23] leading-relaxed">
                Your existing draft (
                <strong>&ldquo;{draft.title.trim() || draft.category || 'Untitled draft'}&rdquo;</strong>
                ) was preserved. You arrived from an Explore search for{' '}
                <strong>&ldquo;{pendingSearchPrefill.title}&rdquo;</strong>
                {pendingSearchPrefill.category
                  ? ` (${pendingSearchPrefill.category})`
                  : ' (no category selected)'}
                .
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    window.localStorage.removeItem(storageKey);
                    const nextDraft = buildDraftFromSearchPrefill({
                      q: pendingSearchPrefill.title,
                      cat: pendingSearchPrefill.category || null,
                      loc: pendingSearchPrefill.location ?? null,
                    });
                    setDraft(nextDraft);
                    setPrefilledWithoutCategory(
                      Boolean(pendingSearchPrefill.title) && nextDraft.category === ''
                    );
                    setPendingSearchPrefill(null);
                    setFieldErrors({});
                    setSubmitError(null);
                  }}
                  className="px-3 py-1.5 bg-[#1E4334] hover:bg-[#152B23] text-white font-mono text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
                >
                  Start draft for &ldquo;{pendingSearchPrefill.title}&rdquo;
                </button>
                <button
                  type="button"
                  onClick={() => setPendingSearchPrefill(null)}
                  className="px-3 py-1.5 bg-white hover:bg-[#EFF3ED] text-[#152B23] border border-[#8C9A86] font-mono text-[11px] uppercase tracking-wider cursor-pointer"
                >
                  Keep saved draft
                </button>
              </div>
            </div>
          )}

          {/* Category Picker */}
          <fieldset
            className={`space-y-2.5 p-3.5 border transition-colors ${
              fieldErrors.category
                ? 'border-[#A63A2B] bg-[#FDF0EE]/50'
                : !draft.category
                  ? 'border-[#D49B00] bg-[#FFFDF5]'
                  : 'border-transparent p-0'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
                1. Category *
              </legend>
              {!draft.category && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#FFF4D1] text-[#6B4A00] border border-[#D49B00] font-mono text-[10px] font-semibold uppercase tracking-wider">
                  <AlertCircle className="w-3 h-3" aria-hidden="true" />
                  <span>Required · Not selected</span>
                </span>
              )}
            </div>

            {!draft.category && (
              <p className="text-xs text-[#6B4A00] leading-relaxed">
                {prefilledWithoutCategory
                  ? `Prefilled from your search for "${draft.title.trim()}" with no category supplied — select the matching category below before continuing.`
                  : 'Select the category that matches your purchase to unlock item-specific specification fields.'}
              </p>
            )}

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
                        ? 'bg-[#1E4334] text-white border-[#1E4334]'
                        : 'bg-white text-[#152B23] border-[#8C9A86] hover:border-[#1E4334] hover:bg-[#F7F5EE]'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
            {fieldErrors.category && (
              <p role="alert" className="text-xs font-medium text-[#A63A2B]">
                {fieldErrors.category}
              </p>
            )}
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
              2. {draft.category ? `${draft.category} specifications` : 'Item specifications'}
            </p>

            {!draft.category && (
              <p className="text-xs text-[#4E6359] leading-relaxed">
                Select a category above to show relevant specification fields (vehicle model &amp;
                trim, apartment unit size, furniture SKU, collectible edition, or hotel dates).
              </p>
            )}

            {draft.category === 'Vehicles' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="veh-model" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Model &amp; year
                  </label>
                  <input
                    id="veh-model"
                    value={draft.vehModel}
                    onChange={(e) => updateField('vehModel', e.target.value)}
                    placeholder="e.g., 2026 Ford Maverick Hybrid"
                    className="mt-1 w-full h-10 px-3 bg-white border border-[#C6D8CE] text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="veh-trim" className="block font-mono text-[11px] uppercase text-[#516B61]">
                    Trim &amp; drivetrain
                  </label>
                  <input
                    id="veh-trim"
                    value={draft.vehTrim}
                    onChange={(e) => updateField('vehTrim', e.target.value)}
                    placeholder="e.g., XLT FWD or Lariat AWD"
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
                    <option value="">Any / specify in title</option>
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
                    placeholder="e.g., WW-DT90 or SKU-OAK-84"
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
                    placeholder="e.g., Portland metro local delivery"
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
                    placeholder="e.g., First Pressing 180g LP"
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
                    placeholder="e.g., Sealed Mint (M)"
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
                    placeholder="e.g., Hood River, OR"
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
                    placeholder="e.g., King or Double Queen"
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
            disabled={busy || checkingSimilar}
            className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
            <span>
              {checkingSimilar ? 'Checking existing pools…' : 'Check for similar pools'}
            </span>
          </button>
          <p className="text-xs text-center text-[#516B61]">
            Step 1 of 2 · Nothing is published yet. We will compare matching pools first.
          </p>
        </form>

        {/* Live Directory Card Preview Right 5 cols */}
        <aside aria-label="Live pool card preview" className="lg:col-span-5 lg:sticky lg:top-20 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#516B61]">
              Live Explore card preview
            </p>
            <span className="font-mono text-[10px] text-[#516B61]">
              {draft.userEdited
                ? 'Draft auto-saved'
                : prefilledWithoutCategory
                  ? 'Prefilled · pick category'
                  : 'Starts saving on edit'}
            </span>
          </div>
          <div className="bg-white border-2 border-[#152B23] shadow-[3px_3px_0px_#152B23] p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${
                  draft.category ? 'text-[#516B61]' : 'text-[#8A5A00]'
                }`}
              >
                {draft.category || 'Category not selected'}
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
      )}
    </div>
  );
}
