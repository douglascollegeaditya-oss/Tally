import { useState } from 'react';
import {
  Clock,
  Copy,
  FileEdit,
  PlusCircle,
  RotateCcw,
  UserCheck,
  X,
} from 'lucide-react';
import type { DemoScenarioId, PersonaRole } from '../domain/types.ts';
import { ApiRequestError, useTally } from '../lib/api.ts';
import { formatDateTimePacific } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';

const SCENARIOS: { id: DemoScenarioId; label: string; detail: string }[] = [
  { id: 'gathering-7-of-8', label: 'Gathering (7/8)', detail: 'Join to reach 8 of 8' },
  { id: 'ready-for-quote', label: 'Ready for quote', detail: '8 of 8 ready for organizer' },
  { id: 'reviewing-6-of-8', label: 'Reviewing (6/8)', detail: 'Offer v1 live, 2 needed' },
  { id: 'just-unlocked', label: 'Just unlocked', detail: '8 of 8 confirmed, claim open' },
  { id: 'missed-deadline', label: 'Missed deadline', detail: '7 of 8, expired short' },
];

const ROLES: { id: PersonaRole; label: string; person: string }[] = [
  { id: 'buyer', label: 'Buyer', person: 'Maya Chen' },
  { id: 'organizer', label: 'Organizer', person: 'Devon Brooks' },
  { id: 'seller', label: 'Seller', person: 'Alder Motor Co.' },
];

interface DemoControlsProps {
  open: boolean;
  onClose: () => void;
}

