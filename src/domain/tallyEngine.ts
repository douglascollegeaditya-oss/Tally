import {
  buildMaverickPool,
  buildMaverickScenarioActivity,
  DEFAULT_DEMO_NOW,
  MAVERICK_EXPIRED_DEMO_NOW,
} from './seedData.ts';
import type {
  ActivityEvent,
  CreatePoolInput,
  DemoScenarioId,
  DemoSessionState,
  EligibilityResult,
  EngineOutcome,
  JoinPoolInput,
  PersonaIdentity,
  PersonaRole,
  Pool,
  PoolMember,
  PoolMetrics,
  PoolStage,
  PublishOfferInput,
  SellerOffer,
  VariantBreakdownRow,
} from './types.ts';

function cloneState(state: DemoSessionState): DemoSessionState {
  return JSON.parse(JSON.stringify(state)) as DemoSessionState;
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates and normalizes calendar date-only strings (YYYY-MM-DD) without
 * converting through local or UTC timezone offsets that can shift the day.
 */
export function normalizeCalendarDate(value: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = CALENDAR_DATE_RE.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function evaluateMemberEligibility(pool: Pool, member: PoolMember): EligibilityResult {
  const reasons: string[] = [];

  if (member.quantity < 1) {
    reasons.push('Quantity must be at least 1.');
  }

  for (const group of pool.optionGroups) {
    if (!group.required) continue;
    const chosen = member.selectedOptions[group.id];
    if (!chosen) {
      reasons.push(`Missing required selection for ${group.label}.`);
      continue;
    }
    if (!group.allowedValues.includes(chosen)) {
      reasons.push(
        `${group.label} "${chosen}" does not match shared requirement (${group.allowedValues.join(' or ')}).`
      );
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

export function computePoolMetrics(pool: Pool, demoNowIso: string): PoolMetrics {
  const nowMs = Date.parse(demoNowIso);
  const targetMin = pool.currentOffer ? pool.currentOffer.minQuantity : pool.minQuantity;
  const targetCap = pool.currentOffer ? pool.currentOffer.maxQuantity : pool.maxQuantity;

  let eligibleInterestedUnits = 0;
  let excludedUnits = 0;
  let confirmedUnits = 0;
  let fulfilledUnits = 0;
  let waitlistUnits = 0;
  let passedUnits = 0;

  const variantMap = new Map<string, { units: number; count: number }>();

  for (const member of pool.members) {
    const { eligible } = evaluateMemberEligibility(pool, member);

    if (!eligible) {
      excludedUnits += member.quantity;
      continue;
    }

    if (member.status === 'passed') {
      passedUnits += member.quantity;
      continue;
    }

    if (member.status === 'waitlisted') {
      waitlistUnits += member.quantity;
      continue;
    }

    // Eligible active member counts toward interested demand
    eligibleInterestedUnits += member.quantity;

    const variantKey =
      pool.optionGroups.length > 0
        ? pool.optionGroups
            .map((g) => member.selectedOptions[g.id] || 'Unspecified')
            .join(' · ')
        : 'Standard specification';

    const existing = variantMap.get(variantKey) ?? { units: 0, count: 0 };
    existing.units += member.quantity;
    existing.count += 1;
    variantMap.set(variantKey, existing);

    if (pool.currentOffer) {
      const matchesVersion = member.confirmedVersion === pool.currentOffer.version;
      if (
        matchesVersion &&
        !member.needsReconfirmation &&
        (member.status === 'confirmed' || member.status === 'fulfilled')
      ) {
        confirmedUnits += member.quantity;
      }
      if (matchesVersion && member.status === 'fulfilled') {
        fulfilledUnits += member.quantity;
      }
    }
  }

  const variantBreakdown: VariantBreakdownRow[] = Array.from(variantMap.entries())
    .map(([variantLabel, data]) => ({
      variantLabel,
      eligibleUnits: data.units,
      memberCount: data.count,
    }))
    .sort((a, b) => b.eligibleUnits - a.eligibleUnits);

  let effectiveStage: PoolStage = pool.stage;
  let isExpired = false;

  if (pool.stage === 'closed') {
    effectiveStage = 'closed';
  } else if (pool.stage === 'unlocked') {
    effectiveStage = 'unlocked';
  } else if (pool.currentOffer) {
    const closeMs = Date.parse(pool.currentOffer.closeAt);
    if (confirmedUnits >= targetMin && nowMs <= closeMs) {
      effectiveStage = 'unlocked';
    } else if (nowMs > closeMs && confirmedUnits < targetMin) {
      effectiveStage = 'expired';
      isExpired = true;
    } else if (pool.stage === 'expired') {
      effectiveStage = 'expired';
      isExpired = true;
    } else {
      effectiveStage = 'offer_open';
    }
  } else if (pool.stage === 'quote_requested') {
    effectiveStage = 'quote_requested';
  } else {
    effectiveStage = eligibleInterestedUnits >= targetMin ? 'ready_for_quote' : 'gathering';
  }

  const activeCount =
    effectiveStage === 'offer_open' ||
    effectiveStage === 'unlocked' ||
    effectiveStage === 'expired' ||
    effectiveStage === 'closed'
      ? confirmedUnits
      : eligibleInterestedUnits;

  const remainingToMinimum = Math.max(0, targetMin - activeCount);
  const isCapReached =
    pool.currentOffer !== undefined && confirmedUnits >= targetCap && targetCap > 0;

  return {
    effectiveStage,
    eligibleInterestedUnits,
    excludedUnits,
    confirmedUnits,
    fulfilledUnits,
    waitlistUnits,
    passedUnits,
    targetMin,
    targetCap,
    remainingToMinimum,
    isCapReached,
    isExpired,
    variantBreakdown,
  };
}

/**
 * Strips private contact info from public views and seller requests.
 * Also strips private seller claim instructions unless the pool is unlocked
 * and the caller is a confirmed buyer for the winning offer version.
 */
export function sanitizePoolForRole(
  pool: Pool,
  role: PersonaRole,
  actorId: string,
  demoNowIso: string
): Pool {
  const copy = JSON.parse(JSON.stringify(pool)) as Pool;
  const metrics = computePoolMetrics(copy, demoNowIso);
  copy.stage = metrics.effectiveStage;

  // Never expose member private contact info in public pool responses or seller packets
  copy.members = copy.members.map((m) => {
    const { privateEmail: _e, privatePhone: _p, ...publicMember } = m;
    return publicMember;
  });

  // Hide sellerToken unless the caller is the seller or the pool's own organizer
  if (role !== 'seller' && !canManagePool(pool, actorId)) {
    delete copy.sellerToken;
  }

  // Protect privateClaimInstructions: ONLY visible to confirmed buyer on an unlocked pool
  // (or seller who authored it)
  if (copy.currentOffer) {
    const actorMember = copy.members.find((m) => m.userId === actorId);
    const isConfirmedBuyer =
      role === 'buyer' &&
      metrics.effectiveStage === 'unlocked' &&
      actorMember !== undefined &&
      (actorMember.status === 'confirmed' || actorMember.status === 'fulfilled') &&
      actorMember.confirmedVersion === copy.currentOffer.version &&
      !actorMember.needsReconfirmation;

    if (!isConfirmedBuyer && role !== 'seller') {
      copy.currentOffer.privateClaimInstructions = '';
      copy.currentOffer.privateReferencePrefix = '';
    }
  }

  return copy;
}

export function canManagePool(pool: Pool, actorId: string): boolean {
  return pool.organizerId === actorId;
}

export function canAccessOrganizerRoute(role: PersonaRole): boolean {
  return role === 'organizer';
}

export function canAccessSellerRoute(role: PersonaRole): boolean {
  return role === 'seller';
}

export function canAccessClaimRoute(
  pool: Pool,
  role: PersonaRole,
  actorId: string,
  demoNowIso: string
): { allowed: boolean; reason?: string } {
  if (role !== 'buyer') {
    return {
      allowed: false,
      reason: 'Claim instructions are private to confirmed buyers in this pool.',
    };
  }
  const metrics = computePoolMetrics(pool, demoNowIso);
  if (metrics.effectiveStage !== 'unlocked') {
    return {
      allowed: false,
      reason:
        metrics.effectiveStage === 'expired'
          ? 'This offer expired before reaching minimum quantity. No active claim exists.'
          : 'No voucher or allocation is issued before the minimum group quantity confirms.',
    };
  }
  const member = pool.members.find((m) => m.userId === actorId);
  if (
    !member ||
    !pool.currentOffer ||
    member.confirmedVersion !== pool.currentOffer.version ||
    member.needsReconfirmation ||
    (member.status !== 'confirmed' && member.status !== 'fulfilled')
  ) {
    return {
      allowed: false,
      reason: 'Only buyers who confirmed the winning offer version can view claim instructions.',
    };
  }
  return { allowed: true };
}

function appendActivity(
  state: DemoSessionState,
  event: Omit<ActivityEvent, 'id' | 'createdAt'>
): void {
  state.activity.unshift({
    id: makeId('act'),
    createdAt: state.demoNow,
    ...event,
  });
  if (state.activity.length > 40) {
    state.activity = state.activity.slice(0, 40);
  }
}

export function joinOrUpdatePool(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity,
  input: JoinPoolInput
): EngineOutcome<{ pool: Pool; member: PoolMember; eligibility: EligibilityResult }> {
  if (actor.role === 'seller') {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_ROLE',
        message: 'Switch to Buyer or Organizer persona to join a buyer pool.',
      },
    };
  }

  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Pool not found.' } };
  }

  const metrics = computePoolMetrics(pool, next.demoNow);
  if (
    metrics.effectiveStage === 'unlocked' ||
    metrics.effectiveStage === 'expired' ||
    metrics.effectiveStage === 'closed'
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STAGE',
        message: 'This pool is no longer accepting new joins or preference edits.',
      },
    };
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Quantity must be a whole number between 1 and 10.',
        fieldErrors: { quantity: 'Enter a whole number between 1 and 10.' },
      },
    };
  }

  const existingIndex = pool.members.findIndex((m) => m.userId === actor.id);
  const isUpdate = existingIndex >= 0;

  // Prevent editing preferences if buyer already confirmed an open offer (must withdraw first)
  if (isUpdate && pool.members[existingIndex].status === 'confirmed' && pool.currentOffer) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STAGE',
        message: 'Withdraw your offer confirmation before changing your options or quantity.',
      },
    };
  }

  const memberRecord: PoolMember = isUpdate
    ? {
        ...pool.members[existingIndex],
        quantity: input.quantity,
        selectedOptions: { ...input.selectedOptions },
        note: input.note?.trim() || undefined,
        status:
          pool.members[existingIndex].status === 'passed'
            ? 'interested'
            : pool.members[existingIndex].status,
      }
    : {
        id: makeId('mem'),
        userId: actor.id,
        displayName: actor.name,
        location: actor.location,
        quantity: input.quantity,
        selectedOptions: { ...input.selectedOptions },
        note: input.note?.trim() || undefined,
        joinedAt: next.demoNow,
        status: 'interested',
        privateEmail: actor.email,
        privatePhone: actor.phone,
      };

  if (isUpdate) {
    pool.members[existingIndex] = memberRecord;
  } else {
    pool.members.push(memberRecord);
  }

  const eligibility = evaluateMemberEligibility(pool, memberRecord);
  const updatedMetrics = computePoolMetrics(pool, next.demoNow);
  pool.stage = updatedMetrics.effectiveStage;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  const unitLabel = memberRecord.quantity === 1 ? pool.unitSingular : pool.unitPlural;
  appendActivity(next, {
    poolId: pool.id,
    poolTitle: pool.title,
    kind: 'joined',
    summary: isUpdate
      ? `${actor.name} updated preferences (${memberRecord.quantity} ${unitLabel}${
          eligibility.eligible ? '' : ' — excluded from eligible count'
        }).`
      : `${actor.name} joined with ${memberRecord.quantity} ${unitLabel}${
          eligibility.eligible
            ? ` (${updatedMetrics.eligibleInterestedUnits} of ${updatedMetrics.targetMin} ${pool.unitPlural} interested).`
            : ' (excluded due to incompatible preferences).'
        }`,
  });

  return { ok: true, data: { pool, member: memberRecord, eligibility }, state: next };
}

