import { ArrowRight, Clock, History } from 'lucide-react';
import { evaluateMemberEligibility } from '../domain/tallyEngine.ts';
import { type ClientPool, useTally } from '../lib/api.ts';
import {
  formatCalendarDate,
  formatCurrency,
  formatDateTimePacific,
  formatShortDate,
  getStageLabel,
  getStageToneClasses,
} from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import { SegmentedTally } from '../components/SegmentedTally.tsx';

function getMemberSummary(pool: ClientPool, actorId: string) {
  const member = pool.members.find((m) => m.userId === actorId);
  if (!member) return { personalStatus: 'Following', needsAction: false, waiting: false, ended: false };

  const elig = evaluateMemberEligibility(pool, member);
  const st = pool.metrics.effectiveStage;
  const offer = pool.currentOffer;

  if (!elig.eligible) {
    return {
      personalStatus: 'Excluded (edit options)',
      needsAction: st === 'gathering' || st === 'ready_for_quote' || st === 'offer_open',
      waiting: false,
      ended: st === 'expired' || st === 'closed',
    };
  }

  if (st === 'offer_open' && offer) {
    const confirmedCur =
      (member.status === 'confirmed' || member.status === 'fulfilled') &&
      member.confirmedVersion === offer.version &&
      !member.needsReconfirmation;
    if (!confirmedCur && member.status !== 'passed') {
      return {
        personalStatus: member.needsReconfirmation
          ? `Reconfirm Offer v${offer.version}`
          : `Confirm or pass on Offer v${offer.version}`,
        needsAction: true,
        waiting: false,
        ended: false,
      };
    }
    if (confirmedCur) {
      return {
        personalStatus: `Confirmed v${offer.version} · Waiting on ${pool.metrics.remainingToMinimum} more`,
        needsAction: false,
        waiting: true,
        ended: false,
      };
    }
    return {
      personalStatus: 'Passed on current offer',
      needsAction: false,
      waiting: false,
      ended: true,
    };
  }

  if (st === 'unlocked') {
    if (member.status === 'fulfilled') {
      return {
        personalStatus: 'Fulfilled directly with seller',
        needsAction: false,
        waiting: false,
        ended: true,
      };
    }
    if (member.status === 'confirmed') {
      return {
        personalStatus: 'Unlocked — Claim & mark fulfilled',
        needsAction: true,
        waiting: false,
        ended: false,
      };
    }
  }

  if (st === 'expired' || st === 'closed') {
    return {
      personalStatus: st === 'expired' ? 'Offer expired short' : 'Completed cohort',
      needsAction: false,
      waiting: false,
      ended: true,
    };
  }

  if (st === 'quote_requested') {
    return {
      personalStatus: 'Waiting for seller quote',
      needsAction: false,
      waiting: true,
      ended: false,
    };
  }

  return {
    personalStatus:
      st === 'ready_for_quote'
        ? 'Waiting for the organizer to request quotes'
        : 'Eligible · Gathering',
    needsAction: false,
    waiting: true,
    ended: false,
  };
}

