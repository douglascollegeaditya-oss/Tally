import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface RouterContextValue {
  pathname: string;
  search: string;
  searchParams: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  lastExploreUrl: string;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [loc, setLoc] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  const [lastExploreUrl, setLastExploreUrl] = useState(() =>
    window.location.pathname === '/' ? `/${window.location.search}` : '/'
  );

  useEffect(() => {
    const handlePop = () => {
      const next = {
        pathname: window.location.pathname,
        search: window.location.search,
      };
      setLoc(next);
      if (next.pathname === '/') {
        setLastExploreUrl(`/${next.search}`);
      }
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    const nextPath = url.pathname;
    const nextSearch = url.search;
    const combined = `${nextPath}${nextSearch}`;

    if (options?.replace) {
      window.history.replaceState({}, '', combined);
    } else {
      window.history.pushState({}, '', combined);
    }

    setLoc({ pathname: nextPath, search: nextSearch });
    if (nextPath === '/') {
      setLastExploreUrl(combined);
    }
    if (!options?.replace) {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, []);

  const searchParams = useMemo(() => new URLSearchParams(loc.search), [loc.search]);

  const value = useMemo<RouterContextValue>(
    () => ({
      pathname: loc.pathname,
      search: loc.search,
      searchParams,
      navigate,
      lastExploreUrl,
    }),
    [loc.pathname, loc.search, searchParams, navigate, lastExploreUrl]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider');
  return ctx;
}

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
}

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onClick) onClick(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
