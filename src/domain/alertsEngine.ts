import {
  POOL_CATEGORIES,
  type AlertNotification,
  type CreateItemAlertInput,
  type DemoSessionState,
  type EngineOutcome,
  type ItemAlertStatus,
  type PersonaIdentity,
  type Pool,
  type PoolCategory,
  type SavedItemAlert,
  type UpdateItemAlertInput,
} from './types.ts';

const VALID_CATEGORIES = new Set<string>(POOL_CATEGORIES);
const VALID_ALERT_STATUSES = new Set<string>(['active', 'paused', 'archived']);
const MAX_ALERTS_PER_OWNER = 50;
const MAX_NOTIFICATIONS_PER_SESSION = 300;

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneState(state: DemoSessionState): DemoSessionState {
  const copy = JSON.parse(JSON.stringify(state)) as DemoSessionState;
  return migrateSessionState(copy);
}

/**
 * Migrates older persisted session snapshots that may lack alerts/notifications arrays,
 * preserving all existing seed and custom pools and activity.
 */
export function migrateSessionState(
  raw: Omit<DemoSessionState, 'alerts' | 'notifications'> &
    Partial<Pick<DemoSessionState, 'alerts' | 'notifications'>>
): DemoSessionState {
  const alerts: SavedItemAlert[] = Array.isArray(raw.alerts)
    ? raw.alerts.filter(
        (a): a is SavedItemAlert =>
          Boolean(a) &&
          typeof a.id === 'string' &&
          typeof a.ownerId === 'string' &&
          typeof a.query === 'string' &&
          VALID_ALERT_STATUSES.has(a.status)
      )
    : [];

  const notifications: AlertNotification[] = Array.isArray(raw.notifications)
    ? raw.notifications.filter(
        (n): n is AlertNotification =>
          Boolean(n) &&
          typeof n.id === 'string' &&
          typeof n.ownerId === 'string' &&
          typeof n.poolId === 'string' &&
          typeof n.poolTitle === 'string'
      )
    : [];

  return {
    ...raw,
    alerts,
    notifications,
  };
}

/**
 * Normalizes text into lowercase whole-word alphanumeric tokens.
 * Strips combining diacritics and treats punctuation/separators as word boundaries,
 * preventing arbitrary substring matches (e.g., "port" vs "portland", "xlt" vs "exlt").
 */
