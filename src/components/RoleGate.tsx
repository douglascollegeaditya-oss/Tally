import { Lock } from 'lucide-react';
import type { PersonaRole } from '../domain/types.ts';
import { useTally } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';

interface RoleGateProps {
  title: string;
  requiredRole: PersonaRole;
  reason: string;
  backTo: string;
  backLabel: string;
}

export function RoleGate({ title, requiredRole, reason, backTo, backLabel }: RoleGateProps) {
  const { role } = useTally();

  return (
    <div className="max-w-xl mx-auto my-10 bg-white border border-[#152B23] p-6 sm:p-8 shadow-[3px_3px_0px_#152B23]">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[#A63A2B]">
        <Lock className="w-4 h-4" aria-hidden="true" />
        <span>Protected workspace route</span>
      </div>
      <h1 className="mt-3 font-display text-2xl text-[#152B23] uppercase">{title}</h1>
      <p className="mt-3 text-sm text-[#152B23] leading-relaxed">{reason}</p>
      <div className="mt-4 p-3 bg-[#F6F1E5] border border-[#C6D8CE] text-xs text-[#516B61]">
        Current persona: <strong className="text-[#152B23] uppercase font-mono">{role}</strong> ·
        Required role:{' '}
        <strong className="text-[#152B23] uppercase font-mono">{requiredRole}</strong>. Use{' '}
        <strong className="text-[#152B23]">Demo controls</strong> in the top-right header if you
        want to preview this route as the {requiredRole} persona.
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to={backTo}
          className="inline-flex items-center justify-center px-4 py-2.5 bg-[#152B23] text-white font-mono text-xs uppercase tracking-wider hover:bg-[#28463B] transition-colors"
        >
          {backLabel}
        </Link>
        <Link
          to="/"
          className="inline-flex items-center justify-center px-4 py-2.5 bg-white text-[#152B23] border border-[#C6D8CE] hover:border-[#152B23] font-mono text-xs uppercase tracking-wider transition-colors"
        >
          Back to Explore
        </Link>
      </div>
    </div>
  );
}
