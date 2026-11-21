import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Bell,
  BellPlus,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  MapPin,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  POOL_CATEGORIES,
  type AlertNotification,
  type PoolCategory,
  type SavedItemAlert,
} from '../domain/types.ts';
import { ApiRequestError, type ClientPool, useTally } from '../lib/api.ts';
import {
  formatDateTimePacific,
  formatUnit,
  getStageLabel,
  getStageToneClasses,
} from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';

const VALID_CATEGORY_SET = new Set<string>(POOL_CATEGORIES);

interface AlertFormState {
  query: string;
  category: PoolCategory | '';
  city: string;
}

const EMPTY_FORM: AlertFormState = {
  query: '',
  category: '',
  city: '',
};

function parseValidCategory(raw: string | null): PoolCategory | '' {
  if (!raw) return '';
  return VALID_CATEGORY_SET.has(raw) ? (raw as PoolCategory) : '';
}

function getPoolNotificationDestination(pool: ClientPool): string {
  const st = pool.metrics.effectiveStage;
  if (st === 'expired') return `/pools/${pool.id}/offer`;
  return `/pools/${pool.id}`;
}

export function AlertsPage() {
  const {
    session,
    role,
    busy,
    createAlertAction,
    updateAlertAction,
    markNotificationReadAction,
    markAllNotificationsReadAction,
    showBanner,
  } = useTally();
  const { searchParams, navigate } = useRouter();

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
  const [form, setForm] = useState<AlertFormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [lastArchived, setLastArchived] = useState<SavedItemAlert | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const queryInputRef = useRef<HTMLInputElement | null>(null);

  const createFlag = searchParams.get('create');
  const prefillQuery = searchParams.get('q') ?? '';
  const prefillCategory = parseValidCategory(searchParams.get('cat'));

  // Handle Explore -> "Create item alert" pre-fill (query + category only; city stays explicit optional blank)
  useEffect(() => {
    if (createFlag === '1') {
      setEditingAlertId(null);
      setForm({
        query: prefillQuery.trim(),
        category: prefillCategory,
        city: '',
      });
      setFieldErrors({});
      setFormError(null);
      setComposerOpen(true);
    }
  }, [createFlag, prefillQuery, prefillCategory]);

  // Reset transient editor/undo UI when switching persona or session
  useEffect(() => {
    setLastArchived(null);
    setActionError(null);
    if (editingAlertId) {
      setEditingAlertId(null);
      setComposerOpen(false);
    }
  }, [session?.actor.id, session?.sessionId]);

  useEffect(() => {
    if (composerOpen) {
      queryInputRef.current?.focus();
    }
  }, [composerOpen, editingAlertId]);

  const alerts = session?.alerts ?? [];
  const notifications = session?.notifications ?? [];
  const unreadCount = session?.unreadAlertCount ?? 0;

  const poolsById = useMemo(() => {
    const map = new Map<string, ClientPool>();
    for (const pool of session?.pools ?? []) {
      map.set(pool.id, pool);
    }
    return map;
  }, [session?.pools]);

  const activeAlerts = useMemo(
    () => alerts.filter((a) => a.status === 'active'),
    [alerts]
  );
  const pausedAlerts = useMemo(
    () => alerts.filter((a) => a.status === 'paused'),
    [alerts]
  );
  const savedAlerts = useMemo(
    () => alerts.filter((a) => a.status !== 'archived'),
    [alerts]
  );
  const archivedAlerts = useMemo(
    () => alerts.filter((a) => a.status === 'archived'),
    [alerts]
  );

  const announce = (msg: string) => {
    setStatusMessage('');
    window.requestAnimationFrame(() => setStatusMessage(msg));
  };

  const clearCreateQueryParams = () => {
    if (searchParams.has('create') || searchParams.has('q') || searchParams.has('cat')) {
      navigate('/alerts', { replace: true });
    }
  };

  const openNewComposer = () => {
    setEditingAlertId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setActionError(null);
    setComposerOpen(true);
  };

  const openEditComposer = (alert: SavedItemAlert) => {
    clearCreateQueryParams();
    setEditingAlertId(alert.id);
    setForm({
      query: alert.query,
      category: alert.category ?? '',
      city: alert.city ?? '',
    });
    setFieldErrors({});
    setFormError(null);
    setActionError(null);
    setComposerOpen(true);
  };

  const closeComposer = () => {
    setComposerOpen(false);
    setEditingAlertId(null);
    setFieldErrors({});
    setFormError(null);
    clearCreateQueryParams();
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setActionError(null);

    const trimmedQuery = form.query.trim();
    if (trimmedQuery.length < 2) {
      setFieldErrors({ query: 'Enter an item name or model keyword (at least 2 characters).' });
      setFormError('Fix the highlighted fields before saving.');
      return;
    }

    try {
      if (editingAlertId) {
        const updated = await updateAlertAction(editingAlertId, {
          query: trimmedQuery,
          category: form.category || null,
          city: form.city.trim() || null,
        });
        closeComposer();
        const msg = `Updated alert "${updated.query}". Changes apply prospectively to new pools.`;
        announce(msg);
        showBanner('success', msg);
      } else {
        const created = await createAlertAction({
          query: trimmedQuery,
          category: form.category || undefined,
          city: form.city.trim() || undefined,
        });
        closeComposer();
        const msg = `Saved item alert for "${created.query}". You will be notified when a matching new pool opens.`;
        announce(msg);
        showBanner('success', msg);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFormError(err.error.message);
        if (err.error.fieldErrors) setFieldErrors(err.error.fieldErrors);
      } else {
        setFormError('Unable to save alert right now.');
      }
    }
  };

  const handleTogglePause = async (alert: SavedItemAlert) => {
    setActionError(null);
    const nextStatus = alert.status === 'active' ? 'paused' : 'active';
    try {
      await updateAlertAction(alert.id, { status: nextStatus });
      const msg =
        nextStatus === 'paused'
          ? `Paused alert "${alert.query}". New pools will not notify while paused.`
          : `Resumed alert "${alert.query}" prospectively for new pools.`;
      announce(msg);
      showBanner('info', msg);
    } catch (err) {
      const msg =
        err instanceof ApiRequestError
          ? err.error.message
          : 'Unable to update alert status.';
      setActionError(msg);
    }
  };

  const handleArchive = async (alert: SavedItemAlert) => {
    setActionError(null);
    try {
      const archived = await updateAlertAction(alert.id, { status: 'archived' });
      if (editingAlertId === alert.id) {
        closeComposer();
      }
      setLastArchived(archived);
      const msg = `Archived alert "${archived.query}". Historical notifications remain in your inbox.`;
      announce(msg);
    } catch (err) {
      const msg =
        err instanceof ApiRequestError ? err.error.message : 'Unable to archive alert.';
      setActionError(msg);
    }
  };

  const handleRestore = async (alert: SavedItemAlert) => {
    setActionError(null);
    try {
      const restored = await updateAlertAction(alert.id, { status: 'active' });
      if (lastArchived?.id === alert.id) {
        setLastArchived(null);
      }
      const msg = `Restored alert "${restored.query}" as active for future pools.`;
      announce(msg);
      showBanner('success', msg);
    } catch (err) {
      const msg =
        err instanceof ApiRequestError ? err.error.message : 'Unable to restore alert.';
      setActionError(msg);
    }
  };

  const handleOpenNotificationPool = async (notif: AlertNotification, livePool: ClientPool) => {
    setActionError(null);
    if (!notif.readAt) {
      try {
        await markNotificationReadAction(notif.id);
      } catch (err) {
        setActionError(
          err instanceof ApiRequestError
            ? err.error.message
            : 'Unable to mark notification as read.'
        );
        return;
      }
    }
    navigate(getPoolNotificationDestination(livePool));
  };

  const handleMarkSingleRead = async (notif: AlertNotification) => {
    setActionError(null);
    try {
      await markNotificationReadAction(notif.id);
      announce(`Marked notification for "${notif.poolTitle}" as read.`);
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError
          ? err.error.message
          : 'Unable to update notification status.'
      );
    }
  };

  const handleMarkAllRead = async () => {
    setActionError(null);
    try {
      const count = await markAllNotificationsReadAction();
      if (count > 0) {
        const msg = `Marked ${count} ${count === 1 ? 'notification' : 'notifications'} as read.`;
        announce(msg);
        showBanner('info', msg);
      }
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError
          ? err.error.message
          : 'Unable to mark notifications as read.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Screen-reader live region for alert mutations */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </div>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-3 border-b border-[#C6D8CE]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-[#516B61]">
            Signed-in demo persona · {session?.actor.name} ({role})
          </p>
          <h1 className="mt-1 font-display text-2xl sm:text-4xl text-[#152B23] uppercase">
            Alerts
          </h1>
          <p className="mt-1 text-sm text-[#516B61]">
            Saved item searches and in-app notifications when a matching buying pool opens.
          </p>
        </div>

        <button
          type="button"
          onClick={openNewComposer}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider self-start sm:self-auto cursor-pointer"
        >
          <BellPlus className="w-4 h-4" aria-hidden="true" />
          <span>New alert</span>
        </button>
      </div>

      {role === 'seller' && (
        <div className="bg-[#F6F1E5] border border-[#C6D8CE] px-4 py-3 text-xs text-[#152B23]">
          Viewing alerts for the <strong>Seller</strong> persona ({session?.actor.name}). Switch to{' '}
          <strong>Buyer</strong> in Demo controls to check buyer-saved alerts and pool matches.
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="bg-[#FDF0EE] border border-[#A63A2B] px-4 py-3 text-xs text-[#A63A2B] flex items-center justify-between gap-3"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="p-0.5 hover:opacity-75 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Alert Composer / Editor Card */}
      {composerOpen && (
        <section
          aria-label={editingAlertId ? 'Edit saved item alert' : 'Create item alert'}
          className="bg-white border-2 border-[#152B23] shadow-[4px_4px_0px_#152B23] p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#C6D8CE]">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61]">
                {editingAlertId ? 'Edit saved search' : 'New saved item alert'}
              </p>
              <h2 className="font-display text-xl text-[#152B23] uppercase mt-0.5">
                {editingAlertId ? 'Update item alert' : 'Create item alert'}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeComposer}
              aria-label="Close alert form"
              className="p-1.5 border border-[#C6D8CE] bg-white hover:bg-[#EAF7EF] cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={handleFormSubmit} noValidate className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-6">
                <label
                  htmlFor="alert-query"
                  className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
                >
                  Item or model keywords *
                </label>
                <input
                  ref={queryInputRef}
                  id="alert-query"
                  type="text"
                  required
                  value={form.query}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, query: e.target.value }));
                    setFieldErrors((prev) => {
                      if (!prev.query) return prev;
                      const next = { ...prev };
                      delete next.query;
                      return next;
                    });
                  }}
                  placeholder="e.g., Ford Maverick XLT, walnut table, espresso grinder"
                  aria-describedby="alert-query-help"
                  aria-invalid={Boolean(fieldErrors.query)}
                  className="mt-1 w-full h-11 px-3 bg-[#EAF7EF]/45 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm text-[#152B23]"
                />
                <p id="alert-query-help" className="mt-1 text-[11px] text-[#516B61]">
                  All words must appear as whole words in the new pool title or item options.
                </p>
                {fieldErrors.query && (
                  <p role="alert" className="mt-1 text-xs text-[#A63A2B]">
                    {fieldErrors.query}
                  </p>
                )}
              </div>

              <div className="md:col-span-3">
                <label
                  htmlFor="alert-category"
                  className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
                >
                  Category (optional)
                </label>
                <select
                  id="alert-category"
                  value={form.category}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      category: parseValidCategory(e.target.value),
                    }))
                  }
                  className="mt-1 w-full h-11 px-3 bg-[#EAF7EF]/45 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm text-[#152B23]"
                >
                  <option value="">Any category</option>
                  {POOL_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                {fieldErrors.category && (
                  <p role="alert" className="mt-1 text-xs text-[#A63A2B]">
                    {fieldErrors.category}
                  </p>
                )}
              </div>

              <div className="md:col-span-3">
                <label
                  htmlFor="alert-city"
                  className="block font-mono text-[11px] font-semibold uppercase text-[#152B23]"
                >
                  City (optional)
                </label>
                <input
                  id="alert-city"
                  type="text"
                  value={form.city}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, city: e.target.value }));
                    setFieldErrors((prev) => {
                      if (!prev.city) return prev;
                      const next = { ...prev };
                      delete next.city;
                      return next;
                    });
                  }}
                  placeholder="Any city (e.g., Portland)"
                  aria-describedby="alert-city-help"
                  aria-invalid={Boolean(fieldErrors.city)}
                  className="mt-1 w-full h-11 px-3 bg-[#EAF7EF]/45 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm text-[#152B23]"
                />
                <p id="alert-city-help" className="mt-1 text-[11px] text-[#516B61]">
                  Leave blank to match pools in any city.
                </p>
                {fieldErrors.city && (
                  <p role="alert" className="mt-1 text-xs text-[#A63A2B]">
                    {fieldErrors.city}
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs text-[#516B61] bg-[#F6F1E5] border border-[#C6D8CE] px-3 py-2">
              {editingAlertId
                ? 'Edits apply prospectively to newly opened pools. Earlier notifications stay in your inbox.'
                : 'Prospective only — notifies you when a new matching buying pool opens after saving. Already-open pools are not backfilled.'}
            </p>

            {formError && (
              <p role="alert" className="p-3 bg-[#FDF0EE] border border-[#A63A2B] text-xs text-[#A63A2B]">
                {formError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2.5 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
              >
                {busy
                  ? 'Saving…'
                  : editingAlertId
                    ? 'Save changes'
                    : 'Save item alert'}
              </button>
              <button
                type="button"
                onClick={closeComposer}
                className="px-4 py-2.5 bg-white hover:bg-[#F6F1E5] text-[#152B23] border border-[#C6D8CE] font-mono text-xs uppercase tracking-wider cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Reversible Archive Undo Notice */}
      {lastArchived && (
        <div
          role="status"
          className="bg-[#F6F1E5] border border-[#152B23] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#152B23]"
        >
          <span>
            Archived alert <strong>&ldquo;{lastArchived.query}&rdquo;</strong>. Historical inbox
            notifications are preserved.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRestore(lastArchived)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#152B23] text-white hover:bg-[#28463B] font-mono text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              <span>Undo archive</span>
            </button>
            <button
              type="button"
              onClick={() => setLastArchived(null)}
              aria-label="Dismiss archive confirmation"
              className="p-1 text-[#516B61] hover:text-[#152B23] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Main Two-Column Content: Inbox (Left 7 cols) + Saved Alerts (Right 5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Notifications Inbox */}
        <section aria-labelledby="alerts-inbox-heading" className="lg:col-span-7 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <h2
                id="alerts-inbox-heading"
                className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]"
              >
                Inbox ({notifications.length})
              </h2>
              <span
                className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider tabular-nums ${
                  unreadCount > 0
                    ? 'bg-[#A63A2B] text-white border-[#A63A2B]'
                    : 'bg-white text-[#516B61] border-[#C6D8CE]'
                }`}
              >
                {unreadCount > 0 ? `${unreadCount} unread` : '0 unread'}
              </span>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleMarkAllRead()}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[#152B23] underline underline-offset-4 hover:text-[#28463B] cursor-pointer disabled:opacity-60"
              >
                <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="bg-white border border-[#C6D8CE] p-6 sm:p-8 space-y-3">
              <div className="w-9 h-9 bg-[#EAF7EF] border border-[#C6D8CE] flex items-center justify-center text-[#152B23]">
                <Bell className="w-4 h-4" aria-hidden="true" />
              </div>
              {savedAlerts.length === 0 ? (
                <>
                  <h3 className="font-display text-lg text-[#152B23] uppercase">
                    No notifications yet
                  </h3>
                  <p className="text-sm text-[#516B61] max-w-md">
                    Save an item alert for a specific product, model, or category. When someone opens
                    a matching buying pool, a notification will appear here.
                  </p>
                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={openNewComposer}
                      className="px-4 py-2 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer"
                    >
                      New alert
                    </button>
                    <Link
                      to="/"
                      className="px-4 py-2 bg-white hover:bg-[#F6F1E5] text-[#152B23] border border-[#C6D8CE] font-mono text-xs uppercase tracking-wider"
                    >
                      Browse Explore
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="font-display text-lg text-[#152B23] uppercase">
                    Inbox is clear
                  </h3>
                  <p className="text-sm text-[#516B61] max-w-md">
                    {activeAlerts.length > 0
                      ? `Watching ${activeAlerts.length} active ${
                          activeAlerts.length === 1 ? 'alert' : 'alerts'
                        } for newly opened pools. Existing pools are not backfilled.`
                      : 'All of your saved alerts are currently paused. Resume an alert to receive matches for newly opened pools.'}
                  </p>
                  <Link
                    to="/"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#EAF7EF]/60 hover:bg-[#152B23] text-[#152B23] hover:text-white border border-[#C6D8CE] hover:border-[#152B23] font-mono text-xs uppercase tracking-wider transition-colors"
                  >
                    <span>Browse open pools</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                </>
              )}
            </div>
          ) : (
            <ol className="space-y-3">
              {notifications.map((notif) => {
                const isUnread = !notif.readAt;
                const livePool = poolsById.get(notif.poolId);
                const liveStage = livePool?.metrics.effectiveStage;
                const isUnavailable = !livePool;
                const isEnded = liveStage === 'expired' || liveStage === 'closed';
                const isUnlocked = liveStage === 'unlocked';

                return (
                  <li
                    key={notif.id}
                    className={`p-4 sm:p-5 transition-colors ${
                      isUnread
                        ? 'bg-white border-2 border-[#152B23] shadow-[3px_3px_0px_#152B23]'
                        : 'bg-[#F6F1E5]/45 border border-[#C6D8CE]'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-2 min-w-0 flex-1">
                        {/* Unread/Read + Category + Live Pool Status Cues */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider ${
                              isUnread
                                ? 'bg-[#FFBF32] text-[#152B23] border-[#152B23]'
                                : 'bg-white text-[#516B61] border-[#C6D8CE]'
                            }`}
                          >
                            {isUnread ? 'Unread' : 'Read'}
                          </span>
                          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61]">
                            {notif.poolCategory}
                          </span>
                          {isUnavailable ? (
                            <span className="px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider bg-[#FDF0EE] text-[#A63A2B] border-[#E8C2BC]">
                              No longer available
                            </span>
                          ) : (
                            liveStage && (
                              <span
                                className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider ${getStageToneClasses(
                                  liveStage
                                )}`}
                              >
                                {getStageLabel(liveStage)}
                              </span>
                            )
                          )}
                        </div>

                        {/* Item title & City */}
                        <div>
                          <h3 className="font-heading text-base sm:text-lg font-bold text-[#152B23] leading-snug">
                            {notif.poolTitle}
                          </h3>
                          <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-[#152B23]">
                            <MapPin className="w-3.5 h-3.5 text-[#516B61] shrink-0" aria-hidden="true" />
                            <span>{notif.poolLocation}</span>
                            {livePool && !isEnded && !isUnlocked && (
                              <span className="text-[#516B61]">
                                ·{' '}
                                {formatUnit(
                                  livePool.metrics.eligibleInterestedUnits,
                                  livePool.unitSingular,
                                  livePool.unitPlural
                                )}{' '}
                                of {livePool.metrics.targetMin} interested
                              </span>
                            )}
                          </p>
                        </div>

                        {/* Matched Alert Metadata */}
                        <p className="text-xs text-[#516B61]">
                          Matched alert: <span className="text-[#152B23]">{notif.matchedAlertSummary}</span> ·{' '}
                          <span className="font-mono text-[11px]">
                            {formatDateTimePacific(notif.createdAt)}
                          </span>
                        </p>

                        {/* Honest availability states */}
                        {isUnavailable && (
                          <p className="text-xs text-[#A63A2B] bg-[#FDF0EE] border border-[#E8C2BC] px-3 py-2">
                            This buying pool is no longer available in your current session.
                          </p>
                        )}
                        {!isUnavailable && isEnded && (
                          <p className="text-xs text-[#516B61] bg-[#F6F1E5] border border-[#C6D8CE] px-3 py-2">
                            This pool has ended and is no longer accepting new buyers.
                          </p>
                        )}
                        {!isUnavailable && isUnlocked && (
                          <p className="text-xs text-[#516B61] bg-[#EAF7EF] border border-[#C6D8CE] px-3 py-2">
                            This pool has already reached its minimum and closed to new joins.
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex sm:flex-col items-stretch sm:items-end gap-2 shrink-0 pt-1 sm:pt-0">
                        {livePool ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleOpenNotificationPool(notif, livePool)}
                            className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 border font-mono text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer disabled:opacity-60 ${
                              isUnread && !isEnded
                                ? 'bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border-[#152B23]'
                                : 'bg-white hover:bg-[#152B23] text-[#152B23] hover:text-white border-[#152B23]'
                            }`}
                          >
                            <span>{isEnded ? 'View outcome' : 'Open pool'}</span>
                            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        ) : (
                          <span className="inline-flex items-center justify-center px-3 py-2 border border-[#E8C2BC] bg-[#FDF0EE] font-mono text-[11px] uppercase text-[#A63A2B]">
                            Unavailable
                          </span>
                        )}

                        {isUnread && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleMarkSingleRead(notif)}
                            aria-label={`Mark notification for ${notif.poolTitle} as read`}
                            className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[#516B61] hover:text-[#152B23] border border-transparent hover:border-[#C6D8CE] cursor-pointer"
                          >
                            <Check className="w-3 h-3" aria-hidden="true" />
                            <span>Mark read</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Saved Alerts Area */}
        <aside aria-labelledby="saved-alerts-heading" className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2
              id="saved-alerts-heading"
              className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]"
            >
              Saved alerts ({savedAlerts.length})
            </h2>
            <span className="font-mono text-[11px] text-[#516B61] tabular-nums">
              {activeAlerts.length} active · {pausedAlerts.length} paused
            </span>
          </div>

          {savedAlerts.length === 0 ? (
            <div className="bg-white border border-[#C6D8CE] p-5 space-y-3">
              <h3 className="font-heading text-base font-bold text-[#152B23]">
                No saved alerts yet
              </h3>
              <p className="text-xs text-[#516B61] leading-relaxed">
                Add an item name or model to watch. Narrow by category or city only when you want
                stricter matching.
              </p>
              <button
                type="button"
                onClick={openNewComposer}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#EAF7EF] hover:bg-[#152B23] text-[#152B23] hover:text-white border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
              >
                <BellPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Create item alert</span>
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {savedAlerts.map((alert) => {
                const isActive = alert.status === 'active';
                return (
                  <li
                    key={alert.id}
                    className={`p-4 space-y-3 ${
                      isActive
                        ? 'bg-white border border-[#152B23]'
                        : 'bg-[#F6F1E5]/65 border border-[#C6D8CE]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span
                          className={`inline-block px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase tracking-wider ${
                            isActive
                              ? 'bg-[#EAF7EF] text-[#152B23] border-[#152B23]'
                              : 'bg-white text-[#516B61] border-[#C6D8CE]'
                          }`}
                        >
                          {isActive ? 'Active' : 'Paused'}
                        </span>
                        <h3 className="mt-1.5 font-heading text-base font-bold text-[#152B23] break-words">
                          &ldquo;{alert.query}&rdquo;
                        </h3>
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-[#C6D8CE]/70">
                      <div>
                        <dt className="font-mono text-[10px] uppercase text-[#516B61]">Category</dt>
                        <dd className="font-medium text-[#152B23]">
                          {alert.category || 'Any category'}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[10px] uppercase text-[#516B61]">City</dt>
                        <dd className="font-medium text-[#152B23]">{alert.city || 'Any city'}</dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEditComposer(alert)}
                        aria-label={`Edit alert ${alert.query}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-[#EAF7EF] border border-[#C6D8CE] hover:border-[#152B23] font-mono text-[11px] uppercase tracking-wider text-[#152B23] cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" aria-hidden="true" />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleTogglePause(alert)}
                        aria-label={
                          isActive
                            ? `Pause alert ${alert.query}`
                            : `Resume alert ${alert.query}`
                        }
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 border font-mono text-[11px] uppercase tracking-wider cursor-pointer ${
                          isActive
                            ? 'bg-white hover:bg-[#F6F1E5] border-[#C6D8CE] hover:border-[#152B23] text-[#152B23]'
                            : 'bg-[#152B23] hover:bg-[#28463B] border-[#152B23] text-white'
                        }`}
                      >
                        {isActive ? (
                          <>
                            <Pause className="w-3 h-3" aria-hidden="true" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3" aria-hidden="true" />
                            <span>Resume</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleArchive(alert)}
                        aria-label={`Archive alert ${alert.query}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-[#FDF0EE] border border-[#C6D8CE] hover:border-[#A63A2B] font-mono text-[11px] uppercase tracking-wider text-[#516B61] hover:text-[#A63A2B] cursor-pointer"
                      >
                        <Archive className="w-3 h-3" aria-hidden="true" />
                        <span>Archive</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Reversible Archived Alerts Drawer */}
          {archivedAlerts.length > 0 && (
            <div className="bg-white border border-[#C6D8CE]">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                aria-expanded={showArchived}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-[#516B61] hover:text-[#152B23] cursor-pointer"
              >
                <span>Archived alerts ({archivedAlerts.length})</span>
                {showArchived ? (
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                )}
              </button>

              {showArchived && (
                <ul className="border-t border-[#C6D8CE] divide-y divide-[#C6D8CE]/70">
                  {archivedAlerts.map((alert) => (
                    <li
                      key={alert.id}
                      className="p-3.5 bg-[#F6F1E5]/35 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-heading text-sm font-bold text-[#516B61] truncate">
                          &ldquo;{alert.query}&rdquo;
                        </p>
                        <p className="font-mono text-[10px] text-[#516B61]">
                          {alert.category || 'Any category'} · {alert.city || 'Any city'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRestore(alert)}
                        aria-label={`Restore alert ${alert.query}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-[#EAF7EF] border border-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23] shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" aria-hidden="true" />
                        <span>Restore</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
