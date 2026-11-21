import { useEffect, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, Copy, Lock } from 'lucide-react';
import { ApiRequestError, type ClaimPassResponse, useTally } from '../lib/api.ts';
import { formatCalendarDate, formatDateTimePacific, formatUnit } from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import { QuoteReceipt } from '../components/QuoteReceipt.tsx';
import { RoleGate } from '../components/RoleGate.tsx';

export function ClaimPage({ poolId }: { poolId: string }) {
  const { role, session, busy, fetchClaimPass, markFulfilledAction, showBanner } = useTally();

  const [claimData, setClaimData] = useState<ClaimPassResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [gateError, setGateError] = useState<{ code?: string; message: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    let active = true;
    if (role !== 'buyer') {
      setClaimData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setGateError(null);
    fetchClaimPass(poolId)
      .then((res) => {
        if (!active) return;
        setClaimData(res);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiRequestError) {
          setGateError({ code: err.error.code, message: err.error.message });
        } else {
          setGateError({ message: 'Unable to open claim pass.' });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [poolId, role, fetchClaimPass, session?.updatedAt]);

  if (loading) {
    return (
      <div className="bg-white border border-[#C6D8CE] p-8 text-center font-mono text-xs uppercase text-[#516B61]">
        Verifying unlocked claim pass…
      </div>
    );
  }

  if (role !== 'buyer') {
    return (
      <RoleGate
        title="Private buyer claim instructions"
        requiredRole="buyer"
        reason="Unlocked seller purchase instructions and claim reference codes are strictly private to confirmed buyers in this pool."
        backTo={`/pools/${poolId}/offer`}
        backLabel="Back to offer review"
      />
    );
  }

  if (gateError || !claimData) {
    return (
      <div className="max-w-xl mx-auto my-8 bg-white border-2 border-[#152B23] p-6 sm:p-8 shadow-[3px_3px_0px_#152B23] space-y-4">
        <div className="flex items-center gap-2 font-mono text-xs uppercase text-[#A63A2B]">
          <Lock className="w-4 h-4" aria-hidden="true" />
          <span>Claim pass unavailable</span>
        </div>
        <h1 className="font-display text-2xl text-[#152B23] uppercase">
          No active claim voucher
        </h1>
        <p className="text-sm text-[#152B23] leading-relaxed">
          {gateError?.message ||
            'Claim instructions are only issued after the required minimum confirms before the deadline.'}
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            to={`/pools/${poolId}/offer`}
            className="px-4 py-2.5 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase text-[#152B23]"
          >
            Back to offer review
          </Link>
          <Link
            to={`/pools/${poolId}`}
            className="px-4 py-2.5 bg-white border border-[#C6D8CE] hover:border-[#152B23] font-mono text-xs uppercase text-[#152B23]"
          >
            Back to pool page
          </Link>
        </div>
      </div>
    );
  }

  const { pool, member, referenceCode } = claimData;
  const offer = pool.currentOffer!;
  const isFulfilled = member.status === 'fulfilled';

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(referenceCode).catch(() => undefined);
    setCopiedCode(true);
    showBanner('info', `Copied simulated claim reference ${referenceCode}.`);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleMarkFulfilled = async () => {
    await markFulfilledAction(pool.id);
    const updated = await fetchClaimPass(pool.id);
    setClaimData(updated);
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#C6D8CE]">
        <Link
          to={`/pools/${pool.id}/offer`}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-[#152B23] underline underline-offset-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to offer summary</span>
        </Link>
        <span className="font-mono text-[11px] uppercase text-[#516B61]">
          Private buyer claim pass · Simulated fulfillment
        </span>
      </div>

      {/* Hero Unlocked Banner */}
      <section className="bg-[#152B23] text-white border-2 border-[#152B23] p-6 sm:p-7 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#FFBF32] text-[#152B23] font-mono text-[11px] font-semibold uppercase tracking-wider">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {pool.metrics.confirmedUnits} of {pool.metrics.targetMin} {pool.unitPlural} confirmed
            </span>
          </span>
          <span className="font-mono text-xs text-[#EAF7EF]">
            Claim / pickup by {formatCalendarDate(offer.claimByDate)}
          </span>
        </div>

        <h1 className="font-display text-2xl sm:text-4xl text-[#FFBF32] uppercase">
          Your group price is unlocked
        </h1>
        <p className="text-sm text-white/90 max-w-2xl leading-relaxed">
          {pool.title} · Confirmed on Offer v{offer.version} for{' '}
          {formatUnit(member.quantity, pool.unitSingular, pool.unitPlural)}. Buyers pay{' '}
          <strong>{offer.sellerName}</strong> directly — Tally never collects payment.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right on Desktop, FIRST on Mobile: Claim Instructions & Fulfillment Toggle */}
        <aside className="lg:col-span-5 order-1 lg:order-2 space-y-4">
          <section className="bg-white border-2 border-[#152B23] shadow-[4px_4px_0px_#152B23] p-5 space-y-4">
            <div className="p-2.5 bg-[#F6F1E5] border border-[#152B23]/30 font-mono text-[11px] text-[#152B23]">
              SIMULATED DEMO WORKSPACE: No real dealer reservation, payment, or external message is
              sent.
            </div>

            <div className="space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
                Private claim reference code (simulated)
              </p>
              <div className="flex items-stretch gap-2">
                <div className="flex-1 px-3 py-2.5 bg-[#EAF7EF] border border-[#152B23] font-mono text-sm font-bold text-[#152B23] tracking-wider">
                  {referenceCode}
                </div>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  aria-label="Copy simulated reference code"
                  className="px-3 bg-[#152B23] text-white font-mono text-xs uppercase inline-flex items-center gap-1 cursor-pointer"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
                Direct seller purchase instructions
              </p>
              <p className="text-sm text-[#152B23] leading-relaxed bg-[#F6F1E5]/60 p-3 border border-[#C6D8CE]">
                {offer.privateClaimInstructions}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-3 pt-2 border-t border-[#C6D8CE] text-xs">
              <div>
                <dt className="font-mono text-[10px] uppercase text-[#516B61]">Confirmed status</dt>
                <dd className="mt-0.5 font-semibold text-[#152B23]">
                  ✓ Confirmed (v{offer.version})
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase text-[#516B61]">Fulfillment status</dt>
                <dd className="mt-0.5 font-semibold text-[#152B23]">
                  {isFulfilled ? '✓ Fulfilled' : 'Not yet fulfilled'}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase text-[#516B61]">Claim deadline</dt>
                <dd className="mt-0.5 font-mono font-semibold text-[#A63A2B]">
                  {formatCalendarDate(offer.claimByDate)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase text-[#516B61]">Group progress</dt>
                <dd className="mt-0.5 font-mono text-[#152B23] tabular-nums">
                  {pool.metrics.fulfilledUnits} of {pool.metrics.confirmedUnits} fulfilled
                </dd>
              </div>
            </dl>

            {/* Separate Confirmation vs Fulfillment Action */}
            <div className="pt-3 border-t border-[#C6D8CE] space-y-2">
              {isFulfilled ? (
                <div className="p-3.5 bg-[#EAF7EF] border-2 border-[#152B23] text-xs text-[#152B23] space-y-1">
                  <p className="font-mono font-semibold uppercase flex items-center gap-1.5">
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>Recorded as fulfilled</span>
                  </p>
                  <p className="text-[#516B61]">
                    Marked fulfilled{' '}
                    {member.fulfilledAt ? formatDateTimePacific(member.fulfilledAt) : 'today'}.
                  </p>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleMarkFulfilled()}
                    className="w-full py-3.5 px-4 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60"
                  >
                    {busy ? 'Recording…' : 'Mark fulfilled (completed directly with seller)'}
                  </button>
                  <p className="text-[11px] text-[#516B61]">
                    Only mark fulfilled after completing your simulated direct purchase with{' '}
                    {offer.sellerName}. Confirmed and fulfilled are tracked separately.
                  </p>
                </>
              )}
            </div>
          </section>
        </aside>

        {/* Left on Desktop: Full Locked Quote Receipt */}
        <div className="lg:col-span-7 order-2 lg:order-1">
          <QuoteReceipt
            offer={offer}
            unitSingular={pool.unitSingular}
            unitPlural={pool.unitPlural}
            quantity={member.quantity}
          />
        </div>
      </div>
    </div>
  );
}