export function normalizeMatchTokens(text: string): string[] {
  if (typeof text !== 'string') return [];
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Returns true if needle tokens appear as a contiguous whole-word phrase
 * inside haystack tokens.
 */
export function containsContiguousTokens(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Extracts normalized whole-word item tokens from a pool's title and structured item options.
 * Intentionally excludes free-form descriptions (subtitle, organizerNote, sharedRequirements,
 * discussion) and excluded option values so description-only matches never trigger alerts.
 */
export function extractPoolItemTokens(pool: Pool): Set<string> {
  const tokenSet = new Set<string>();
  for (const token of normalizeMatchTokens(pool.title)) {
    tokenSet.add(token);
  }
  if (Array.isArray(pool.optionGroups)) {
    for (const group of pool.optionGroups) {
      if (group.id === 'delivery') continue;
      if (!Array.isArray(group.allowedValues)) continue;
      for (const val of group.allowedValues) {
        if (typeof val !== 'string' || val.toLowerCase().includes('(excluded)')) continue;
        for (const token of normalizeMatchTokens(val)) {
          tokenSet.add(token);
        }
      }
    }
  }
  return tokenSet;
}

/**
 * Evaluates whether a saved alert's criteria match a newly opened pool.
 * - Required item query: all normalized whole-word terms must appear in pool title or structured item options.
 * - Optional category: exact match when set.
 * - Optional city: normalized whole-word contiguous phrase match against pool.location when set.
 */
export function doesAlertCriteriaMatchPool(
  criteria: Pick<SavedItemAlert, 'query' | 'category' | 'city'>,
  pool: Pool
): boolean {
  const queryTokens = normalizeMatchTokens(criteria.query);
  if (queryTokens.length === 0) return false;

  if (criteria.category && pool.category !== criteria.category) {
    return false;
  }

  if (criteria.city && criteria.city.trim().length > 0) {
    const cityTokens = normalizeMatchTokens(criteria.city);
    if (cityTokens.length === 0) return false;
    const poolLocationTokens = normalizeMatchTokens(pool.location || '');
    if (!containsContiguousTokens(poolLocationTokens, cityTokens)) {
      return false;
    }
  }

  const poolItemTokens = extractPoolItemTokens(pool);
  for (const term of queryTokens) {
    if (!poolItemTokens.has(term)) {
      return false;
    }
  }

  return true;
}

export function doesAlertMatchPool(alert: SavedItemAlert, pool: Pool): boolean {
  if (alert.status !== 'active') return false;
  return doesAlertCriteriaMatchPool(alert, pool);
}

/**
 * Canonical equivalence key for preventing accidental duplicate active alerts.
 * Order-insensitive over unique normalized item terms, exact category, normalized city phrase.
 */
export function computeAlertEquivalenceKey(
  query: string,
  category?: PoolCategory,
  city?: string
): string {
  const uniqueQueryTerms = Array.from(new Set(normalizeMatchTokens(query))).sort().join(' ');
  const catKey = category ?? '';
  const cityKey = normalizeMatchTokens(city ?? '').join(' ');
  return `${uniqueQueryTerms}||${catKey}||${cityKey}`;
}

function formatAlertSummaryLabel(alert: SavedItemAlert): string {
  const parts = [`"${alert.query}"`];
  if (alert.category) parts.push(alert.category);
  if (alert.city) parts.push(alert.city);
  return parts.join(' · ');
}

function normalizeAndValidateAlertFields(input: {
  query: unknown;
  category: unknown;
  city: unknown;
}):
  | { ok: true; query: string; category?: PoolCategory; city?: string }
  | { ok: false; message: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};

  const rawQuery = typeof input.query === 'string' ? input.query.trim().replace(/\s+/g, ' ') : '';
  const queryTokens = normalizeMatchTokens(rawQuery);
  if (rawQuery.length < 2 || queryTokens.length === 0) {
    fieldErrors.query = 'Enter an item name or model keyword (at least 2 characters).';
  } else if (rawQuery.length > 120) {
    fieldErrors.query = 'Keep the item query under 120 characters.';
  }

  let category: PoolCategory | undefined;
  if (input.category !== undefined && input.category !== null && input.category !== '') {
    if (typeof input.category !== 'string' || !VALID_CATEGORIES.has(input.category)) {
      fieldErrors.category = 'Select a valid Tally category or leave as Any category.';
    } else {
      category = input.category as PoolCategory;
    }
  }

  let city: string | undefined;
  if (input.city !== undefined && input.city !== null && input.city !== '') {
    if (typeof input.city !== 'string') {
      fieldErrors.city = 'City must be text or left blank for any city.';
    } else {
      const cleanCity = input.city.trim().replace(/\s+/g, ' ');
      if (cleanCity.length > 0) {
        if (cleanCity.length > 80) {
          fieldErrors.city = 'Keep the city name under 80 characters.';
        } else if (normalizeMatchTokens(cleanCity).length === 0) {
          fieldErrors.city = 'Enter a valid city name or leave blank for any city.';
        } else {
          city = cleanCity;
        }
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: 'Fix the highlighted alert fields before saving.',
      fieldErrors,
    };
  }

  return { ok: true, query: rawQuery, category, city };
}

function findEquivalentActiveAlert(
  alerts: SavedItemAlert[],
  ownerId: string,
  query: string,
  category?: PoolCategory,
  city?: string,
  excludeAlertId?: string
): SavedItemAlert | undefined {
  const key = computeAlertEquivalenceKey(query, category, city);
  return alerts.find(
    (a) =>
      a.ownerId === ownerId &&
      a.status === 'active' &&
      a.id !== excludeAlertId &&
      computeAlertEquivalenceKey(a.query, a.category, a.city) === key
  );
}

/**
 * Runs on the validated new-pool write path only.
 * Creates at most ONE inbox notification per (ownerId, pool.id), even when multiple
 * active alerts overlap, and never notifies the actor who created the pool.
 */
export function dispatchAlertsForNewPool(
  state: DemoSessionState,
  pool: Pool,
  creatorId: string
): AlertNotification[] {
  if (!Array.isArray(state.alerts)) state.alerts = [];
  if (!Array.isArray(state.notifications)) state.notifications = [];

  const matchesByOwner = new Map<string, SavedItemAlert[]>();

  for (const alert of state.alerts) {
    if (alert.status !== 'active') continue;
    if (alert.ownerId === creatorId) continue;
    if (!doesAlertCriteriaMatchPool(alert, pool)) continue;

    const bucket = matchesByOwner.get(alert.ownerId) ?? [];
    bucket.push(alert);
    matchesByOwner.set(alert.ownerId, bucket);
  }

  const created: AlertNotification[] = [];

  for (const [ownerId, matchedAlerts] of matchesByOwner.entries()) {
    // One inbox match per buyer and pool (protects against overlap or repeated dispatch)
    const alreadyExists = state.notifications.some(
      (n) => n.ownerId === ownerId && n.poolId === pool.id
    );
    if (alreadyExists) continue;

    const primary = matchedAlerts[0];
    const extraCount = matchedAlerts.length - 1;
    const summary =
      extraCount > 0
        ? `${formatAlertSummaryLabel(primary)} (+${extraCount} more ${extraCount === 1 ? 'alert' : 'alerts'})`
        : formatAlertSummaryLabel(primary);

    const notification: AlertNotification = {
      id: makeId('notif'),
      ownerId,
      poolId: pool.id,
      poolTitle: pool.title,
      poolCategory: pool.category,
      poolLocation: pool.location,
      matchedAlertIds: matchedAlerts.map((a) => a.id),
      matchedAlertSummary: summary,
      createdAt: state.demoNow,
    };

    state.notifications.unshift(notification);
    created.push(notification);
  }

  if (state.notifications.length > MAX_NOTIFICATIONS_PER_SESSION) {
    state.notifications = state.notifications.slice(0, MAX_NOTIFICATIONS_PER_SESSION);
  }

  return created;
}

export function createItemAlert(
  state: DemoSessionState,
  actor: PersonaIdentity,
  input: CreateItemAlertInput
): EngineOutcome<{ alert: SavedItemAlert }> {
  const validated = normalizeAndValidateAlertFields({
    query: input?.query,
    category: input?.category,
    city: input?.city,
  });

  if (!validated.ok) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: validated.message,
        fieldErrors: validated.fieldErrors,
      },
    };
  }

  const next = cloneState(state);

  const ownerActiveOrPausedCount = next.alerts.filter(
    (a) => a.ownerId === actor.id && a.status !== 'archived'
  ).length;
  if (ownerActiveOrPausedCount >= MAX_ALERTS_PER_OWNER) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `You can keep up to ${MAX_ALERTS_PER_OWNER} saved alerts at once. Archive unused alerts first.`,
      },
    };
  }

  const duplicate = findEquivalentActiveAlert(
    next.alerts,
    actor.id,
    validated.query,
    validated.category,
    validated.city
  );
  if (duplicate) {
    return {
      ok: false,
      error: {
        code: 'DUPLICATE_ALERT',
        message: `You already have an active alert matching ${formatAlertSummaryLabel(duplicate)}.`,
        fieldErrors: {
          query: 'An equivalent active alert already exists.',
        },
      },
    };
  }

  const alert: SavedItemAlert = {
    id: makeId('alert'),
    ownerId: actor.id,
    query: validated.query,
    category: validated.category,
    city: validated.city,
    status: 'active',
    createdAt: next.demoNow,
    updatedAt: next.demoNow,
    lastActivatedAt: next.demoNow,
  };

  // Prospective only — never backfill notifications for already-open pools
  next.alerts.unshift(alert);
  next.updatedAt = next.demoNow;

  return { ok: true, data: { alert }, state: next };
}