export function DemoControls({ open, onClose }: DemoControlsProps) {
  const {
    sessionId,
    role,
    session,
    busy,
    setRole,
    createIsolatedSession,
    loadScenario,
    resetDemo,
    simulateConfirmAction,
    advanceClockAction,
    simulateRevisionAction,
    showBanner,
  } = useTally();
  const { pathname, navigate } = useRouter();
  const [copiedSession, setCopiedSession] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  if (!open) return null;

  // Determine target pool for simulations: current route pool or main Ford Maverick fixture
  const routePoolMatch = pathname.match(/^\/pools\/([^/]+)/);
  const activePoolId = routePoolMatch ? routePoolMatch[1] : 'pool-maverick-xlt';
  const targetPool =
    session?.pools.find((p) => p.id === activePoolId) ??
    session?.pools.find((p) => p.id === 'pool-maverick-xlt');

  const handleSimAction = async (fn: () => Promise<unknown>) => {
    setSimError(null);
    try {
      await fn();
    } catch (err) {
      const msg =
        err instanceof ApiRequestError
          ? err.error.message
          : err instanceof Error
            ? err.message
            : 'Simulation action unavailable in this stage.';
      setSimError(msg);
    }
  };

  const handleCopySessionUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('session', sessionId);
    navigator.clipboard?.writeText(url.toString()).catch(() => undefined);
    setCopiedSession(true);
    showBanner('info', `Copied isolated session link (${sessionId}).`);
    setTimeout(() => setCopiedSession(false), 2000);
  };

  return (
    <aside
      id="tally-demo-controls-panel"
      aria-label="Demo controls"
      className="fixed top-14 right-2 sm:right-6 z-50 w-[min(360px,calc(100vw-1rem))] max-h-[calc(100vh-4.25rem)] overflow-y-auto bg-white border-2 border-[#152B23] shadow-[5px_5px_0px_#152B23] text-[#152B23]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#F6F1E5] border-b border-[#152B23]/20">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#152B23]">
            Simulated Demo Controls
          </p>
          <p className="font-mono text-[10px] text-[#516B61]">
            Clock: {session ? formatDateTimePacific(session.demoNow) : 'Loading…'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close demo controls"
          className="p-1.5 border border-[#C6D8CE] bg-white hover:bg-[#EAF7EF] cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="p-4 space-y-4 text-xs">
        {/* Persona Switcher */}
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61] mb-2">
            Active persona
          </p>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Switch demo persona">
            {ROLES.map((item) => {
              const active = role === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSimError(null);
                    setRole(item.id);
                  }}
                  className={`px-2 py-2 border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#152B23] text-white border-[#152B23]'
                      : 'bg-[#EAF7EF]/60 text-[#152B23] border-[#C6D8CE] hover:border-[#152B23]'
                  }`}
                >
                  <span className="block font-mono text-[11px] font-semibold uppercase">
                    {item.label}
                  </span>
                  <span
                    className={`block text-[10px] truncate ${
                      active ? 'text-[#FFBF32]' : 'text-[#516B61]'
                    }`}
                  >
                    {item.person}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Deterministic Seed Scenarios */}
        <div className="pt-3 border-t border-[#C6D8CE]">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61]">
            Ford Maverick XLT seed scenarios
          </p>
          <p className="text-[11px] text-[#516B61] mt-0.5 mb-2">
            Updates Ford Maverick XLT only — preserves custom pools and unrelated activity.
          </p>
          <div className="space-y-1.5">
            {SCENARIOS.map((sc) => {
              const active = session?.scenarioId === sc.id;
              return (
                <button
                  key={sc.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSimError(null);
                    void loadScenario(sc.id).then(() => {
                      if (sc.id === 'reviewing-6-of-8' || sc.id === 'missed-deadline') {
                        navigate('/pools/pool-maverick-xlt/offer');
                      } else if (sc.id === 'just-unlocked') {
                        navigate(
                          role === 'buyer'
                            ? '/pools/pool-maverick-xlt/claim'
                            : '/pools/pool-maverick-xlt/offer'
                        );
                      } else if (sc.id === 'ready-for-quote' && role === 'organizer') {
                        navigate('/pools/pool-maverick-xlt/organize');
                      } else {
                        navigate('/pools/pool-maverick-xlt');
                      }
                    });
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#FFBF32]/30 border-[#152B23] font-semibold'
                      : 'bg-white border-[#C6D8CE] hover:bg-[#EAF7EF]'
                  }`}
                >
                  <span>{sc.label}</span>
                  <span className="font-mono text-[10px] text-[#516B61]">{sc.detail}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Walk-Through Simulators */}
        <div className="pt-3 border-t border-[#C6D8CE]">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#516B61] mb-1">
            Walk-through actions (simulated)
          </p>
          <p className="text-[11px] text-[#516B61] mb-2">
            Target: <strong className="text-[#152B23]">{targetPool?.title ?? 'Ford Maverick XLT'}</strong>
          </p>
          <div className="space-y-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                handleSimAction(() => simulateConfirmAction(targetPool?.id || 'pool-maverick-xlt'))
              }
              className="w-full flex items-center gap-2 px-3 py-2 border border-[#152B23] bg-[#EAF7EF] hover:bg-[#DFF2E6] text-[#152B23] font-medium cursor-pointer"
            >
              <UserCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Simulate +1 eligible buyer confirmation</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                handleSimAction(() => advanceClockAction(targetPool?.id || 'pool-maverick-xlt'))
              }
              className="w-full flex items-center gap-2 px-3 py-2 border border-[#C6D8CE] bg-white hover:bg-[#FDF0EE] hover:border-[#A63A2B] text-[#152B23] font-medium cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5 shrink-0 text-[#A63A2B]" aria-hidden="true" />
              <span>Advance demo clock past deadline</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                handleSimAction(() => simulateRevisionAction(targetPool?.id || 'pool-maverick-xlt'))
              }
              className="w-full flex items-center gap-2 px-3 py-2 border border-[#C6D8CE] bg-white hover:bg-[#F6F1E5] hover:border-[#152B23] text-[#152B23] font-medium cursor-pointer"
            >
              <FileEdit className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Simulate seller term revision (v+1)</span>
            </button>
          </div>
          {simError && (
            <p className="mt-2 p-2 bg-[#FDF0EE] border border-[#E8C2BC] text-[#A63A2B] text-[11px]">
              {simError}
            </p>
          )}
        </div>

        {/* Session Isolation & Reset */}
        <div className="pt-3 border-t border-[#C6D8CE] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase text-[#516B61]">
              Session: <strong className="text-[#152B23]">{sessionId}</strong>
            </span>
            <button
              type="button"
              onClick={handleCopySessionUrl}
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-[#152B23] underline cursor-pointer"
            >
              <Copy className="w-3 h-3" aria-hidden="true" />
              {copiedSession ? 'Copied' : 'Share link'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSimError(null);
                void resetDemo();
              }}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 border border-[#152B23] bg-white hover:bg-[#F6F1E5] font-mono text-[11px] uppercase cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              Reset demo
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSimError(null);
                createIsolatedSession();
              }}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 border border-[#C6D8CE] bg-[#EAF7EF]/60 hover:border-[#152B23] font-mono text-[11px] uppercase cursor-pointer"
            >
              <PlusCircle className="w-3 h-3" aria-hidden="true" />
              New session
            </button>
          </div>
          <p className="text-[11px] text-[#516B61] leading-snug">
            Reset demo discards custom pools, saved alerts, notifications, memberships, and
            activity in this isolated session only.
          </p>
        </div>
      </div>
    </aside>
  );
}