export function leavePool(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity
): EngineOutcome<{ pool: Pool }> {
  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Pool not found.' } };
  }

  const metrics = computePoolMetrics(pool, next.demoNow);
  if (metrics.effectiveStage === 'unlocked' || metrics.effectiveStage === 'closed') {
    return {
      ok: false,
      error: {
        code: 'ALREADY_LOCKED',
        message: 'You cannot leave a pool after the group price has unlocked.',
      },
    };
  }

  const idx = pool.members.findIndex((m) => m.userId === actor.id);
  if (idx < 0) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'You are not currently in this pool.' },
    };
  }

  pool.members.splice(idx, 1);
  const updatedMetrics = computePoolMetrics(pool, next.demoNow);
  pool.stage = updatedMetrics.effectiveStage;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  appendActivity(next, {
    poolId: pool.id,
    poolTitle: pool.title,
    kind: 'left',
    summary: `${actor.name} left the pool (${updatedMetrics.eligibleInterestedUnits} of ${updatedMetrics.targetMin} ${pool.unitPlural} interested).`,
  });

  return { ok: true, data: { pool }, state: next };
}

export function postDiscussionMessage(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity,
  body: string,
  isOrganizerUpdate = false
): EngineOutcome<{ pool: Pool }> {
  const trimmed = body.trim();
  if (trimmed.length < 2) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Enter a message before posting.',
        fieldErrors: { body: 'Message cannot be empty.' },
      },
    };
  }
  if (trimmed.length > 600) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Message must be 600 characters or fewer.',
        fieldErrors: { body: 'Keep messages under 600 characters.' },
      },
    };
  }

  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Pool not found.' } };
  }

  if (isOrganizerUpdate && !canManagePool(pool, actor.id)) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_ROLE',
        message: 'Only this pool’s organizer can post official updates.',
      },
    };
  }

  pool.discussion.push({
    id: makeId('disc'),
    authorId: actor.id,
    authorName: actor.name,
    authorRole: actor.role,
    body: trimmed,
    createdAt: next.demoNow,
    isOrganizerUpdate,
  });
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  if (isOrganizerUpdate) {
    appendActivity(next, {
      poolId: pool.id,
      poolTitle: pool.title,
      kind: 'organizer_update',
      summary: `Organizer posted an update: "${trimmed.slice(0, 72)}${trimmed.length > 72 ? '…' : ''}"`,
    });
  }

  return { ok: true, data: { pool }, state: next };
}