export function updateItemAlert(
  state: DemoSessionState,
  alertId: string,
  actor: PersonaIdentity,
  input: UpdateItemAlertInput
): EngineOutcome<{ alert: SavedItemAlert }> {
  const next = cloneState(state);
  const idx = next.alerts.findIndex((a) => a.id === alertId);
  if (idx < 0) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Saved alert not found.' } };
  }

  const existing = next.alerts[idx];
  if (existing.ownerId !== actor.id) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_ROLE',
        message: 'You can only modify your own saved alerts.',
      },
    };
  }

  const nextStatus: ItemAlertStatus =
    input.status !== undefined ? input.status : existing.status;

  if (!VALID_ALERT_STATUSES.has(nextStatus)) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid alert status.' },
    };
  }

  const hasCriteriaUpdate =
    input.query !== undefined || input.category !== undefined || input.city !== undefined;

  if (existing.status === 'archived' && hasCriteriaUpdate && nextStatus === 'archived') {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Restore an archived alert before editing its search criteria.',
      },
    };
  }

  const candidateQuery = input.query !== undefined ? input.query : existing.query;
  const candidateCategory =
    input.category !== undefined
      ? input.category === '' || input.category === null
        ? undefined
        : input.category
      : existing.category;
  const candidateCity =
    input.city !== undefined
      ? input.city === null
        ? ''
        : input.city
      : existing.city ?? '';

  const validated = normalizeAndValidateAlertFields({
    query: candidateQuery,
    category: candidateCategory,
    city: candidateCity,
  });

  if (!validated.ok) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: validated.message,
        fieldErrors: validated.fieldErrors,
      },
    };
  }

  if (nextStatus === 'active') {
    const duplicate = findEquivalentActiveAlert(
      next.alerts,
      actor.id,
      validated.query,
      validated.category,
      validated.city,
      existing.id
    );
    if (duplicate) {
      return {
        ok: false,
        error: {
          code: 'DUPLICATE_ALERT',
          message: `Another active alert already matches ${formatAlertSummaryLabel(duplicate)}.`,
          fieldErrors: {
            query: 'An equivalent active alert already exists.',
          },
        },
      };
    }
  }

  const updated: SavedItemAlert = {
    ...existing,
    query: validated.query,
    category: validated.category,
    city: validated.city,
    status: nextStatus,
    updatedAt: next.demoNow,
    pausedAt:
      nextStatus === 'paused'
        ? existing.status === 'paused'
          ? existing.pausedAt
          : next.demoNow
        : undefined,
    archivedAt:
      nextStatus === 'archived'
        ? existing.status === 'archived'
          ? existing.archivedAt
          : next.demoNow
        : undefined,
    lastActivatedAt:
      nextStatus === 'active' && (existing.status !== 'active' || hasCriteriaUpdate)
        ? next.demoNow
        : existing.lastActivatedAt,
  };

  // Prospective only — never backfill notifications; preserve all historical inbox items untouched
  next.alerts[idx] = updated;
  next.updatedAt = next.demoNow;

  return { ok: true, data: { alert: updated }, state: next };
}

