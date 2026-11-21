import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  createItemAlert,
  getViewerAlertsAndInbox,
  markAllNotificationsRead,
  markNotificationRead,
  migrateSessionState,
  updateItemAlert,
} from './src/domain/alertsEngine.ts';
import { findSimilarPoolsInSession } from './src/domain/competingPoolsEngine.ts';
import { createSeedSession, PERSONAS } from './src/domain/seedData.ts';
import {
  advanceClockPastDeadline,
  applyFordScenario,
  canAccessClaimRoute,
  canAccessSellerRoute,
  canManagePool,
  computePoolMetrics,
  confirmOffer,
  createPool,
  joinOrUpdatePool,
  leavePool,
  markBuyerFulfilled,
  passOffer,
  postDiscussionMessage,
  publishOrReviseSellerOffer,
  recalculatePoolDemand,
  requestSellerQuote,
  sanitizePoolForRole,
  simulateAnotherConfirmation,
  simulateSellerTermRevision,
  toggleFollowPool,
  withdrawConfirmation,
} from './src/domain/tallyEngine.ts';
import {
  POOL_CATEGORIES,
  type DemoScenarioId,
  type DemoSessionState,
  type PersonaRole,
  type PoolCategory,
  type PoolSpecField,
} from './src/domain/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '.tally-data');
const STORE_FILE = path.resolve(DATA_DIR, 'sessions.json');
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{3,48}$/;
const VALID_SCENARIOS: ReadonlySet<string> = new Set([
  'gathering-7-of-8',
  'ready-for-quote',
  'reviewing-6-of-8',
  'just-unlocked',
  'missed-deadline',
]);
const VALID_ROLES: ReadonlySet<string> = new Set(['buyer', 'organizer', 'seller']);

// In-memory cache backed by atomic JSON file persistence on disk
const sessions = new Map<string, DemoSessionState>();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStoreFromDisk(): void {
  try {
    ensureDataDir();
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, DemoSessionState>;
    for (const [key, val] of Object.entries(parsed)) {
      if (SESSION_ID_RE.test(key) && val && Array.isArray(val.pools)) {
        sessions.set(key, migrateSessionState(val));
      }
    }
  } catch (err) {
    console.error('[tally-store] Failed to read persisted store, starting fresh:', err);
  }
}