export function createPool(
  state: DemoSessionState,
  actor: PersonaIdentity,
  input: CreatePoolInput
): EngineOutcome<{ pool: Pool }> {
  const fieldErrors: Record<string, string> = {};
  if (!input.title || input.title.trim().length < 4) {
    fieldErrors.title = 'Enter a clear title (at least 4 characters).';
  }
  if (!input.location || input.location.trim().length < 2) {
    fieldErrors.location = 'Enter a metro area or shipping region.';
  }
  if (!input.unitSingular || !input.unitPlural) {
    fieldErrors.unitSingular = 'Specify both singular and plural unit labels.';
  }
  if (!Number.isInteger(input.minQuantity) || input.minQuantity < 2 || input.minQuantity > 100) {
    fieldErrors.minQuantity = 'Minimum quantity must be between 2 and 100.';
  }
  const maxQuantity = input.maxQuantity ?? Math.max(input.minQuantity, input.minQuantity + 4);
  if (maxQuantity < input.minQuantity) {
    fieldErrors.maxQuantity = 'Maximum cap cannot be lower than minimum quantity.';
  }
  const normalizedGoalDate = normalizeCalendarDate(input.goalDate);
  if (!normalizedGoalDate) {
    fieldErrors.goalDate = 'Select a valid calendar goal date (YYYY-MM-DD).';
  }
  const cleanReqs = input.sharedRequirements.map((r) => r.trim()).filter(Boolean);
  if (cleanReqs.length === 0) {
    fieldErrors.sharedRequirements = 'List at least one shared requirement for compatible demand.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please fix the highlighted fields before publishing your pool.',
        fieldErrors,
      },
    };
  }

  const next = cloneState(state);
  const slugBase = input.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  const id = `pool-${slugBase}-${Math.random().toString(36).slice(2, 6)}`;

  const primaryLabel = input.primaryOptionLabel?.trim() || 'Specification match';
  const primaryValues =
    input.primaryOptionValues && input.primaryOptionValues.length > 0
      ? input.primaryOptionValues.map((v) => v.trim()).filter(Boolean)
      : ['Matches shared spec'];

  const newPool: Pool = {
    id,
    slug: id,
    title: input.title.trim(),
    subtitle:
      input.subtitle?.trim() ||
      `${input.category} group buy · ${input.deliveryOrDestination.trim() || input.location.trim()}`,
    category: input.category,
    location: input.location.trim(),
    deliveryOrDestination: input.deliveryOrDestination.trim() || input.location.trim(),
    unitSingular: input.unitSingular.trim(),
    unitPlural: input.unitPlural.trim(),
    minQuantity: input.minQuantity,
    maxQuantity,
    goalDate: normalizedGoalDate!,
    stage: 'gathering',
    organizerId: actor.id,
    organizerName: actor.name,
    organizerNote:
      input.organizerNote.trim() ||
      'Pooling compatible local buyers to request one clear, itemized seller quote.',
    sharedRequirements: cleanReqs,
    categorySpecs: input.categorySpecs.filter((s) => s.label.trim() && s.value.trim()),
    optionGroups: [
      {
        id: 'primary',
        label: primaryLabel,
        required: true,
        allowedValues: primaryValues,
        allValues: [...primaryValues, 'Different spec (Excluded)'],
      },
    ],
    offerHistory: [],
    members: [
      {
        id: makeId('mem'),
        userId: actor.id,
        displayName: `${actor.name} (Organizer)`,
        location: actor.location,
        quantity: 1,
        selectedOptions: { primary: primaryValues[0] },
        joinedAt: next.demoNow,
        status: 'interested',
        privateEmail: actor.email,
        privatePhone: actor.phone,
      },
    ],
    discussion: [],
    followers: [],
    createdAt: next.demoNow,
    updatedAt: next.demoNow,
  };

  next.pools.unshift(newPool);
  next.updatedAt = next.demoNow;

  appendActivity(next, {
    poolId: newPool.id,
    poolTitle: newPool.title,
    kind: 'created',
    summary: `${actor.name} started a new pool (${newPool.minQuantity} ${newPool.unitPlural} minimum).`,
  });

  return { ok: true, data: { pool: newPool }, state: next };
}

