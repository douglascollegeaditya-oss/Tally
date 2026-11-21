import React, { useState } from 'react';
import { MapPin, SlidersHorizontal, X } from 'lucide-react';
import { useTally } from '../lib/api.ts';
import { Link, useRouter } from '../lib/router.tsx';
import { DemoControls } from './DemoControls.tsx';

export const LOCATION_OPTIONS = [
  'All locations',
  'Portland metro',
  'Hood River / Gorge',
  'Seattle metro',
  'Ships nationwide',
] as const;

const ROLE_LABELS: Record<string, string> = {
  buyer: 'Buyer',
  organizer: 'Organizer',
  seller: 'Seller',
};

export function Layout({ children }: { children: React.ReactNode }) {
  const { session, role, banner, clearBanner, loading, loadError, refresh } = useTally();
  const { pathname, searchParams, navigate, lastExploreUrl } = useRouter();
  const [demoOpen, setDemoOpen] = useState(false);

  const currentLoc = pathname === '/' ? searchParams.get('loc') || 'All locations' : 'Portland metro';
  const activeRoleLabel = ROLE_LABELS[role] ?? 'Buyer';

  // Count pools where active user is a member or organizer
  const myPoolsCount = session
    ? session.pools.filter(
        (p) =>
          p.organizerId === session.actor.id ||
          p.members.some((m) => m.userId === session.actor.id) ||
          p.followers.includes(session.actor.id)
      ).length
    : 0;

  const isExploreActive = pathname === '/';
  const isMyPoolsActive = pathname === '/my-pools';

  const handleLocationChange = (loc: string) => {
    const params = new URLSearchParams(pathname === '/' ? searchParams : undefined);
    if (loc === 'All locations') {
      params.delete('loc');
    } else {
      params.set('loc', loc);
    }
    const qs = params.toString();
    navigate(qs ? `/?${qs}` : '/');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#EAF7EF] text-[#152B23]">
      {/* Compact single-row TALLY masthead matching Stitch reference */}
      <header className="sticky top-0 z-30 bg-white border-b border-[#C6D8CE]">
        <div className="max-w-[1200px] mx-auto px-2.5 sm:px-6 h-12 sm:h-14 flex items-center justify-between gap-1.5 sm:gap-4">
          {/* Zone 1: Brand wordmark */}
          <Link
            to={lastExploreUrl}
            className="font-display text-base sm:text-xl tracking-tight text-[#152B23] uppercase whitespace-nowrap shrink-0"
          >
            TALLY
          </Link>

          {/* Zone 2: Primary navigation + location selector */}
          <nav
            aria-label="Primary navigation"
            className="flex items-center gap-1 sm:gap-3 min-w-0"
          >
            <Link
              to={lastExploreUrl}
              className={`px-2 sm:px-3.5 py-1 sm:py-1.5 font-mono text-[10px] sm:text-xs font-medium uppercase tracking-wider whitespace-nowrap shrink-0 transition-colors ${
                isExploreActive
                  ? 'bg-[#152B23] text-white'
                  : 'text-[#152B23] hover:bg-[#EAF7EF]'
              }`}
            >
              Explore
            </Link>
            <Link
              to="/my-pools"
              className={`px-2 sm:px-3.5 py-1 sm:py-1.5 font-mono text-[10px] sm:text-xs font-medium uppercase tracking-wider whitespace-nowrap shrink-0 transition-colors ${
                isMyPoolsActive
                  ? 'bg-[#FFBF32] text-[#152B23] border border-[#152B23]'
                  : 'text-[#152B23] hover:bg-[#EAF7EF]'
              }`}
            >
              My pools ({myPoolsCount})
            </Link>

            <label className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#EAF7EF]/70 border border-[#C6D8CE] text-xs font-mono text-[#152B23] shrink-0">
              <MapPin className="w-3.5 h-3.5 text-[#516B61] shrink-0" aria-hidden="true" />
              <span className="sr-only">Filter by location</span>
              <select
                aria-label="Filter directory by location"
                value={currentLoc}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="bg-transparent text-xs font-mono text-[#152B23] focus:outline-none cursor-pointer pr-1"
              >
                {LOCATION_OPTIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </label>
          </nav>

          {/* Zone 3: Primary CTA + Discoverable non-overlapping Demo controls button */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Link
              to="/start"
              className="px-2 sm:px-3.5 py-1.5 sm:py-2 bg-[#FFBF32] hover:bg-[#F2B01E] text-[#152B23] border border-[#152B23] font-mono text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 transition-colors"
            >
              Start a pool
            </Link>
            <button
              type="button"
              onClick={() => setDemoOpen((v) => !v)}
              aria-expanded={demoOpen}
              aria-controls="tally-demo-controls-panel"
              aria-label={`Demo controls · ${activeRoleLabel}`}
              title={`Demo controls · ${activeRoleLabel}`}
              className={`inline-flex items-center justify-center gap-1.5 h-[30px] sm:h-[34px] px-2 sm:px-2.5 border font-mono text-[10px] sm:text-[11px] uppercase tracking-wider cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                demoOpen
                  ? 'bg-[#28463B] text-white border-[#152B23]'
                  : 'bg-[#152B23] text-white border-[#152B23] hover:bg-[#28463B]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#FFBF32] shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Demo</span>
              <span className="hidden md:inline text-[#FFBF32] font-semibold">
                · {activeRoleLabel}
              </span>
            </button>
          </div>
        </div>

        {/* Non-intrusive compact banner for state feedback — pinned cleanly below header nav */}
        {banner && (
          <div
            role="status"
            aria-live="polite"
            className={`border-t ${
              banner.kind === 'error'
                ? 'bg-[#FDF0EE] border-[#E8C2BC] text-[#A63A2B]'
                : banner.kind === 'success'
                  ? 'bg-[#152B23] border-[#152B23] text-white'
                  : 'bg-[#F6F1E5] border-[#C6D8CE] text-[#152B23]'
            }`}
          >
            <div className="max-w-[1200px] mx-auto px-3 sm:px-6 py-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="leading-snug">{banner.text}</span>
              <button
                type="button"
                onClick={clearBanner}
                aria-label="Dismiss message"
                className="p-0.5 opacity-80 hover:opacity-100 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content (reserves space on mobile for compact sticky buyer bar when scrolled) */}
      <main className="flex-1 w-full max-w-[1200px] mx-auto px-3 sm:px-6 py-3 sm:py-7 pb-20 sm:pb-14">
        {loading && !session ? (
          <div className="bg-white border border-[#C6D8CE] p-8 text-center">
            <p className="font-mono text-xs uppercase tracking-wider text-[#516B61]">
              Loading buying circular…
            </p>
          </div>
        ) : loadError && !session ? (
          <div className="bg-white border border-[#A63A2B] p-6 max-w-lg mx-auto">
            <h1 className="font-display text-lg text-[#152B23]">Unable to load workspace</h1>
            <p className="mt-2 text-sm text-[#516B61]">{loadError}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-4 px-4 py-2 bg-[#FFBF32] border border-[#152B23] font-mono text-xs uppercase font-semibold cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          children
        )}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="bg-white border-t border-[#C6D8CE] mt-auto pb-16 sm:pb-0">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[#516B61]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-display text-sm text-[#152B23] uppercase">TALLY</span>
            <span aria-hidden="true">·</span>
            <span>Simulated neighborhood buying demo — fictional sellers, no real payments.</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[#516B61]">
            <span>Viewing as {activeRoleLabel} · Direct seller payment after unlock</span>
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="text-[#152B23] underline underline-offset-4 hover:text-[#28463B] cursor-pointer"
            >
              Open Demo controls
            </button>
          </div>
        </div>
      </footer>

      <DemoControls open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