export function markNotificationRead(
  state: DemoSessionState,
  notificationId: string,
  actor: PersonaIdentity
): EngineOutcome<{ notification: AlertNotification }> {
  const next = cloneState(state);
  const notif = next.notifications.find((n) => n.id === notificationId);
  if (!notif) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Notification not found.' } };
  }
  if (notif.ownerId !== actor.id) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_ROLE',
        message: 'You can only update your own notifications.',
      },
    };
  }

  if (!notif.readAt) {
    notif.readAt = next.demoNow;
    next.updatedAt = next.demoNow;
  }

  return { ok: true, data: { notification: notif }, state: next };
}

export function markAllNotificationsRead(
  state: DemoSessionState,
  actor: PersonaIdentity
): EngineOutcome<{ markedCount: number }> {
  const next = cloneState(state);
  let markedCount = 0;

  for (const notif of next.notifications) {
    if (notif.ownerId === actor.id && !notif.readAt) {
      notif.readAt = next.demoNow;
      markedCount += 1;
    }
  }

  if (markedCount > 0) {
    next.updatedAt = next.demoNow;
  }

  return { ok: true, data: { markedCount }, state: next };
}

export function getViewerAlertsAndInbox(
  state: DemoSessionState,
  ownerId: string
): {
  alerts: SavedItemAlert[];
  notifications: AlertNotification[];
  unreadAlertCount: number;
} {
  const safe = migrateSessionState(state);
  const alerts = safe.alerts.filter((a) => a.ownerId === ownerId);
  const notifications = safe.notifications.filter((n) => n.ownerId === ownerId);
  const unreadAlertCount = notifications.filter((n) => !n.readAt).length;
  return { alerts, notifications, unreadAlertCount };
}
