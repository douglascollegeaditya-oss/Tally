import { Link } from '../lib/router.tsx';

export function NotFoundPage() {
  return (
    <div className="max-w-lg mx-auto my-12 bg-white border-2 border-[#152B23] shadow-[4px_4px_0px_#152B23] p-8 text-center space-y-4">
      <p className="font-mono text-xs uppercase tracking-wider text-[#516B61]">404 · Route not found</p>
      <h1 className="font-display text-2xl sm:text-3xl text-[#152B23] uppercase">
        This buying ledger page doesn’t exist
      </h1>
      <p className="text-sm text-[#516B61]">
        Check the pool link or return to the active neighborhood directory.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Link
          to="/"
          className="px-4 py-2.5 bg-[#FFBF32] hover:bg-[#F2B01E] border border-[#152B23] font-mono text-xs font-semibold uppercase tracking-wider text-[#152B23]"
        >
          Back to Explore
        </Link>
        <Link
          to="/my-pools"
          className="px-4 py-2.5 bg-white border border-[#C6D8CE] hover:border-[#152B23] font-mono text-xs uppercase tracking-wider text-[#152B23]"
        >
          My pools
        </Link>
      </div>
    </div>
  );
}
