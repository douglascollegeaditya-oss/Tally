import type { Pool, PoolStage } from '../domain/types.ts';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function formatUnit(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const CALENDAR_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIDNIGHT_UTC_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z$/;

/**
 * Formats a calendar date-only string (YYYY-MM-DD) without timezone day-shift.
 * Also guards legacy midnight-UTC ISO strings so calendar dates never lose a day.
 */
export function formatCalendarDate(
  dateOnlyOrIso: string,
  options?: { includeYear?: boolean }
): string {
  const trimmed = dateOnlyOrIso.trim();
  const match = CALENDAR_DATE_ONLY_RE.exec(trimmed) ?? MIDNIGHT_UTC_ISO_RE.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (!Number.isNaN(utcNoon.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        ...(options?.includeYear ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
      }).format(utcNoon);
    }
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return dateOnlyOrIso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(options?.includeYear ? { year: 'numeric' } : {}),
    timeZone: 'America/Los_Angeles',
  }).format(parsed);
}

/**
 * Formats true timestamps (e.g., activity createdAt, offer publishedAt) in Pacific time.
 * Delegates YYYY-MM-DD strings safely to formatCalendarDate.
 */
export function formatShortDate(isoOrDate: string): string {
  if (CALENDAR_DATE_ONLY_RE.test(isoOrDate.trim())) {
    return formatCalendarDate(isoOrDate);
  }
  const date = new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return isoOrDate;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(date);
}

export function formatDateTimePacific(iso: string, tzLabel = 'Pacific'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(date);
  return `${formatted.replace(':00 ', ' ').replace(' PM', ' pm').replace(' AM', ' am')} ${tzLabel}`;
}

export function formatDeadlineCompact(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const datePart = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  })
    .format(date)
    .replace(':00 ', ' ');
  return `${datePart} at ${timePart} PT`;
}

export function getInitials(displayName: string): string {
  const cleaned = displayName.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}.${parts[parts.length - 1][0]}.`.toUpperCase();
}

export function getStageLabel(stage: PoolStage): string {
  switch (stage) {
    case 'gathering':
      return 'Gathering buyers';
    case 'ready_for_quote':
      return 'Ready for quote';
    case 'quote_requested':
      return 'Waiting for quote';
    case 'offer_open':
      return 'Offer open';
    case 'unlocked':
      return 'Unlocked · Ready to claim';
    case 'expired':
      return 'Offer expired';
    case 'closed':
      return 'Past outcome';
  }
}

export function getStageToneClasses(stage: PoolStage): string {
  switch (stage) {
    case 'unlocked':
      return 'bg-[#1E4334] text-white border-[#1E4334]';
    case 'offer_open':
      return 'bg-[#FFBF32] text-[#152B23] border-[#152B23]';
    case 'ready_for_quote':
      return 'bg-[#F6F1E5] text-[#152B23] border-[#1E4334]';
    case 'quote_requested':
      return 'bg-[#F6F1E5] text-[#152B23] border-[#8C9A86]';
    case 'expired':
      return 'bg-[#FDF4F2] text-[#A63A2B] border-[#E6C4BE]';
    case 'closed':
      return 'bg-[#ECEEE7] text-[#4E6359] border-[#CDD6CC]';
    case 'gathering':
    default:
      return 'bg-[#EFF3ED] text-[#1E4334] border-[#8C9A86]';
  }
}

export function getPoolShortCode(pool: Pool): string {
  const map: Record<string, string> = {
    'pool-maverick-xlt': 'OR-0824',
    'pool-walnut-dining': 'OR-0791',
    'pool-burnside-apts': 'OR-0830',
    'pool-hood-hotel': 'OR-0812',
    'pool-vinyl-box': 'NW-0818',
    'pool-heatpump-pdx': 'OR-0640',
    'pool-ev-charger-sea': 'WA-0829',
  };
  return map[pool.id] ?? `TL-${pool.id.slice(-4).toUpperCase()}`;
}
