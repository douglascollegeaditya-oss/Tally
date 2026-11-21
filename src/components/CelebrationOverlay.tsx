import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Award, Check, MapPin, Stamp, X } from 'lucide-react';
import {
  resolveCelebrationPresentation,
  type CelebrationEvent,
} from '../domain/celebrationEngine.ts';
import { useTally } from '../lib/api.ts';
import { formatUnit } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import { SegmentedTally } from './SegmentedTally.tsx';

interface SlipParticle {
  id: number;
  tx: string;
  ty: string;
  rot: string;
  delay: string;
  width: number;
  height: number;
  color: string;
  border: string;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (ev: MediaQueryListEvent) => {
      setReduced(ev.matches);
    };
    setReduced(mq.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

function generateDeterministicSlips(count: number, kind: CelebrationEvent['kind']): SlipParticle[] {
  const joinPalette = [
    { color: '#FFBF32', border: '#152B23' },
    { color: '#F6F1E5', border: '#152B23' },
    { color: '#EAF7EF', border: '#1E4334' },
    { color: '#28463B', border: '#FFBF32' },
  ];
  const targetPalette = [
    { color: '#FFBF32', border: '#152B23' },
    { color: '#F2B01E', border: '#152B23' },
    { color: '#FBF9F4', border: '#FFBF32' },
    { color: '#1E4334', border: '#FFBF32' },
  ];
  const palette = kind === 'target_reached' ? targetPalette : joinPalette;

  return Array.from({ length: count }).map((_, index) => {
    const angle = (index / count) * Math.PI * 2 + (index % 2 === 0 ? 0.14 : -0.14);
    // Viewport-relative distances so slips clear the card perimeter on both mobile (390px) and desktop (1440px)
    const radiusVw = 24 + ((index * 7) % 21); // 24vw - 44vw
    const radiusVh = 24 + ((index * 9) % 22); // 24vh - 45vh
    const tx = `${(Math.cos(angle) * radiusVw).toFixed(1)}vw`;
    const ty = `${(Math.sin(angle) * radiusVh).toFixed(1)}vh`;
    const rot = `${Math.round((index % 2 === 0 ? 1 : -1) * (55 + ((index * 31) % 145)))}deg`;
    const delay = `${(index % 6) * 35}ms`;
    const swatch = palette[index % palette.length];
    return {
      id: index,
      tx,
      ty,
      rot,
      delay,
      width: index % 3 === 0 ? 20 : 13,
      height: index % 3 === 0 ? 9 : 6,
      color: swatch.color,
      border: swatch.border,
    };
  });
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const nodes = container.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
  );
  return Array.from(nodes).filter(
    (el) => el.offsetParent !== null && !el.hasAttribute('aria-hidden')
  );
}

export function CelebrationOverlay() {
  const {
    activeCelebration,
    queuedCelebrationCount,
    celebrationStepIndex,
    celebrationTotalSteps,
    advanceCelebrationAction,
    dismissAllCelebrationsAction,
  } = useTally();
  const { pathname, navigate } = useRouter();
  const prefersReducedMotion = usePrefersReducedMotion();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const presentation = useMemo(() => {
    if (!activeCelebration) return null;
    return resolveCelebrationPresentation(activeCelebration, prefersReducedMotion);
  }, [activeCelebration, prefersReducedMotion]);

  const slips = useMemo(() => {
    if (!activeCelebration || !presentation || !presentation.allowConfetti) return [];
    return generateDeterministicSlips(presentation.particleCount, activeCelebration.kind);
  }, [activeCelebration, presentation]);

  // Save & restore focus cleanly across open -> transition -> close lifecycle
  useEffect(() => {
    if (activeCelebration) {
      if (!wasOpenRef.current) {
        previousFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        wasOpenRef.current = true;
      }

      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const rafId = window.requestAnimationFrame(() => {
        primaryButtonRef.current?.focus({ preventScroll: true });
      });

      return () => {
        window.cancelAnimationFrame(rafId);
        document.body.style.overflow = prevOverflow;
      };
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const toRestore = previousFocusRef.current;
      previousFocusRef.current = null;
      if (toRestore && toRestore.isConnected) {
        window.requestAnimationFrame(() => {
          toRestore.focus({ preventScroll: true });
        });
      }
    }
    return undefined;
  }, [activeCelebration]);

  // Keyboard handling: Escape always dismisses cleanly; Tab cycles within open dialog
  useEffect(() => {
    if (!activeCelebration) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissAllCelebrationsAction();
        return;
      }

      if (event.key === 'Tab') {
        const focusables = getFocusableElements(dialogRef.current);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const current = document.activeElement as HTMLElement | null;

        if (event.shiftKey) {
          if (!current || current === first || !dialogRef.current?.contains(current)) {
            event.preventDefault();
            last.focus();
          }
        } else if (!current || current === last || !dialogRef.current?.contains(current)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCelebration, dismissAllCelebrationsAction]);

  if (!activeCelebration || !presentation) {
    return null;
  }

  const isTargetReached = activeCelebration.kind === 'target_reached';
  const hasNextQueued = queuedCelebrationCount > 0;
  const showSequenceIndicator = celebrationTotalSteps > 1;
  const showSecondaryNav = Boolean(
    activeCelebration.secondaryCtaHref &&
      activeCelebration.secondaryCtaLabel &&
      activeCelebration.secondaryCtaHref !== pathname
  );

  const handlePrimaryAction = () => {
    advanceCelebrationAction();
  };

  const handleSecondaryNavigate = () => {
    const dest = activeCelebration.secondaryCtaHref;
    dismissAllCelebrationsAction();
    if (dest) {
      navigate(dest);
    }
  };

  const headingId = `tally-celebration-heading-${activeCelebration.kind}`;
  const descId = `tally-celebration-desc-${activeCelebration.kind}`;

  return (
    <div
      key={activeCelebration.id}
      data-testid="celebration-overlay"
      data-celebration-kind={activeCelebration.kind}
      data-threshold-kind={activeCelebration.thresholdKind ?? ''}
      data-motion-mode={presentation.mode}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      aria-describedby={descId}
      className={`fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 overflow-y-auto ${
        presentation.enableMotion ? 'tally-anim-backdrop' : ''
      } ${
        isTargetReached
          ? 'bg-[#152B23]/94'
          : 'bg-[#152B23]/82'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          dismissAllCelebrationsAction();
        }
      }}
    >
      {/* Screen-reader live announcement */}
      <div role="status" aria-live="assertive" aria-atomic="true" className="sr-only">
        {presentation.announcement}
      </div>

      {/* Architectural golden radial burst for Target Reached (animated mode only, non-flashing single settle) */}
      {isTargetReached && presentation.allowBurstLines && (
        <svg
          aria-hidden="true"
          viewBox="0 0 800 800"
          className="pointer-events-none fixed inset-0 m-auto w-[min(960px,145vw)] h-[min(960px,145vw)] tally-anim-rays"
        >
          <g stroke="#FFBF32" strokeWidth="1.25" opacity="0.58">
            {Array.from({ length: 16 }).map((_, idx) => {
              const rad = (idx / 16) * Math.PI * 2;
              const x1 = 400 + Math.cos(rad) * 145;
              const y1 = 400 + Math.sin(rad) * 145;
              const x2 = 400 + Math.cos(rad) * 385;
              const y2 = 400 + Math.sin(rad) * 385;
              return <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2} />;
            })}
            <circle cx="400" cy="400" r="245" fill="none" strokeDasharray="6 8" opacity="0.45" />
            <circle cx="400" cy="400" r="325" fill="none" strokeDasharray="2 10" opacity="0.35" />
          </g>
        </svg>
      )}

      {/* Geometric editorial ledger confetti slips (animated mode only; 0 rendered under reduced motion) */}
      {presentation.allowConfetti && slips.length > 0 && (
        <div
          aria-hidden="true"
          data-testid="celebration-particles"
          className="pointer-events-none fixed inset-0 z-[5] flex items-center justify-center overflow-hidden"
        >
          {slips.map((slip) => (
            <span
              key={slip.id}
              className="absolute block tally-anim-slip"
              style={
                {
                  width: `${slip.width}px`,
                  height: `${slip.height}px`,
                  backgroundColor: slip.color,
                  border: `1px solid ${slip.border}`,
                  '--tx': slip.tx,
                  '--ty': slip.ty,
                  '--rot': slip.rot,
                  '--delay': slip.delay,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}

      {/* Stage Card — Visually & Verbally Distinct per Celebration Kind */}
      {isTargetReached ? (
        /* EVENT 2: TARGET THRESHOLD REACHED — Deep Spruce & Marigold Gold Broadsheet Takeover */
        <div
          ref={dialogRef}
          className={`relative z-10 w-full max-w-[540px] bg-[#152B23] text-[#FBF9F4] border-2 border-[#FFBF32] shadow-[8px_8px_0px_#FFBF32] ${
            presentation.enableMotion ? 'tally-anim-broadsheet' : ''
          }`}
        >
          {/* Top Marigold Broadsheet Header Strip */}
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 bg-[#FFBF32] text-[#152B23] border-b-2 border-[#152B23]">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider">
              <Award className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{activeCelebration.kicker}</span>
            </div>
            <button
              type="button"
              onClick={dismissAllCelebrationsAction}
              aria-label="Close target reached celebration"
              className="p-1 border border-[#152B23] bg-[#FBF9F4] hover:bg-[#152B23] text-[#152B23] hover:text-[#FFBF32] cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="p-5 sm:p-7 space-y-5">
            {/* Chained sequence indicator when preceded by pool_joined */}
            {showSequenceIndicator && (
              <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-wider text-[#FFBF32] border border-[#FFBF32]/40 bg-[#1E4334] px-3 py-1.5">
                <span className="min-w-0">
                  Moment {celebrationStepIndex} of {celebrationTotalSteps} · Target threshold crossed
                </span>
                <span className="font-bold whitespace-nowrap shrink-0">02 / 02</span>
              </div>
            )}

            {/* Gold Emblem + Headline */}
            <div className="flex items-start gap-4">
              <div
                aria-hidden="true"
                className={`w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-[#FFBF32] text-[#152B23] border-2 border-[#FBF9F4] flex items-center justify-center ${
                  presentation.allowStampBounce ? 'tally-anim-seal' : ''
                }`}
              >
                <Check className="w-7 h-7 stroke-[3]" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <h2
                  id={headingId}
                  className="font-display text-2xl sm:text-3xl leading-[1.06] tracking-tight uppercase text-[#FFBF32]"
                >
                  {activeCelebration.headline}
                </h2>
                <p className="font-heading text-base sm:text-lg font-bold text-white leading-snug">
                  {activeCelebration.subheadline}
                </p>
                <p className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#C6D8CE]">
                  <MapPin className="w-3.5 h-3.5 text-[#FFBF32] shrink-0" aria-hidden="true" />
                  <span>
                    {activeCelebration.location} · {activeCelebration.category}
                  </span>
                </p>
              </div>
            </div>

            <div
              aria-hidden="true"
              className={`h-[2px] w-full bg-[#FFBF32] ${
                presentation.enableMotion ? 'tally-anim-rule' : ''
              }`}
            />

            {/* Authoritative Target Metric Ledger */}
            <div className="p-4 bg-[#1E4334] border border-[#FFBF32]/50 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[#C6D8CE]">
                  Authoritative group tally
                </span>
                <span className="px-2 py-0.5 bg-[#FFBF32] text-[#152B23] font-mono text-[10px] font-bold uppercase tracking-wider">
                  {activeCelebration.stageLabel}
                </span>
              </div>
              <p className="font-display text-xl sm:text-2xl text-white tabular-nums tracking-tight">
                {activeCelebration.currentCount} OF {activeCelebration.targetMin}{' '}
                {activeCelebration.unitPlural.toUpperCase()}{' '}
                {activeCelebration.countVerb.toUpperCase()}
              </p>
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(
                    Math.max(1, activeCelebration.targetMin),
                    10
                  )}, minmax(0, 1fr))`,
                }}
                aria-hidden="true"
              >
                {Array.from({
                  length: Math.min(Math.max(1, activeCelebration.targetMin), 10),
                }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-6 bg-[#FFBF32] border border-[#152B23] flex items-center justify-center text-[#152B23]"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.75]" />
                  </div>
                ))}
              </div>
            </div>

            <p id={descId} className="text-sm leading-relaxed text-[#EFF3ED]">
              {activeCelebration.detail}
            </p>

            {/* Accessible Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
              <button
                ref={primaryButtonRef}
                type="button"
                onClick={handlePrimaryAction}
                className="tally-focus-dark inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border-2 border-[#FFBF32] font-mono text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                <span>{activeCelebration.primaryCtaLabel}</span>
                <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              </button>

              {showSecondaryNav && (
                <button
                  type="button"
                  onClick={handleSecondaryNavigate}
                  className="tally-focus-dark w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-3 bg-[#1E4334] hover:bg-[#28463B] text-white border border-[#FFBF32]/70 font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer"
                >
                  <span>{activeCelebration.secondaryCtaLabel}</span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                </button>
              )}
            </div>

            <p className="font-mono text-[10px] uppercase tracking-wider text-[#C6D8CE]/85">
              Press Escape or select Continue to return to your pool
            </p>
          </div>
        </div>
      ) : (
        /* EVENT 1: BUYER JOINED POOL — Warm Parchment & Spruce Ledger-Stamp Ticket */
        <div
          ref={dialogRef}
          className={`relative z-10 w-full max-w-[520px] bg-[#FBF9F4] text-[#152B23] border-2 border-[#152B23] shadow-[8px_8px_0px_#FFBF32] ${
            presentation.enableMotion ? 'tally-anim-ticket' : ''
          }`}
        >
          {/* Editorial Ticket Top Bar */}
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 bg-[#1E4334] text-white border-b-2 border-[#152B23]">
            <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider">
              <Stamp className="w-4 h-4 text-[#FFBF32] shrink-0" aria-hidden="true" />
              <span>{activeCelebration.kicker}</span>
            </div>
            <button
              type="button"
              onClick={dismissAllCelebrationsAction}
              aria-label="Close pool joined celebration"
              className="tally-focus-dark p-1 border border-white/40 bg-[#152B23] hover:bg-[#FFBF32] text-white hover:text-[#152B23] cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="p-5 sm:p-7 space-y-5">
            {/* Sequence banner when this join ALSO crossed the target threshold */}
            {showSequenceIndicator && (
              <div className="flex items-center justify-between gap-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#152B23] bg-[#FFBF32]/30 border border-[#152B23] px-3 py-1.5">
                <span className="min-w-0">
                  Moment {celebrationStepIndex} of {celebrationTotalSteps} · Joined pool (target
                  crossed next)
                </span>
                <span className="whitespace-nowrap shrink-0">01 / 02</span>
              </div>
            )}

            {/* Ledger Stamp Seal + Headline */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1.5">
                <h2
                  id={headingId}
                  className="font-display text-2xl sm:text-3xl leading-[1.06] tracking-tight uppercase text-[#152B23]"
                >
                  {activeCelebration.headline}
                </h2>
                <p className="font-heading text-base sm:text-lg font-bold text-[#1E4334] leading-snug">
                  {activeCelebration.subheadline}
                </p>
                <p className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#4E6359]">
                  <MapPin className="w-3.5 h-3.5 text-[#8C9A86] shrink-0" aria-hidden="true" />
                  <span>
                    {activeCelebration.location} · {activeCelebration.category}
                  </span>
                </p>
              </div>

              {/* Ink Stamp Emblem */}
              <div
                aria-hidden="true"
                className={`shrink-0 px-2.5 py-2 border-2 border-[#152B23] bg-[#FFBF32] text-[#152B23] text-center ${
                  presentation.allowStampBounce ? 'tally-anim-stamp' : ''
                }`}
              >
                <Check className="w-5 h-5 mx-auto stroke-[3]" />
                <span className="block mt-0.5 font-mono text-[9px] font-bold uppercase tracking-wider leading-none">
                  JOINED
                </span>
              </div>
            </div>

            {/* Perforated Ledger Divider */}
            <div aria-hidden="true" className="border-t-2 border-dashed border-[#CDD6CC]" />

            {/* Live Updated Tally Snapshot */}
            <div className="p-4 bg-[#F6F1E5] border border-[#152B23]/25 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <span className="font-semibold text-[#1E4334] uppercase tracking-wider">
                  {activeCelebration.quantityJoined !== undefined
                    ? `Your spot: +${formatUnit(
                        activeCelebration.quantityJoined,
                        activeCelebration.unitSingular,
                        activeCelebration.unitPlural
                      )}`
                    : 'Your spot recorded'}
                </span>
                <span className="px-2 py-0.5 bg-white border border-[#152B23] text-[10px] font-semibold uppercase text-[#152B23]">
                  {activeCelebration.stageLabel}
                </span>
              </div>

              <SegmentedTally
                current={activeCelebration.currentCount}
                target={activeCelebration.targetMin}
                unitSingular={activeCelebration.unitSingular}
                unitPlural={activeCelebration.unitPlural}
                verb={activeCelebration.countVerb}
                rightLabel={
                  activeCelebration.currentCount >= activeCelebration.targetMin
                    ? 'Minimum met'
                    : `${Math.max(
                        0,
                        activeCelebration.targetMin - activeCelebration.currentCount
                      )} more needed`
                }
              />
            </div>

            <p id={descId} className="text-sm leading-relaxed text-[#4E6359]">
              {activeCelebration.detail}
            </p>

            {/* Accessible Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
              <button
                ref={primaryButtonRef}
                type="button"
                onClick={handlePrimaryAction}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border-2 border-[#152B23] font-mono text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                <span>{activeCelebration.primaryCtaLabel}</span>
                <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              </button>

              {showSecondaryNav && !hasNextQueued && (
                <button
                  type="button"
                  onClick={handleSecondaryNavigate}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-3 bg-white hover:bg-[#1E4334] text-[#152B23] hover:text-white border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider cursor-pointer"
                >
                  <span>{activeCelebration.secondaryCtaLabel}</span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                </button>
              )}
              {hasNextQueued && (
                <button
                  type="button"
                  onClick={dismissAllCelebrationsAction}
                  className="w-full sm:w-auto px-3.5 py-3 bg-white hover:bg-[#ECEEE7] text-[#4E6359] hover:text-[#152B23] border border-[#CDD6CC] font-mono text-xs uppercase tracking-wider cursor-pointer"
                >
                  Dismiss
                </button>
              )}
            </div>

            <p className="font-mono text-[10px] uppercase tracking-wider text-[#4E6359]">
              {hasNextQueued
                ? 'Select Next to see the target-reached milestone, or press Escape to close'
                : 'Press Escape or select Continue to close'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
