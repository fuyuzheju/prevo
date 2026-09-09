import { lazy, Suspense } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { CenteredSpinner } from "./components/ui.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { QueryPage } from "./pages/QueryPage.tsx";
import { RecordsPage } from "./pages/RecordsPage.tsx";
import { ProductsPage } from "./pages/ProductsPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

// echarts is heavy; the predict page is loaded on demand
const PredictPage = lazy(() =>
  import("./pages/PredictPage.tsx").then((module) => ({ default: module.PredictPage })),
);

function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <CenteredSpinner label="正在加载…" />
    </div>
  );
}

function RequireAuth() {
  const { user, initializing } = useAuth();
  const location = useLocation();
  if (initializing) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Prevo · 周期库存管理
      </footer>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<QueryPage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route
          path="/predict"
          element={
            <Suspense
              fallback={
                <div className="flex justify-center py-16">
                  <CenteredSpinner label="加载预测页…" />
                </div>
              }
            >
              <PredictPage />
            </Suspense>
          }
        />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <p className="text-4xl font-bold text-slate-300">404</p>
      <p className="text-slate-500">页面不存在</p>
      <Link to="/" className="text-sm font-medium text-blue-600 hover:underline">
        回到首页
      </Link>
    </div>
  );
}