export function recalculatePoolDemand(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity
): EngineOutcome<{ pool: Pool; metrics: PoolMetrics }> {
  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Pool not found.' } };
  }
  if (!canManagePool(pool, actor.id)) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_ROLE',
        message: `Only ${pool.organizerName} (this pool's organizer) can manage demand and seller requests.`,
      },
    };
  }

  const metrics = computePoolMetrics(pool, next.demoNow);
  pool.stage = metrics.effectiveStage;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  return { ok: true, data: { pool, metrics }, state: next };
}

export function requestSellerQuote(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity
): EngineOutcome<{ pool: Pool; sellerToken: string; metrics: PoolMetrics }> {
  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Pool not found.' } };
  }
  if (!canManagePool(pool, actor.id)) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_ROLE',
        message: `Only ${pool.organizerName} (this pool's organizer) can create a private seller request link.`,
      },
    };
  }

  // Always recalculate eligible demand before requesting a quote
  const metrics = computePoolMetrics(pool, next.demoNow);
  if (metrics.eligibleInterestedUnits < pool.minQuantity) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STAGE',
        message: `Need ${pool.minQuantity} eligible ${pool.unitPlural} before requesting a quote (currently ${metrics.eligibleInterestedUnits}).`,
      },
    };
  }

  if (
    metrics.effectiveStage === 'unlocked' ||
    metrics.effectiveStage === 'closed' ||
    metrics.effectiveStage === 'expired'
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STAGE',
        message: 'Cannot request a new quote in this pool stage.',
      },
    };
  }

  if (!pool.sellerToken) {
    pool.sellerToken =
      pool.id === 'pool-maverick-xlt'
        ? 'alder-maverick-req-2026'
        : `req-${pool.id.slice(5, 16)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  if (!pool.currentOffer) {
    pool.stage = 'quote_requested';
  }
  pool.quoteRequestedAt = next.demoNow;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  appendActivity(next, {
    poolId: pool.id,
    poolTitle: pool.title,
    kind: 'quote_requested',
    summary: `Organizer created a private seller request for ${metrics.eligibleInterestedUnits} eligible ${pool.unitPlural}.`,
  });

  const updatedMetrics = computePoolMetrics(pool, next.demoNow);
  return {
    ok: true,
    data: { pool, sellerToken: pool.sellerToken, metrics: updatedMetrics },
    state: next,
  };
}

export function publishOrReviseSellerOffer(
  state: DemoSessionState,
  sellerToken: string,
  actor: PersonaIdentity,
  input: PublishOfferInput
): EngineOutcome<{ pool: Pool; offer: SellerOffer; isRevision: boolean }> {
  if (!canAccessSellerRoute(actor.role)) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_ROLE',
        message: 'Only the Seller persona can publish or revise seller quotes on this route.',
      },
    };
  }

  const next = cloneState(state);
  const pool = next.pools.find((p) => p.sellerToken === sellerToken);
  if (!pool) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Seller request link was not found or is invalid.' },
    };
  }

  const currentMetrics = computePoolMetrics(pool, next.demoNow);
  if (currentMetrics.effectiveStage === 'unlocked' || currentMetrics.effectiveStage === 'closed') {
    return {
      ok: false,
      error: {
        code: 'ALREADY_LOCKED',
        message: 'Cannot revise an offer after the group price has already unlocked.',
      },
    };
  }

  const fieldErrors: Record<string, string> = {};
  if (!input.sellerName || input.sellerName.trim().length < 2) {
    fieldErrors.sellerName = 'Enter the seller business name.';
  }
  if (!input.matchingScope || input.matchingScope.trim().length < 6) {
    fieldErrors.matchingScope = 'Describe the exact matching item/scope covered by this quote.';
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0) {
    fieldErrors.unitPrice = 'Unit price must be greater than $0.';
  }
  if (!Number.isFinite(input.knownFees) || input.knownFees < 0) {
    fieldErrors.knownFees = 'Known fees cannot be negative.';
  }
  if (!input.feeLabel || input.feeLabel.trim().length < 2) {
    fieldErrors.feeLabel = 'Label the included fee (e.g., Dealer documentation fee).';
  }
  if (!Number.isInteger(input.minQuantity) || input.minQuantity < 2) {
    fieldErrors.minQuantity = 'Minimum quantity must be at least 2.';
  }
  if (!Number.isInteger(input.maxQuantity) || input.maxQuantity < input.minQuantity) {
    fieldErrors.maxQuantity = 'Cap must be greater than or equal to the minimum quantity.';
  }
  if (!input.fulfillmentMethod || input.fulfillmentMethod.trim().length < 4) {
    fieldErrors.fulfillmentMethod = 'Specify how buyers will fulfill directly after unlock.';
  }

  const closeMs = Date.parse(input.closeAt);
  const nowMs = Date.parse(next.demoNow);
  if (!input.closeAt || Number.isNaN(closeMs)) {
    fieldErrors.closeAt = 'Enter a valid offer close date and time.';
  } else if (closeMs <= nowMs) {
    fieldErrors.closeAt = 'Offer close date/time must be in the future relative to the demo clock.';
  }

  const normalizedClaimByDate = normalizeCalendarDate(input.claimByDate);
  const claimEndOfDayMs = normalizedClaimByDate
    ? Date.parse(`${normalizedClaimByDate}T23:59:59-08:00`)
    : Number.NaN;
  if (!normalizedClaimByDate || Number.isNaN(claimEndOfDayMs)) {
    fieldErrors.claimByDate = 'Enter a valid calendar claim-by / pickup date (YYYY-MM-DD).';
  } else if (!Number.isNaN(closeMs) && claimEndOfDayMs < closeMs) {
    fieldErrors.claimByDate = 'Claim-by date must be on or after the offer close date.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Check the highlighted quote fields before publishing.',
        fieldErrors,
      },
    };
  }

  const isRevision = pool.currentOffer !== undefined;
  const previousOffer = pool.currentOffer;
  const nextVersion = previousOffer ? previousOffer.version + 1 : 1;

  if (previousOffer) {
    pool.offerHistory.unshift({
      version: previousOffer.version,
      unitPrice: previousOffer.unitPrice,
      knownFees: previousOffer.knownFees,
      feeLabel: previousOffer.feeLabel,
      subtotal: previousOffer.subtotal,
      minQuantity: previousOffer.minQuantity,
      maxQuantity: previousOffer.maxQuantity,
      closeAt: previousOffer.closeAt,
      claimByDate: previousOffer.claimByDate,
      publishedAt: previousOffer.publishedAt,
      revisionSummary: previousOffer.revisionSummary,
      supersededAt: next.demoNow,
    });
  }

  const subtotal = Math.round((input.unitPrice + input.knownFees) * 100) / 100;

  let diffText = input.revisionSummary?.trim();
  if (isRevision && previousOffer && !diffText) {
    const changes: string[] = [];
    if (previousOffer.unitPrice !== input.unitPrice) {
      changes.push(
        `unit price $${previousOffer.unitPrice.toLocaleString()} → $${input.unitPrice.toLocaleString()}`
      );
    }
    if (previousOffer.knownFees !== input.knownFees) {
      changes.push(
        `fees $${previousOffer.knownFees.toLocaleString()} → $${input.knownFees.toLocaleString()}`
      );
    }
    if (previousOffer.minQuantity !== input.minQuantity) {
      changes.push(`minimum ${previousOffer.minQuantity} → ${input.minQuantity}`);
    }
    if (previousOffer.closeAt !== new Date(input.closeAt).toISOString()) {
      changes.push('offer close deadline updated');
    }
    diffText =
      changes.length > 0
        ? `Updated ${changes.join(', ')}. Prior confirmations require reconfirmation.`
        : 'Terms revised by seller. Prior confirmations require reconfirmation.';
  }

  const newOffer: SellerOffer = {
    version: nextVersion,
    sellerName: input.sellerName.trim(),
    sellerLocation: input.sellerLocation.trim() || pool.location,
    matchingScope: input.matchingScope.trim(),
    currency: 'USD',
    unitPrice: input.unitPrice,
    knownFees: input.knownFees,
    feeLabel: input.feeLabel.trim(),
    subtotal,
    taxAndRegistrationNote:
      input.taxAndRegistrationNote.trim() || 'Excludes applicable state tax and registration.',
    minQuantity: input.minQuantity,
    maxQuantity: input.maxQuantity,
    fulfillmentMethod: input.fulfillmentMethod.trim(),
    closeAt: new Date(input.closeAt).toISOString(),
    timezoneLabel: input.timezoneLabel.trim() || 'Pacific',
    claimByDate: normalizedClaimByDate!,
    publishedAt: next.demoNow,
    revisionSummary: diffText || `Published Offer v${nextVersion}.`,
    privateClaimInstructions:
      input.privateClaimInstructions.trim() ||
      `SIMULATED DEMO INSTRUCTIONS: Contact ${input.sellerName.trim()} directly by ${normalizedClaimByDate!} with your private claim reference code to complete direct payment and pickup.`,
    privateReferencePrefix: `${input.sellerName
      .trim()
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 6)
      .toUpperCase()}-V${nextVersion}`,
  };

  pool.currentOffer = newOffer;
  pool.minQuantity = newOffer.minQuantity;
  pool.maxQuantity = newOffer.maxQuantity;
  pool.stage = 'offer_open';

  // If revising an existing offer, require reconfirmation from all previously confirmed buyers!
  if (isRevision) {
    for (const member of pool.members) {
      if (member.status === 'confirmed' || member.status === 'waitlisted') {
        member.status = 'interested';
        member.needsReconfirmation = true;
      }
    }
    pool.discussion.push({
      id: makeId('disc'),
      authorId: actor.id,
      authorName: newOffer.sellerName,
      authorRole: 'seller',
      body: `Offer revised to Version ${newOffer.version}: ${newOffer.revisionSummary} All buyers must review and confirm Version ${newOffer.version}.`,
      createdAt: next.demoNow,
    });
  }

  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  appendActivity(next, {
    poolId: pool.id,
    poolTitle: pool.title,
    kind: isRevision ? 'offer_revised' : 'offer_published',
    summary: isRevision
      ? `${newOffer.sellerName} revised offer to v${newOffer.version} ($${newOffer.subtotal.toLocaleString()} subtotal) — reconfirmation required.`
      : `${newOffer.sellerName} published Offer v${newOffer.version} ($${newOffer.subtotal.toLocaleString()} subtotal, min ${newOffer.minQuantity}).`,
  });

  return { ok: true, data: { pool, offer: newOffer, isRevision }, state: next };
}

export function confirmOffer(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity,
  expectedVersion: number
): EngineOutcome<{ pool: Pool; unlockedNow: boolean; waitlisted: boolean; metrics: PoolMetrics }> {
  if (actor.role === 'seller') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN_ROLE', message: 'Sellers cannot confirm buyer offers.' },
    };
  }

  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool || !pool.currentOffer) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Active offer not found.' } };
  }

  const preMetrics = computePoolMetrics(pool, next.demoNow);
  if (preMetrics.isExpired || preMetrics.effectiveStage === 'expired') {
    pool.stage = 'expired';
    return {
      ok: false,
      error: {
        code: 'OFFER_EXPIRED',
        message: 'This offer closed before your confirmation could be recorded.',
      },
    };
  }

  if (expectedVersion !== pool.currentOffer.version) {
    return {
      ok: false,
      error: {
        code: 'STALE_OFFER_VERSION',
        message: `Offer terms were updated to Version ${pool.currentOffer.version}. Review the updated receipt before confirming.`,
        currentVersion: pool.currentOffer.version,
      },
    };
  }

  const member = pool.members.find((m) => m.userId === actor.id);
  if (!member) {
    return {
      ok: false,
      error: {
        code: 'INELIGIBLE_MEMBER',
        message: 'Join this pool with compatible preferences before confirming an offer.',
      },
    };
  }

  const eligibility = evaluateMemberEligibility(pool, member);
  if (!eligibility.eligible) {
    return {
      ok: false,
      error: {
        code: 'INELIGIBLE_MEMBER',
        message: `Excluded from offer: ${eligibility.reasons.join(' ')}`,
      },
    };
  }

  // Idempotent repeat click check
  if (
    (member.status === 'confirmed' || member.status === 'fulfilled') &&
    member.confirmedVersion === pool.currentOffer.version &&
    !member.needsReconfirmation
  ) {
    return {
      ok: true,
      data: { pool, unlockedNow: false, waitlisted: false, metrics: preMetrics },
      state: next,
    };
  }

  // Check cap / waitlist
  if (preMetrics.confirmedUnits + member.quantity > pool.currentOffer.maxQuantity) {
    member.status = 'waitlisted';
    member.needsReconfirmation = false;
    pool.updatedAt = next.demoNow;
    next.updatedAt = next.demoNow;
    const afterWaitlist = computePoolMetrics(pool, next.demoNow);
    return {
      ok: true,
      data: { pool, unlockedNow: false, waitlisted: true, metrics: afterWaitlist },
      state: next,
    };
  }

  member.status = 'confirmed';
  member.confirmedVersion = pool.currentOffer.version;
  member.confirmedAt = next.demoNow;
  member.needsReconfirmation = false;

  const postMetrics = computePoolMetrics(pool, next.demoNow);
  const unlockedNow =
    preMetrics.effectiveStage !== 'unlocked' && postMetrics.effectiveStage === 'unlocked';
  pool.stage = postMetrics.effectiveStage;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  appendActivity(next, {
    poolId: pool.id,
    poolTitle: pool.title,
    kind: unlockedNow ? 'unlocked' : 'confirmed',
    summary: unlockedNow
      ? `${actor.name} confirmed Offer v${pool.currentOffer.version} — ${postMetrics.confirmedUnits} of ${postMetrics.targetMin} ${pool.unitPlural} reached. Group price unlocked!`
      : `${actor.name} confirmed Offer v${pool.currentOffer.version} (${postMetrics.confirmedUnits} of ${postMetrics.targetMin} ${pool.unitPlural} confirmed).`,
  });

  return {
    ok: true,
    data: { pool, unlockedNow, waitlisted: false, metrics: postMetrics },
    state: next,
  };
}

export function withdrawConfirmation(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity
): EngineOutcome<{ pool: Pool; metrics: PoolMetrics }> {
  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool || !pool.currentOffer) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Offer not found.' } };
  }

  const metrics = computePoolMetrics(pool, next.demoNow);
  if (metrics.effectiveStage === 'unlocked') {
    return {
      ok: false,
      error: {
        code: 'ALREADY_LOCKED',
        message: 'Confirmations cannot be withdrawn after the group price has unlocked.',
      },
    };
  }
  if (metrics.effectiveStage === 'expired') {
    return {
      ok: false,
      error: { code: 'OFFER_EXPIRED', message: 'This offer has already closed.' },
    };
  }

  const member = pool.members.find((m) => m.userId === actor.id);
  if (!member || member.status !== 'confirmed') {
    return {
      ok: false,
      error: { code: 'NOT_CONFIRMED', message: 'No active confirmation to withdraw.' },
    };
  }

  member.status = 'interested';
  member.confirmedVersion = undefined;
  member.confirmedAt = undefined;
  member.needsReconfirmation = false;

  const updatedMetrics = computePoolMetrics(pool, next.demoNow);
  pool.stage = updatedMetrics.effectiveStage;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  appendActivity(next, {
    poolId: pool.id,
    poolTitle: pool.title,
    kind: 'withdrawn',
    summary: `${actor.name} withdrew confirmation (${updatedMetrics.confirmedUnits} of ${updatedMetrics.targetMin} ${pool.unitPlural} confirmed).`,
  });

  return { ok: true, data: { pool, metrics: updatedMetrics }, state: next };
}

export function passOffer(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity
): EngineOutcome<{ pool: Pool; metrics: PoolMetrics }> {
  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool || !pool.currentOffer) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Offer not found.' } };
  }

  const metrics = computePoolMetrics(pool, next.demoNow);
  if (metrics.effectiveStage === 'unlocked') {
    return {
      ok: false,
      error: {
        code: 'ALREADY_LOCKED',
        message: 'This offer has already unlocked.',
      },
    };
  }

  const member = pool.members.find((m) => m.userId === actor.id);
  if (!member) {
    return {
      ok: false,
      error: { code: 'INELIGIBLE_MEMBER', message: 'You are not a member of this pool.' },
    };
  }

  member.status = 'passed';
  member.confirmedVersion = undefined;
  member.confirmedAt = undefined;
  member.needsReconfirmation = false;

  const updatedMetrics = computePoolMetrics(pool, next.demoNow);
  pool.stage = updatedMetrics.effectiveStage;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  appendActivity(next, {
    poolId: pool.id,
    poolTitle: pool.title,
    kind: 'passed',
    summary: `${actor.name} passed on Offer v${pool.currentOffer.version}.`,
  });

  return { ok: true, data: { pool, metrics: updatedMetrics }, state: next };
}

export function markBuyerFulfilled(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity
): EngineOutcome<{ pool: Pool; metrics: PoolMetrics }> {
  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool || !pool.currentOffer) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Pool offer not found.' } };
  }

  const access = canAccessClaimRoute(pool, actor.role, actor.id, next.demoNow);
  if (!access.allowed) {
    return {
      ok: false,
      error: {
        code: actor.role !== 'buyer' ? 'FORBIDDEN_ROLE' : 'INVALID_STAGE',
        message: access.reason || 'Fulfillment can only be recorded after the group price unlocks.',
      },
    };
  }

  const member = pool.members.find((m) => m.userId === actor.id)!;
  // Idempotent repeat click
  if (member.status === 'fulfilled') {
    const metrics = computePoolMetrics(pool, next.demoNow);
    return { ok: true, data: { pool, metrics }, state: next };
  }

  member.status = 'fulfilled';
  member.fulfilledAt = next.demoNow;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  const metrics = computePoolMetrics(pool, next.demoNow);
  appendActivity(next, {
    poolId: pool.id,
    poolTitle: pool.title,
    kind: 'fulfilled',
    summary: `${actor.name} marked direct purchase as fulfilled (${metrics.fulfilledUnits} of ${metrics.confirmedUnits} confirmed buyers fulfilled).`,
  });

  return { ok: true, data: { pool, metrics }, state: next };
}

export function toggleFollowPool(
  state: DemoSessionState,
  poolId: string,
  actor: PersonaIdentity
): EngineOutcome<{ pool: Pool; following: boolean }> {
  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Pool not found.' } };
  }

  const idx = pool.followers.indexOf(actor.id);
  let following: boolean;
  if (idx >= 0) {
    pool.followers.splice(idx, 1);
    following = false;
  } else {
    pool.followers.push(actor.id);
    following = true;
    appendActivity(next, {
      poolId: pool.id,
      poolTitle: pool.title,
      kind: 'followed',
      summary: `${actor.name} followed for the next similar group buy.`,
    });
  }

  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;
  return { ok: true, data: { pool, following }, state: next };
}

/**
 * Demo Control Simulation: Records a clearly labeled simulated eligible buyer confirmation
 * so testers can walk through 7/8 -> 8/8 unlock without falsely attributing it to a real person.
 */
export function simulateAnotherConfirmation(
  state: DemoSessionState,
  poolId: string
): EngineOutcome<{ pool: Pool; unlockedNow: boolean; simulatedLabel: string; metrics: PoolMetrics }> {
  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool || !pool.currentOffer) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STAGE',
        message: 'Publish a seller offer first before simulating buyer confirmations.',
      },
    };
  }

  const preMetrics = computePoolMetrics(pool, next.demoNow);
  if (preMetrics.effectiveStage === 'unlocked') {
    return {
      ok: false,
      error: {
        code: 'ALREADY_LOCKED',
        message: 'This pool has already reached minimum and unlocked.',
      },
    };
  }
  if (preMetrics.effectiveStage === 'expired') {
    return {
      ok: false,
      error: { code: 'OFFER_EXPIRED', message: 'This offer has already expired.' },
    };
  }
  if (preMetrics.isCapReached) {
    return {
      ok: false,
      error: { code: 'CAP_REACHED', message: 'Offer cap is already full.' },
    };
  }

  // Find an eligible non-Maya member who hasn't confirmed the current version yet
  let targetMember = pool.members.find((m) => {
    if (m.userId === 'buyer-maya') return false;
    const { eligible } = evaluateMemberEligibility(pool, m);
    if (!eligible) return false;
    return (
      m.status !== 'passed' &&
      (m.status !== 'confirmed' ||
        m.confirmedVersion !== pool.currentOffer!.version ||
        m.needsReconfirmation)
    );
  });

  if (!targetMember) {
    // Add a clearly marked simulated eligible member
    const defaultOptions: Record<string, string> = {};
    for (const g of pool.optionGroups) {
      defaultOptions[g.id] = g.allowedValues[0] || g.allValues[0];
    }
    targetMember = {
      id: makeId('mem-sim'),
      userId: makeId('sim-buyer'),
      displayName: `Demo Buyer #${pool.members.length + 1} [Simulated]`,
      location: pool.location,
      quantity: 1,
      selectedOptions: defaultOptions,
      joinedAt: next.demoNow,
      status: 'interested',
      isSimulated: true,
    };
    pool.members.push(targetMember);
  } else {
    targetMember.isSimulated = true;
    if (!targetMember.displayName.includes('[Simulated]')) {
      targetMember.displayName = `${targetMember.displayName} [Simulated]`;
    }
  }

  targetMember.status = 'confirmed';
  targetMember.confirmedVersion = pool.currentOffer.version;
  targetMember.confirmedAt = next.demoNow;
  targetMember.needsReconfirmation = false;

  const postMetrics = computePoolMetrics(pool, next.demoNow);
  const unlockedNow = postMetrics.effectiveStage === 'unlocked';
  pool.stage = postMetrics.effectiveStage;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  appendActivity(next, {
    poolId: pool.id,
    poolTitle: pool.title,
    kind: unlockedNow ? 'unlocked' : 'confirmed',
    isSimulated: true,
    summary: unlockedNow
      ? `[Simulated action] ${targetMember.displayName} confirmed Offer v${pool.currentOffer.version} — ${postMetrics.confirmedUnits} of ${postMetrics.targetMin} ${pool.unitPlural} confirmed. Group price unlocked.`
      : `[Simulated action] ${targetMember.displayName} confirmed Offer v${pool.currentOffer.version} (${postMetrics.confirmedUnits} of ${postMetrics.targetMin} ${pool.unitPlural} confirmed).`,
  });

  return {
    ok: true,
    data: {
      pool,
      unlockedNow,
      simulatedLabel: targetMember.displayName,
      metrics: postMetrics,
    },
    state: next,
  };
}

