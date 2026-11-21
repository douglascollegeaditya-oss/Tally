import { Check } from 'lucide-react';
import { formatUnit } from '../lib/format.ts';

interface SegmentedTallyProps {
  current: number;
  target: number;
  unitSingular: string;
  unitPlural: string;
  verb: string; // e.g., "interested", "confirmed", "fulfilled"
  variant?: 'bar' | 'ticket' | 'checks';
  slotLabels?: string[];
  rightLabel?: string;
  compact?: boolean;
}

export function SegmentedTally({
  current,
  target,
  unitSingular,
  unitPlural,
  verb,
  variant = 'bar',
  slotLabels = [],
  rightLabel,
  compact = false,
}: SegmentedTallyProps) {
  const safeTarget = Math.max(1, target);
  // Keep discrete segments readable even for pools with 20+ units (e.g., cap visual boxes at 12 while printing exact count)
  const displaySlots = Math.min(safeTarget, variant === 'bar' ? 12 : 10);
  const filledCount =
    safeTarget <= displaySlots
      ? Math.min(current, displaySlots)
      : Math.min(displaySlots, Math.round((current / safeTarget) * displaySlots));

  const countText = `${current} of ${formatUnit(target, unitSingular, unitPlural)} ${verb}`;
  const isComplete = current >= target;

  if (variant === 'checks') {
    return (
      <div className="space-y-2" aria-label={countText}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-lg sm:text-xl tracking-tight text-[#152B23] tabular-nums">
            {current} OF {target} {unitPlural.toUpperCase()} {verb.toUpperCase()}
          </p>
          {rightLabel && (
            <span className="font-mono text-xs text-[#516B61]">{rightLabel}</span>
          )}
        </div>
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${displaySlots}, minmax(0, 1fr))` }}
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-label={countText}
        >
          {Array.from({ length: displaySlots }).map((_, idx) => {
            const filled = idx < filledCount;
            const isLastFilled = filled && idx === filledCount - 1;
            return (
              <div
                key={idx}
                className={`tally-segment h-7 flex items-center justify-center border font-mono text-xs font-semibold ${
                  filled
                    ? isComplete
                      ? 'bg-[#152B23] border-[#152B23] text-[#FFBF32]'
                      : isLastFilled
                        ? 'bg-[#FFBF32] border-[#152B23] text-[#152B23]'
                        : 'bg-[#FFBF32]/85 border-[#152B23] text-[#152B23]'
                    : 'bg-[#EAF7EF] border-[#C6D8CE] text-[#516B61]'
                }`}
              >
                {filled ? <Check className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" /> : '?'}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (variant === 'ticket') {
    return (
      <div className="space-y-2" aria-label={countText}>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${displaySlots}, minmax(0, 1fr))` }}
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-label={countText}
        >
          {Array.from({ length: displaySlots }).map((_, idx) => {
            const filled = idx < filledCount;
            const isLastFilled = filled && idx === filledCount - 1;
            const label = slotLabels[idx] || String(idx + 1);
            return (
              <div
                key={idx}
                className={`tally-segment h-8 flex items-center justify-center border font-mono text-[10px] font-semibold tracking-tight ${
                  filled
                    ? isLastFilled
                      ? 'bg-[#FFBF32] border-[#152B23] text-[#152B23]'
                      : 'bg-[#152B23] border-[#152B23] text-white'
                    : 'bg-[#EAF7EF]/60 border-dashed border-[#A9BEB2] text-[#516B61]'
                }`}
                title={filled ? `Filled spot ${idx + 1}` : `Open spot ${idx + 1}`}
              >
                {label}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Default 'bar' variant matching tally-explore.jpg (spruce filled, marigold on last filled segment)
  return (
    <div className="space-y-1.5" aria-label={countText}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span
          className={`font-mono font-semibold text-[#152B23] tabular-nums ${
            compact ? 'text-[11px]' : 'text-xs'
          }`}
        >
          {current} of {formatUnit(target, unitSingular, unitPlural)} {verb}
        </span>
        {rightLabel && (
          <span className="font-mono text-[11px] text-[#516B61]">{rightLabel}</span>
        )}
      </div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${displaySlots}, minmax(0, 1fr))` }}
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-label={countText}
      >
        {Array.from({ length: displaySlots }).map((_, idx) => {
          const filled = idx < filledCount;
          const isLastFilled = filled && idx === filledCount - 1;
          return (
            <div
              key={idx}
              className={`tally-segment ${compact ? 'h-2.5' : 'h-3.5'} border ${
                filled
                  ? isLastFilled
                    ? 'bg-[#FFBF32] border-[#152B23]'
                    : 'bg-[#152B23] border-[#152B23]'
                  : 'bg-[#EAF7EF] border-[#C6D8CE]'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
