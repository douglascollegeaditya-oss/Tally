import { Layout } from './components/Layout.tsx';
import { TallyProvider } from './lib/api.ts';
import { RouterProvider, useRouter } from './lib/router.tsx';
import { ClaimPage } from './pages/ClaimPage.tsx';
import { ExplorePage } from './pages/ExplorePage.tsx';
import { MyPoolsPage } from './pages/MyPoolsPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { OfferReviewPage } from './pages/OfferReviewPage.tsx';
import { OrganizerPage } from './pages/OrganizerPage.tsx';
import { PoolDetailPage } from './pages/PoolDetailPage.tsx';
import { SellerQuotePage } from './pages/SellerQuotePage.tsx';
import { StartPoolPage } from './pages/StartPoolPage.tsx';

function RouteSwitch() {
  const { pathname } = useRouter();
  const normalized = pathname.replace(/\/+$/, '') || '/';

  if (normalized === '/') {
    return <ExplorePage />;
  }
  if (normalized === '/start') {
    return <StartPoolPage />;
  }
  if (normalized === '/my-pools') {
    return <MyPoolsPage />;
  }

  const sellerMatch = normalized.match(/^\/s\/([^/]+)$/);
  if (sellerMatch) {
    return <SellerQuotePage token={decodeURIComponent(sellerMatch[1])} />;
  }

  const organizeMatch = normalized.match(/^\/pools\/([^/]+)\/organize$/);
  if (organizeMatch) {
    return <OrganizerPage poolId={decodeURIComponent(organizeMatch[1])} />;
  }

  const offerMatch = normalized.match(/^\/pools\/([^/]+)\/offer$/);
  if (offerMatch) {
    return <OfferReviewPage poolId={decodeURIComponent(offerMatch[1])} />;
  }

  const claimMatch = normalized.match(/^\/pools\/([^/]+)\/claim$/);
  if (claimMatch) {
    return <ClaimPage poolId={decodeURIComponent(claimMatch[1])} />;
  }

  const poolMatch = normalized.match(/^\/pools\/([^/]+)$/);
  if (poolMatch) {
    return <PoolDetailPage poolId={decodeURIComponent(poolMatch[1])} />;
  }

  return <NotFoundPage />;
}

export default function App() {
  return (
    <RouterProvider>
      <TallyProvider>
        <Layout>
          <RouteSwitch />
        </Layout>
      </TallyProvider>
    </RouterProvider>
  );
}