/**
 * Demo Control Simulation: Advances demo clock 15 minutes past the target pool's offer close time.
 */
export function advanceClockPastDeadline(
  state: DemoSessionState,
  poolId: string
): EngineOutcome<{ pool: Pool; newDemoNow: string; metrics: PoolMetrics }> {
  const next = cloneState(state);
  const pool = next.pools.find((p) => p.id === poolId);
  if (!pool || !pool.currentOffer) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STAGE',
        message: 'No active offer deadline to advance past on this pool.',
      },
    };
  }

  const closeMs = Date.parse(pool.currentOffer.closeAt);
  const pastIso = new Date(closeMs + 15 * 60 * 1000).toISOString();
  next.demoNow = pastIso;

  const metrics = computePoolMetrics(pool, next.demoNow);
  pool.stage = metrics.effectiveStage;
  pool.updatedAt = next.demoNow;
  next.updatedAt = next.demoNow;

  if (metrics.effectiveStage === 'expired') {
    appendActivity(next, {
      poolId: pool.id,
      poolTitle: pool.title,
      kind: 'expired',
      isSimulated: true,
      summary: `[Simulated clock] Offer v${pool.currentOffer.version} closed at ${metrics.confirmedUnits} of ${metrics.targetMin} ${pool.unitPlural} confirmed — expired short of minimum.`,
    });
  }

  return {
    ok: true,
    data: { pool, newDemoNow: pastIso, metrics },
    state: next,
  };
}

