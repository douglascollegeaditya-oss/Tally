import { useState } from 'react';
import { Building2, Car, Disc3, Hotel, Package, Sofa } from 'lucide-react';
import type { PoolCategory } from '../domain/types.ts';

interface PoolImageProps {
  src?: string;
  alt?: string;
  category: PoolCategory;
  title: string;
  className?: string;
}

function CategoryGlyph({ category }: { category: PoolCategory }) {
  const cls = 'w-7 h-7 text-[#152B23]/60';
  switch (category) {
    case 'Vehicles':
      return <Car className={cls} aria-hidden="true" />;
    case 'Apartments':
      return <Building2 className={cls} aria-hidden="true" />;
    case 'Furniture':
      return <Sofa className={cls} aria-hidden="true" />;
    case 'Collectibles':
      return <Disc3 className={cls} aria-hidden="true" />;
    case 'Hotels':
      return <Hotel className={cls} aria-hidden="true" />;
    default:
      return <Package className={cls} aria-hidden="true" />;
  }
}

export function PoolImage({ src, alt, category, title, className = '' }: PoolImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#F6F1E5] border border-[#C6D8CE] p-6 text-center ${className}`}
        role="img"
        aria-label={alt || title}
      >
        <CategoryGlyph category={category} />
        <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-[#516B61]">
          {category}
        </p>
        <p className="mt-1 text-sm font-semibold text-[#152B23] max-w-[24ch]">{title}</p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || title}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-cover w-full h-full ${className}`}
    />
  );
}