function PoolStatusRow({
  pool,
  actorId,
  role,
  isOrganizerList = false,
}: {
  pool: ClientPool;
  actorId: string;
  role: string;
  isOrganizerList?: boolean;
}) {
  const st = pool.metrics.effectiveStage;
  const info = getMemberSummary(pool, actorId);
  const milestoneText = pool.currentOffer
    ? st === 'unlocked'
      ? `Claim by ${formatCalendarDate(pool.currentOffer.claimByDate)}`
      : `Closes ${formatDateTimePacific(pool.currentOffer.closeAt, pool.currentOffer.timezoneLabel)}`
    : `Goal ${formatCalendarDate(pool.goalDate)}`;

  const targetHref = isOrganizerList
    ? `/pools/${pool.id}/organize`
    : st === 'unlocked' && role === 'buyer' && info.personalStatus.includes('Claim')
      ? `/pools/${pool.id}/claim`
      : st === 'offer_open' || st === 'expired'
        ? `/pools/${pool.id}/offer`
        : `/pools/${pool.id}`;

  const ctaText = isOrganizerList
    ? st === 'ready_for_quote'
      ? 'Request seller quote'
      : 'Manage pool'
    : st === 'unlocked' && role === 'buyer' && info.personalStatus.includes('Claim')
      ? 'Open claim pass'
      : st === 'offer_open'
        ? 'Review offer'
        : 'Open pool';

  return (
    <article className="bg-white border border-[#C6D8CE] p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="space-y-2 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#516B61]">
            {pool.category} · {pool.location}
          </span>
          <span
            className={`px-2 py-0.5 border font-mono text-[10px] font-semibold uppercase ${getStageToneClasses(
              st
            )}`}
          >
            {getStageLabel(st)}
          </span>
        </div>

        <h3 className="font-heading text-base sm:text-lg font-bold text-[#152B23] truncate">
          {pool.title}
        </h3>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#516B61]">
          <span className="font-medium text-[#152B23]">
            Status: {isOrganizerList ? `Organizing · ${pool.metrics.eligibleInterestedUnits} eligible` : info.personalStatus}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[11px]">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {milestoneText}
          </span>
          {pool.currentOffer && (
            <span className="font-mono text-[11px] text-[#152B23] tabular-nums">
              Offer v{pool.currentOffer.version}: {formatCurrency(pool.currentOffer.subtotal)}
              {pool.offerHistory.length > 0 ? ` (${pool.offerHistory.length} prior)` : ''}
            </span>
          )}
        </div>

        <div className="max-w-md pt-1">
          <SegmentedTally
            current={
              st === 'offer_open' || st === 'unlocked' || st === 'expired'
                ? pool.metrics.confirmedUnits
                : pool.metrics.eligibleInterestedUnits
            }
            target={pool.metrics.targetMin}
            unitSingular={pool.unitSingular}
            unitPlural={pool.unitPlural}
            verb={st === 'offer_open' || st === 'unlocked' || st === 'expired' ? 'confirmed' : 'interested'}
            compact
          />
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          to={targetHref}
          className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 border font-mono text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
            info.needsAction || (isOrganizerList && st === 'ready_for_quote')
              ? 'bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border-[#152B23]'
              : 'bg-[#EAF7EF]/60 hover:bg-[#152B23] text-[#152B23] hover:text-white border-[#C6D8CE] hover:border-[#152B23]'
          }`}
        >
          <span>{ctaText}</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

export function MyPoolsPage() {
  const { session, role } = useTally();

  const pools = session?.pools ?? [];
  const actorId = session?.actor.id ?? 'buyer-maya';
  const activity = session?.activity ?? [];

  const organizedPools = pools.filter((p) => p.organizerId === actorId);
  const memberPools = pools.filter(
    (p) => p.members.some((m) => m.userId === actorId) || p.followers.includes(actorId)
  );

  const needsAction = memberPools.filter((p) => getMemberSummary(p, actorId).needsAction);
  const waiting = memberPools.filter((p) => getMemberSummary(p, actorId).waiting);
  const ended = memberPools.filter((p) => getMemberSummary(p, actorId).ended);

  // Seller view shows active quoted/requested pools directly
  const sellerPools = pools.filter((p) => Boolean(p.sellerToken));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-3 border-b border-[#C6D8CE]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-[#516B61]">
            Signed-in demo persona · {session?.actor.name} ({role})
          </p>
          <h1 className="mt-1 font-display text-2xl sm:text-4xl text-[#152B23] uppercase">
            My pools & activity
          </h1>
        </div>
        <Link
          to="/start"
          className="inline-flex items-center justify-center px-4 py-2.5 bg-[#FFBF32] hover:bg-[#F2B01E] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider self-start sm:self-auto"
        >
          Start a pool
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Left 8 cols: Grouped Pools */}
        <div className="lg:col-span-8 space-y-6">
          {role === 'seller' ? (
            <section aria-label="Seller quote requests" className="space-y-3">
              <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
                Active seller quote requests ({sellerPools.length})
              </h2>
              {sellerPools.length === 0 ? (
                <div className="bg-white border border-[#C6D8CE] p-6 text-sm text-[#516B61]">
                  No seller quote requests have been dispatched yet in this session. Once an
                  organizer generates a seller link, it appears here.
                </div>
              ) : (
                <div className="space-y-3">
                  {sellerPools.map((p) => (
                    <article
                      key={p.id}
                      className="bg-white border border-[#C6D8CE] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <span className="font-mono text-[10px] uppercase text-[#516B61]">
                          {p.category} · {p.location}
                        </span>
                        <h3 className="font-heading text-base font-bold text-[#152B23]">
                          {p.title}
                        </h3>
                        <p className="text-xs text-[#516B61]">
                          {p.currentOffer
                            ? `Offer v${p.currentOffer.version} live (${formatCurrency(
                                p.currentOffer.subtotal
                              )}) · ${p.metrics.confirmedUnits}/${p.metrics.targetMin} confirmed`
                            : `Awaiting seller quote · ${p.metrics.eligibleInterestedUnits} eligible ${p.unitPlural}`}
                        </p>
                      </div>
                      <Link
                        to={`/s/${p.sellerToken}`}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#FFBF32] border border-[#152B23] font-mono text-xs font-semibold uppercase shrink-0"
                      >
                        <span>{p.currentOffer ? 'View / revise quote' : 'Submit quote'}</span>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <>
              {/* Needs Action */}
              <section aria-label="Pools needing your action" className="space-y-3">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
                  Needs action ({needsAction.length})
                </h2>
                {needsAction.length === 0 ? (
                  <p className="bg-white border border-[#C6D8CE] p-4 text-xs text-[#516B61]">
                    Nothing urgent waiting on you right now.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {needsAction.map((p) => (
                      <PoolStatusRow key={p.id} pool={p} actorId={actorId} role={role} />
                    ))}
                  </div>
                )}
              </section>

              {/* Waiting */}
              <section aria-label="Pools waiting on others" className="space-y-3">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
                  Waiting ({waiting.length})
                </h2>
                {waiting.length === 0 ? (
                  <p className="bg-white border border-[#C6D8CE] p-4 text-xs text-[#516B61]">
                    No pools currently in gathering or waiting-for-quote state.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {waiting.map((p) => (
                      <PoolStatusRow key={p.id} pool={p} actorId={actorId} role={role} />
                    ))}
                  </div>
                )}
              </section>

              {/* Pools You Organize */}
              {organizedPools.length > 0 && (
                <section aria-label="Pools you organize" className="space-y-3">
                  <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
                    Pools you organize ({organizedPools.length})
                  </h2>
                  <div className="space-y-3">
                    {organizedPools.map((p) => (
                      <PoolStatusRow
                        key={`org-${p.id}`}
                        pool={p}
                        actorId={actorId}
                        role={role}
                        isOrganizerList
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Ended & Completed */}
              <section aria-label="Ended and fulfilled pools" className="space-y-3">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]">
                  Ended & fulfilled ({ended.length})
                </h2>
                {ended.length === 0 ? (
                  <p className="bg-white border border-[#C6D8CE] p-4 text-xs text-[#516B61]">
                    No ended or completed pools yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {ended.map((p) => (
                      <PoolStatusRow key={p.id} pool={p} actorId={actorId} role={role} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Right 4 cols: Concise In-App Activity Feed & Offer History */}
        <aside aria-label="Recent in-app activity" className="lg:col-span-4 space-y-4">
          <div className="bg-white border border-[#C6D8CE] p-5 space-y-3">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23] flex items-center gap-2 pb-2 border-b border-[#C6D8CE]">
              <History className="w-3.5 h-3.5 text-[#516B61]" aria-hidden="true" />
              <span>In-app activity ({activity.length})</span>
            </h2>
            {activity.length === 0 ? (
              <p className="text-xs text-[#516B61]">No activity recorded yet.</p>
            ) : (
              <ol className="space-y-3 divide-y divide-[#C6D8CE]/60">
                {activity.slice(0, 12).map((ev) => (
                  <li key={ev.id} className="pt-2.5 first:pt-0 space-y-1">
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-[#516B61]">
                      <Link
                        to={`/pools/${ev.poolId}`}
                        className="text-[#152B23] font-semibold hover:underline truncate"
                      >
                        {ev.poolTitle}
                      </Link>
                      <span className="shrink-0">{formatShortDate(ev.createdAt)}</span>
                    </div>
                    <p className="text-xs text-[#516B61] leading-relaxed">{ev.summary}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