/**
 * Demo Control Simulation: Triggers a seller term revision (v+1) requiring reconfirmation.
 */
export function simulateSellerTermRevision(
  state: DemoSessionState,
  poolId: string,
  sellerActor: PersonaIdentity
): EngineOutcome<{ pool: Pool; offer: SellerOffer }> {
  const pool = state.pools.find((p) => p.id === poolId);
  if (!pool || !pool.currentOffer || !pool.sellerToken) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STAGE',
        message: 'Publish an initial offer first before simulating revised seller terms.',
      },
    };
  }

  const cur = pool.currentOffer;
  const revisedUnitPrice = Math.max(100, cur.unitPrice - 150);
  const revisedCloseIso = new Date(Date.parse(cur.closeAt) + 24 * 60 * 60 * 1000).toISOString();

  const res = publishOrReviseSellerOffer(state, pool.sellerToken, sellerActor, {
    sellerName: cur.sellerName,
    sellerLocation: cur.sellerLocation,
    matchingScope: cur.matchingScope,
    currency: cur.currency,
    unitPrice: revisedUnitPrice,
    knownFees: cur.knownFees,
    feeLabel: cur.feeLabel,
    taxAndRegistrationNote: cur.taxAndRegistrationNote,
    minQuantity: cur.minQuantity,
    maxQuantity: cur.maxQuantity,
    fulfillmentMethod: cur.fulfillmentMethod,
    closeAt: revisedCloseIso,
    timezoneLabel: cur.timezoneLabel,
    claimByDate: cur.claimByDate,
    privateClaimInstructions: cur.privateClaimInstructions,
    revisionSummary: `[Simulated seller update] Price reduced by $150 ($${cur.unitPrice.toLocaleString()} → $${revisedUnitPrice.toLocaleString()}) and deadline extended 24h. Reconfirmation required.`,
  });

  if (!res.ok) return res;
  return {
    ok: true,
    data: { pool: res.data.pool, offer: res.data.offer },
    state: res.state,
  };
}