function persistStoreToDisk(): void {
  try {
    ensureDataDir();
    // Bound max stored demo sessions to prevent unbounded disk growth
    if (sessions.size > 200) {
      const oldest = Array.from(sessions.entries())
        .sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt))
        .slice(0, sessions.size - 200);
      for (const [key] of oldest) {
        sessions.delete(key);
      }
    }
    const obj: Record<string, DemoSessionState> = {};
    for (const [k, v] of sessions.entries()) {
      obj[k] = v;
    }
    const tmpFile = `${STORE_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmpFile, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmpFile, STORE_FILE);
  } catch (err) {
    console.error('[tally-store] Failed to persist store:', err);
  }
}

function getOrCreateSession(sessionId: string): DemoSessionState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const fresh = createSeedSession(sessionId, 'gathering-7-of-8');
  sessions.set(sessionId, fresh);
  persistStoreToDisk();
  return fresh;
}

function saveSession(state: DemoSessionState): void {
  sessions.set(state.sessionId, state);
  persistStoreToDisk();
}

function parseSessionId(req: express.Request): string | null {
  const headerVal = req.header('x-tally-session');
  const queryVal = typeof req.query.session === 'string' ? req.query.session : undefined;
  const candidate = (headerVal || queryVal || '').trim();
  if (!SESSION_ID_RE.test(candidate)) return null;
  return candidate;
}

function parseRole(req: express.Request): PersonaRole {
  const raw = (req.header('x-tally-role') || 'buyer').trim().toLowerCase();
  if (VALID_ROLES.has(raw)) {
    return raw as PersonaRole;
  }
  return 'buyer';
}

function buildClientSessionResponse(state: DemoSessionState, role: PersonaRole) {
  const safeState = migrateSessionState(state);
  const actor = PERSONAS[role];
  const { alerts, notifications, unreadAlertCount } = getViewerAlertsAndInbox(safeState, actor.id);
  return {
    sessionId: safeState.sessionId,
    scenarioId: safeState.scenarioId,
    demoNow: safeState.demoNow,
    role,
    actor: {
      id: actor.id,
      role: actor.role,
      name: actor.name,
      shortLabel: actor.shortLabel,
      location: actor.location,
    },
    pools: safeState.pools.map((pool) => ({
      ...sanitizePoolForRole(pool, role, actor.id, safeState.demoNow),
      metrics: computePoolMetrics(pool, safeState.demoNow),
    })),
    activity: safeState.activity,
    alerts,
    notifications,
    unreadAlertCount,
    updatedAt: safeState.updatedAt,
  };
}

function statusFromErrorCode(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN_ROLE':
      return 403;
    case 'VALIDATION_ERROR':
      return 400;
    case 'DUPLICATE_ALERT':
    case 'STALE_OFFER_VERSION':
    case 'OFFER_EXPIRED':
    case 'CAP_REACHED':
    case 'ALREADY_LOCKED':
    case 'INVALID_STAGE':
    case 'INELIGIBLE_MEMBER':
    case 'NOT_CONFIRMED':
      return 409;
    default:
      return 400;
  }
}

async function startServer() {
  loadStoreFromDisk();

  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // Health route
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, persistence: 'server-disk-json' });
  });

  // Require valid isolated session ID on all /api/state routes
  function withSession(
    handler: (
      req: express.Request,
      res: express.Response,
      state: DemoSessionState,
      role: PersonaRole
    ) => void
  ) {
    return (req: express.Request, res: express.Response) => {
      const sessionId = parseSessionId(req);
      if (!sessionId) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing or invalid demo session identifier.',
          },
        });
        return;
      }
      const role = parseRole(req);
      const state = getOrCreateSession(sessionId);
      handler(req, res, state, role);
    };
  }

  // Get full sanitized session state
  app.get(
    '/api/session',
    withSession((_req, res, state, role) => {
      res.json(buildClientSessionResponse(state, role));
    })
  );

  // Switch deterministic seed scenario (for this session only)
  app.post(
    '/api/session/scenario',
    withSession((req, res, state, role) => {
      const scenarioId = typeof req.body?.scenarioId === 'string' ? req.body.scenarioId : '';
      if (!VALID_SCENARIOS.has(scenarioId)) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Unknown demo scenario.' },
        });
        return;
      }
      const updated = applyFordScenario(state, scenarioId as DemoScenarioId);
      saveSession(updated);
      res.json(buildClientSessionResponse(updated, role));
    })
  );

  // Reset only the current demo session
  app.post(
    '/api/session/reset',
    withSession((_req, res, state, role) => {
      const fresh = createSeedSession(state.sessionId, state.scenarioId);
      saveSession(fresh);
      res.json(buildClientSessionResponse(fresh, role));
    })
  );

  // Create a new pool (also runs prospective item-alert matching on the same validated write path)
  app.post(
    '/api/pools',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const headerReqId = req.header('idempotency-key');
      const bodyPayload =
        req.body && typeof req.body === 'object' ? { ...req.body } : {};
      if (typeof headerReqId === 'string' && headerReqId.trim().length > 0 && !bodyPayload.clientRequestId) {
        bodyPayload.clientRequestId = headerReqId.trim();
      }
      const outcome = createPool(state, actor, bodyPayload);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      if (!outcome.data.deduplicated) {
        saveSession(outcome.state);
      }
      res.status(outcome.data.deduplicated ? 200 : 201).json({
        poolId: outcome.data.pool.id,
        deduplicated: Boolean(outcome.data.deduplicated),
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Check for existing similar / competing pools within the current isolated session
  app.post(
    '/api/pools/similar',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : '';
      if (title.length < 2) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Enter a product or pool title before checking for similar pools.',
            fieldErrors: { title: 'Enter at least 2 characters to check for similar pools.' },
          },
        });
        return;
      }

      const rawCat = typeof body.category === 'string' ? body.category.trim() : '';
      let category: PoolCategory | undefined;
      if (rawCat) {
        if (!POOL_CATEGORIES.includes(rawCat as PoolCategory)) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Unknown pool category.',
              fieldErrors: { category: 'Select a valid Tally category.' },
            },
          });
          return;
        }
        category = rawCat as PoolCategory;
      }

      const location =
        typeof body.location === 'string' ? body.location.trim().slice(0, 100) : undefined;
      const goalDate =
        typeof body.goalDate === 'string' ? body.goalDate.trim().slice(0, 20) : undefined;
      const modelOrVariant =
        typeof body.modelOrVariant === 'string'
          ? body.modelOrVariant.trim().slice(0, 120)
          : undefined;
      const excludePoolId =
        typeof body.excludePoolId === 'string' ? body.excludePoolId.trim().slice(0, 80) : undefined;
      const primaryOptionValues = Array.isArray(body.primaryOptionValues)
        ? body.primaryOptionValues
            .filter((v: unknown): v is string => typeof v === 'string')
            .map((v: string) => v.trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 12)
        : undefined;
      const categorySpecs: PoolSpecField[] | undefined = Array.isArray(body.categorySpecs)
        ? body.categorySpecs
            .filter(
              (s: unknown): s is PoolSpecField =>
                Boolean(s) &&
                typeof (s as PoolSpecField).label === 'string' &&
                typeof (s as PoolSpecField).value === 'string'
            )
            .map((s: PoolSpecField) => ({
              label: s.label.trim().slice(0, 60),
              value: s.value.trim().slice(0, 120),
            }))
            .filter((s: PoolSpecField) => s.label && s.value)
            .slice(0, 12)
        : undefined;

      const candidates = findSimilarPoolsInSession(state, role, actor.id, {
        category,
        title,
        location,
        goalDate,
        modelOrVariant,
        primaryOptionValues,
        categorySpecs,
        excludePoolId,
        includeUnavailable: body.includeUnavailable !== false,
      });

      res.json({
        candidates,
        checkedPoolCount: state.pools.length,
        checkedAt: state.demoNow,
      });
    })
  );

  // Saved item alerts & notifications (owner-scoped to current viewer persona)
  app.get(
    '/api/alerts',
    withSession((_req, res, state, role) => {
      const actor = PERSONAS[role];
      res.json(getViewerAlertsAndInbox(state, actor.id));
    })
  );

  app.post(
    '/api/alerts',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const outcome = createItemAlert(state, actor, {
        query: typeof req.body?.query === 'string' ? req.body.query : '',
        category: req.body?.category,
        city: typeof req.body?.city === 'string' ? req.body.city : undefined,
      });
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.status(201).json({
        alert: outcome.data.alert,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  app.patch(
    '/api/alerts/:id',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const outcome = updateItemAlert(state, String(req.params.id), actor, {
        ...(Object.prototype.hasOwnProperty.call(body, 'query') ? { query: body.query } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, 'category') ? { category: body.category } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, 'city') ? { city: body.city } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, 'status') ? { status: body.status } : {}),
      });
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        alert: outcome.data.alert,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  app.post(
    '/api/notifications/:id/read',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const outcome = markNotificationRead(state, String(req.params.id), actor);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        notification: outcome.data.notification,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  app.post(
    '/api/notifications/read-all',
    withSession((_req, res, state, role) => {
      const actor = PERSONAS[role];
      const outcome = markAllNotificationsRead(state, actor);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      if (outcome.data.markedCount > 0) {
        saveSession(outcome.state);
      }
      res.json({
        markedCount: outcome.data.markedCount,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Join or edit membership in a pool
  app.post(
    '/api/pools/:id/join',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const outcome = joinOrUpdatePool(state, String(req.params.id), actor, {
        quantity: Number(req.body?.quantity),
        selectedOptions:
          req.body?.selectedOptions && typeof req.body.selectedOptions === 'object'
            ? req.body.selectedOptions
            : {},
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      });
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        eligibility: outcome.data.eligibility,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Leave a pool
  app.post(
    '/api/pools/:id/leave',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const outcome = leavePool(state, String(req.params.id), actor);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({ session: buildClientSessionResponse(outcome.state, role) });
    })
  );

  // Post discussion message
  app.post(
    '/api/pools/:id/discussion',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const body = typeof req.body?.body === 'string' ? req.body.body : '';
      const isOrganizerUpdate = Boolean(req.body?.isOrganizerUpdate);
      const outcome = postDiscussionMessage(
        state,
        String(req.params.id),
        actor,
        body,
        isOrganizerUpdate
      );
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({ session: buildClientSessionResponse(outcome.state, role) });
    })
  );

  // Organizer: Recalculate eligible demand (Pool-owner protected)
  app.post(
    '/api/pools/:id/organize/recalculate',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const targetPool = state.pools.find((p) => p.id === String(req.params.id));
      if (!targetPool) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pool not found.' } });
        return;
      }
      if (!canManagePool(targetPool, actor.id)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN_ROLE',
            message: `Only ${targetPool.organizerName} (this pool's organizer) can manage this workspace.`,
          },
        });
        return;
      }
      const outcome = recalculatePoolDemand(state, String(req.params.id), actor);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        metrics: outcome.data.metrics,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Organizer: Create / share private seller request link (Pool-owner protected)
  app.post(
    '/api/pools/:id/organize/request-quote',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const targetPool = state.pools.find((p) => p.id === String(req.params.id));
      if (!targetPool) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pool not found.' } });
        return;
      }
      if (!canManagePool(targetPool, actor.id)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN_ROLE',
            message: `Only ${targetPool.organizerName} (this pool's organizer) can create a seller request.`,
          },
        });
        return;
      }
      const outcome = requestSellerQuote(state, String(req.params.id), actor);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        sellerToken: outcome.data.sellerToken,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Seller: Read private aggregate request packet (Strictly role-protected)
  app.get(
    '/api/seller/:token',
    withSession((req, res, state, role) => {
      if (!canAccessSellerRoute(role)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN_ROLE',
            message:
              'This private seller quote link is restricted to the Seller role. Switch to Seller in Demo controls to review and quote this request.',
          },
        });
        return;
      }
      const token = String(req.params.token);
      const pool = state.pools.find((p) => p.sellerToken === token);
      if (!pool) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Seller quote request not found.' },
        });
        return;
      }
      const metrics = computePoolMetrics(pool, state.demoNow);
      // Aggregate-only seller packet — zero individual member names or contact info
      res.json({
        poolId: pool.id,
        title: pool.title,
        subtitle: pool.subtitle,
        category: pool.category,
        location: pool.location,
        deliveryOrDestination: pool.deliveryOrDestination,
        unitSingular: pool.unitSingular,
        unitPlural: pool.unitPlural,
        minQuantity: pool.minQuantity,
        maxQuantity: pool.maxQuantity,
        goalDate: pool.goalDate,
        sharedRequirements: pool.sharedRequirements,
        categorySpecs: pool.categorySpecs,
        organizerName: pool.organizerName,
        organizerNote: pool.organizerNote,
        quoteRequestedAt: pool.quoteRequestedAt,
        currentOffer: pool.currentOffer,
        offerHistory: pool.offerHistory,
        metrics,
        demoNow: state.demoNow,
      });
    })
  );

  // Seller: Publish or revise conditional offer (Strictly role-protected)
  app.post(
    '/api/seller/:token/offer',
    withSession((req, res, state, role) => {
      if (!canAccessSellerRoute(role)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN_ROLE',
            message: 'Seller role required to publish or revise quotes.',
          },
        });
        return;
      }
      const actor = PERSONAS[role];
      const outcome = publishOrReviseSellerOffer(state, String(req.params.token), actor, {
        sellerName: String(req.body?.sellerName ?? ''),
        sellerLocation: String(req.body?.sellerLocation ?? ''),
        matchingScope: String(req.body?.matchingScope ?? ''),
        currency: 'USD',
        unitPrice: Number(req.body?.unitPrice),
        knownFees: Number(req.body?.knownFees),
        feeLabel: String(req.body?.feeLabel ?? ''),
        taxAndRegistrationNote: String(req.body?.taxAndRegistrationNote ?? ''),
        minQuantity: Number(req.body?.minQuantity),
        maxQuantity: Number(req.body?.maxQuantity),
        fulfillmentMethod: String(req.body?.fulfillmentMethod ?? ''),
        closeAt: String(req.body?.closeAt ?? ''),
        timezoneLabel: String(req.body?.timezoneLabel ?? 'Pacific'),
        claimByDate: String(req.body?.claimByDate ?? ''),
        privateClaimInstructions: String(req.body?.privateClaimInstructions ?? ''),
        revisionSummary:
          typeof req.body?.revisionSummary === 'string' ? req.body.revisionSummary : undefined,
      });
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        offer: outcome.data.offer,
        isRevision: outcome.data.isRevision,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Buyer: Confirm active offer version
  app.post(
    '/api/pools/:id/offer/confirm',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const expectedVersion = Number(req.body?.offerVersion);
      const outcome = confirmOffer(state, String(req.params.id), actor, expectedVersion);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        unlockedNow: outcome.data.unlockedNow,
        waitlisted: outcome.data.waitlisted,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Buyer: Withdraw confirmation before unlock
  app.post(
    '/api/pools/:id/offer/withdraw',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const outcome = withdrawConfirmation(state, String(req.params.id), actor);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({ session: buildClientSessionResponse(outcome.state, role) });
    })
  );

  // Buyer: Pass on offer
  app.post(
    '/api/pools/:id/offer/pass',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const outcome = passOffer(state, String(req.params.id), actor);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({ session: buildClientSessionResponse(outcome.state, role) });
    })
  );

  // Buyer: Access private claim pass (Strictly role & unlock protected)
  app.get(
    '/api/pools/:id/claim',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const pool = state.pools.find((p) => p.id === String(req.params.id));
      if (!pool) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pool not found.' } });
        return;
      }
      const access = canAccessClaimRoute(pool, role, actor.id, state.demoNow);
      if (!access.allowed) {
        res.status(403).json({
          error: {
            code: role !== 'buyer' ? 'FORBIDDEN_ROLE' : 'INVALID_STAGE',
            message: access.reason || 'Access to claim instructions denied.',
          },
        });
        return;
      }
      const sanitized = sanitizePoolForRole(pool, role, actor.id, state.demoNow);
      const metrics = computePoolMetrics(pool, state.demoNow);
      const member = sanitized.members.find((m) => m.userId === actor.id)!;
      res.json({
        pool: { ...sanitized, metrics },
        member,
        referenceCode: `${sanitized.currentOffer!.privateReferencePrefix}-${member.id.slice(-4).toUpperCase()}`,
        demoNow: state.demoNow,
      });
    })
  );

  // Buyer: Mark unlocked deal as fulfilled (separate from confirmed)
  app.post(
    '/api/pools/:id/claim/fulfill',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const outcome = markBuyerFulfilled(state, String(req.params.id), actor);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({ session: buildClientSessionResponse(outcome.state, role) });
    })
  );

  // Follow expired / similar pool
  app.post(
    '/api/pools/:id/follow',
    withSession((req, res, state, role) => {
      const actor = PERSONAS[role];
      const outcome = toggleFollowPool(state, String(req.params.id), actor);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        following: outcome.data.following,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Demo Controls: Simulate +1 eligible buyer confirmation
  app.post(
    '/api/demo/simulate-confirm',
    withSession((req, res, state, role) => {
      const poolId = String(req.body?.poolId || 'pool-maverick-xlt');
      const outcome = simulateAnotherConfirmation(state, poolId);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        unlockedNow: outcome.data.unlockedNow,
        simulatedLabel: outcome.data.simulatedLabel,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Demo Controls: Advance demo clock past offer deadline
  app.post(
    '/api/demo/advance-clock',
    withSession((req, res, state, role) => {
      const poolId = String(req.body?.poolId || 'pool-maverick-xlt');
      const outcome = advanceClockPastDeadline(state, poolId);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        newDemoNow: outcome.data.newDemoNow,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Demo Controls: Simulate seller term revision (v+1)
  app.post(
    '/api/demo/simulate-revision',
    withSession((req, res, state, role) => {
      const poolId = String(req.body?.poolId || 'pool-maverick-xlt');
      const outcome = simulateSellerTermRevision(state, poolId, PERSONAS.seller);
      if (!outcome.ok) {
        res.status(statusFromErrorCode(outcome.error.code)).json({ error: outcome.error });
        return;
      }
      saveSession(outcome.state);
      res.json({
        offer: outcome.data.offer,
        session: buildClientSessionResponse(outcome.state, role),
      });
    })
  );

  // Catch-all for unknown /api routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } });
  });

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Tally] Server running at http://0.0.0.0:${PORT} (${isProd ? 'prod' : 'dev'})`);
  });
}

startServer().catch((err) => {
  console.error('[Tally] Fatal startup error:', err);
  process.exit(1);
});
