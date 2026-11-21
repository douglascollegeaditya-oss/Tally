import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { canManagePool, evaluateMemberEligibility } from '../domain/tallyEngine.ts';
import { ApiRequestError, useTally } from '../lib/api.ts';
import {
  formatCalendarDate,
  formatCurrency,
  formatDateTimePacific,
  formatUnit,
  getPoolShortCode,
  getStageLabel,
} from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import { RoleGate } from '../components/RoleGate.tsx';
import { SegmentedTally } from '../components/SegmentedTally.tsx';

export function OrganizerPage({ poolId }: { poolId: string }) {
  const {
    session,
    sessionId,
    busy,
    recalculateDemandAction,
    requestSellerQuoteAction,
    postDiscussionAction,
    showBanner,
  } = useTally();

  const [updateText, setUpdateText] = useState('');
  const [updateErr, setUpdateErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const pool = session?.pools.find((p) => p.id === poolId);
  const actorId = session?.actor.id ?? '';

  if (!pool) {
    return (
      <div className="bg-white border border-[#C6D8CE] p-8 max-w-lg mx-auto text-center space-y-3">
        <h1 className="font-display text-2xl text-[#152B23] uppercase">Pool not found</h1>
        <Link
          to="/"
          className="inline-flex px-4 py-2 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase"
        >
          Back to Explore
        </Link>
      </div>
    );
  }

  if (!canManagePool(pool, actorId)) {
    const requiredRole = pool.organizerId === 'buyer-maya' ? 'buyer' : 'organizer';
    return (
      <RoleGate
        title="Organizer workspace"
        requiredRole={requiredRole}
        reason={`Demand aggregation, variant breakdowns, and private seller quote requests for this pool are restricted to its organizer (${pool.organizerName}).`}
        backTo={`/pools/${pool.id}`}
        backLabel="Back to pool page"
      />
    );
  }

  const metrics = pool.metrics;
  const stage = metrics.effectiveStage;
  const readyToRequest = metrics.eligibleInterestedUnits >= pool.minQuantity;
  const excludedMembers = pool.members.filter((m) => !evaluateMemberEligibility(pool, m).eligible);

  const sellerUrl = pool.sellerToken
    ? `${window.location.origin}/s/${pool.sellerToken}?session=${encodeURIComponent(sessionId)}`
    : null;

  const handleRecalculate = async () => {
    setActionErr(null);
    try {
      await recalculateDemandAction(pool.id);
    } catch (err) {
      setActionErr(err instanceof ApiRequestError ? err.error.message : 'Recalculation failed.');
    }
  };

  const handleRequestQuote = async () => {
    setActionErr(null);
    try {
      await requestSellerQuoteAction(pool.id);
    } catch (err) {
      setActionErr(
        err instanceof ApiRequestError ? err.error.message : 'Unable to create seller request.'
      );
    }
  };

  const handleCopySellerLink = () => {
    if (!sellerUrl) return;
    navigator.clipboard?.writeText(sellerUrl).catch(() => undefined);
    setCopiedLink(true);
    showBanner('info', 'Copied private seller request link for this demo session.');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handlePostUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdateErr(null);
    if (updateText.trim().length < 4) {
      setUpdateErr('Write a concise update for pool members (at least 4 characters).');
      return;
    }
    try {
      await postDiscussionAction(pool.id, updateText, true);
      setUpdateText('');
      showBanner('success', 'Posted official organizer update to the pool.');
    } catch (err) {
      setUpdateErr(err instanceof ApiRequestError ? err.error.message : 'Could not post update.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#C6D8CE]">
        <Link
          to={`/pools/${pool.id}`}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-[#152B23] underline underline-offset-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to public pool page</span>
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-wider text-[#516B61]">
          Organizer workspace · Pool #{getPoolShortCode(pool)} · Goal {formatCalendarDate(pool.goalDate)}
        </span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <span className="inline-block px-2 py-0.5 bg-[#152B23] text-[#FFBF32] font-mono text-[10px] font-semibold uppercase tracking-wider">
            {getStageLabel(stage)}
          </span>
          <h1 className="mt-2 font-display text-2xl sm:text-3xl text-[#152B23] uppercase">
            {pool.title}
          </h1>
          <p className="mt-1 text-sm text-[#516B61]">
            Aggregate demand ledger & private seller quote dispatch. Member contact info stays
            private.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleRecalculate()}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#152B23] hover:bg-[#F6F1E5] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Recalculate eligible demand</span>
        </button>
      </div>

      {/* KPI Strip */}
      <section aria-label="Demand summary metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-[#C6D8CE] p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
            Eligible demand
          </p>
          <p className="mt-1 font-display text-2xl text-[#152B23] tabular-nums">
            {metrics.eligibleInterestedUnits} / {pool.minQuantity}
          </p>
          <p className="text-xs text-[#516B61]">{pool.unitPlural} ready</p>
        </div>

        <div className="bg-white border border-[#C6D8CE] p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
            Excluded (incompatible)
          </p>
          <p className="mt-1 font-display text-2xl text-[#A63A2B] tabular-nums">
            {metrics.excludedUnits}
          </p>
          <p className="text-xs text-[#516B61]">Not sent to seller</p>
        </div>

        <div className="bg-white border border-[#C6D8CE] p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
            Offer confirmations
          </p>
          <p className="mt-1 font-display text-2xl text-[#152B23] tabular-nums">
            {pool.currentOffer ? `${metrics.confirmedUnits} / ${metrics.targetMin}` : '—'}
          </p>
          <p className="text-xs text-[#516B61]">
            {pool.currentOffer ? `Offer v${pool.currentOffer.version}` : 'No offer yet'}
          </p>
        </div>

        <div className="bg-white border border-[#C6D8CE] p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
            Fulfilled after unlock
          </p>
          <p className="mt-1 font-display text-2xl text-[#152B23] tabular-nums">
            {stage === 'unlocked' || stage === 'closed' ? metrics.fulfilledUnits : '—'}
          </p>
          <p className="text-xs text-[#516B61]">Separate from confirmed</p>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Aggregate Variant Breakdown & Seller Request Packet */}
        <div className="lg:col-span-7 space-y-5">
          {/* Aggregate Variant Breakdown Table */}
          <section
            aria-label="Aggregate demand by variant"
            className="bg-white border border-[#C6D8CE] p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#C6D8CE]">
              <h2 className="font-heading text-base font-bold text-[#152B23]">
                Aggregate demand by variant (seller packet preview)
              </h2>
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#516B61]">
                <ShieldCheck className="w-3.5 h-3.5 text-[#152B23]" aria-hidden="true" />
                <span>No personal contact info shared</span>
              </span>
            </div>

            <SegmentedTally
              current={metrics.eligibleInterestedUnits}
              target={pool.minQuantity}
              unitSingular={pool.unitSingular}
              unitPlural={pool.unitPlural}
              verb="eligible"
              rightLabel={readyToRequest ? 'Ready to request quote' : `${metrics.remainingToMinimum} more needed`}
            />

            {metrics.variantBreakdown.length === 0 ? (
              <p className="text-sm text-[#516B61]">No eligible units recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#152B23]/20 font-mono text-[11px] uppercase text-[#516B61]">
                      <th className="py-2 pr-3 font-medium">Compatible specification / variant</th>
                      <th className="py-2 px-3 font-medium text-right">Buyers</th>
                      <th className="py-2 pl-3 font-medium text-right">Eligible {pool.unitPlural}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#C6D8CE]/70">
                    {metrics.variantBreakdown.map((row) => (
                      <tr key={row.variantLabel}>
                        <td className="py-2.5 pr-3 text-[#152B23]">{row.variantLabel}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#516B61]">
                          {row.memberCount}
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono font-semibold tabular-nums text-[#152B23]">
                          {row.eligibleUnits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#152B23] font-mono text-xs font-semibold">
                      <td className="py-2.5 pr-3 uppercase">Total eligible demand</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">—</td>
                      <td className="py-2.5 pl-3 text-right tabular-nums">
                        {formatUnit(metrics.eligibleInterestedUnits, pool.unitSingular, pool.unitPlural)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {excludedMembers.length > 0 && (
              <div className="p-3 bg-[#F6F1E5] border border-[#C6D8CE] text-xs text-[#516B61]">
                <strong className="text-[#152B23]">
                  {excludedMembers.length} excluded {excludedMembers.length === 1 ? 'entry' : 'entries'}
                </strong>{' '}
                omitted from the seller packet because preferences did not match shared requirements.
              </div>
            )}
          </section>

          {/* Post Official Organizer Update */}
          <section
            aria-label="Post organizer update"
            className="bg-white border border-[#C6D8CE] p-5 space-y-3"
          >
            <h2 className="font-heading text-base font-bold text-[#152B23]">
              Post organizer update to pool members
            </h2>
            <p className="text-xs text-[#516B61]">
              Updates appear in the pool discussion and in-app activity feed. No external emails are
              sent in this demo.
            </p>
            <form onSubmit={handlePostUpdate} className="space-y-3">
              <label htmlFor="org-update-input" className="sr-only">
                Organizer update message
              </label>
              <textarea
                id="org-update-input"
                rows={3}
                value={updateText}
                onChange={(e) => setUpdateText(e.target.value)}
                placeholder="e.g., Reached 8 eligible buyers — sending aggregate spec to Alder Motor Co. fleet desk today."
                className="w-full p-3 bg-[#EAF7EF]/40 border border-[#C6D8CE] focus:border-[#152B23] focus:bg-white text-sm"
              />
              {updateErr && <p className="text-xs text-[#A63A2B]">{updateErr}</p>}
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#152B23] hover:bg-[#28463B] text-white font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Publish organizer update</span>
              </button>
            </form>
          </section>
        </div>

        {/* Right 5 cols: Request Seller Quote Control */}
        <aside aria-label="Seller quote dispatch" className="lg:col-span-5 space-y-4">
          <div className="bg-white border-2 border-[#152B23] shadow-[3px_3px_0px_#152B23] p-5 space-y-4">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#516B61]">
              Private seller request link
            </p>

            {actionErr && (
              <p role="alert" className="p-3 bg-[#FDF0EE] border border-[#A63A2B] text-xs text-[#A63A2B]">
                {actionErr}
              </p>
            )}

            {!pool.sellerToken ? (
              <div className="space-y-3">
                <p className="text-sm text-[#152B23]">
                  {readyToRequest
                    ? `Eligible demand (${formatUnit(
                        metrics.eligibleInterestedUnits,
                        pool.unitSingular,
                        pool.unitPlural
                      )}) meets the minimum threshold. Generate a private link so a seller can submit one versioned conditional offer.`
                    : `Gather ${metrics.remainingToMinimum} more eligible ${
                        metrics.remainingToMinimum === 1 ? pool.unitSingular : pool.unitPlural
                      } before requesting a quote.`}
                </p>

                <button
                  type="button"
                  disabled={busy || !readyToRequest}
                  onClick={() => void handleRequestQuote()}
                  className="w-full py-3.5 px-4 bg-[#FFBF32] hover:bg-[#F2B01E] disabled:bg-[#EAE2CE] disabled:text-[#516B61] disabled:border-[#C6D8CE] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:cursor-not-allowed"
                >
                  {busy ? 'Creating link…' : 'Create private seller request link'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-[#EAF7EF] border border-[#B7DEC5] text-xs text-[#152B23]">
                  <p className="font-mono font-semibold uppercase text-[11px]">
                    {pool.currentOffer
                      ? `Seller published Offer v${pool.currentOffer.version}`
                      : 'Seller request active · Waiting for quote'}
                  </p>
                  <p className="mt-1 text-[#516B61]">
                    Requested {pool.quoteRequestedAt ? formatDateTimePacific(pool.quoteRequestedAt) : 'today'}.
                    Buyers see the waiting-for-quote state until a seller publishes terms.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="private-seller-link"
                    className="block font-mono text-[10px] uppercase text-[#516B61]"
                  >
                    Private seller URL (aggregate demand only)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      id="private-seller-link"
                      readOnly
                      value={sellerUrl || ''}
                      className="flex-1 h-9 px-2.5 bg-[#F6F1E5] border border-[#C6D8CE] font-mono text-[11px] text-[#152B23]"
                    />
                    <button
                      type="button"
                      onClick={handleCopySellerLink}
                      aria-label="Copy private seller request link"
                      className="px-3 h-9 bg-[#152B23] text-white font-mono text-[11px] uppercase cursor-pointer inline-flex items-center gap-1"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-[#F6F1E5] border border-[#C6D8CE] text-xs text-[#516B61] space-y-2">
                  <p>
                    <strong className="text-[#152B23]">Next step in demo:</strong> Switch to the{' '}
                    <strong>Seller</strong> persona in Demo controls, then open{' '}
                    <code className="font-mono text-[#152B23]">/s/{pool.sellerToken}</code> to
                    publish or revise a conditional quote.
                  </p>
                  <Link
                    to={`/s/${pool.sellerToken}`}
                    className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase text-[#152B23] underline"
                  >
                    <span>Go to /s/{pool.sellerToken}</span>
                    <ArrowRight className="w-3 h-3" aria-hidden="true" />
                  </Link>
                </div>

                {pool.currentOffer && (
                  <div className="pt-3 border-t border-[#C6D8CE] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#516B61]">Active quote subtotal</span>
                      <span className="font-mono font-semibold text-[#152B23] tabular-nums">
                        {formatCurrency(pool.currentOffer.subtotal)}
                      </span>
                    </div>
                    <Link
                      to={`/pools/${pool.id}/offer`}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase text-[#152B23]"
                    >
                      <span>View buyer offer screen</span>
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