/**
 * Replaces ONLY the synthetic Ford Maverick XLT fixture and its own walkthrough activity,
 * preserving unrelated pools, custom user-created pools, memberships, and unrelated activity.
 */
export function applyFordScenario(
  state: DemoSessionState,
  scenarioId: DemoScenarioId
): DemoSessionState {
  const next = cloneState(state);
  const demoNow =
    scenarioId === 'missed-deadline' ? MAVERICK_EXPIRED_DEMO_NOW : DEFAULT_DEMO_NOW;

  const freshMaverick = buildMaverickPool(scenarioId);
  const existingIdx = next.pools.findIndex((p) => p.id === 'pool-maverick-xlt');
  if (existingIdx >= 0) {
    next.pools[existingIdx] = freshMaverick;
  } else {
    next.pools.unshift(freshMaverick);
  }

  // Keep all activity for unrelated / custom pools; replace only Ford Maverick fixture events
  const preservedActivity = next.activity.filter((ev) => ev.poolId !== 'pool-maverick-xlt');
  next.activity = [buildMaverickScenarioActivity(scenarioId, demoNow), ...preservedActivity].slice(
    0,
    40
  );

  next.scenarioId = scenarioId;
  next.demoNow = demoNow;
  next.updatedAt = demoNow;

  return next;
}
