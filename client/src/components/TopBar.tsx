import { Link, NavLink, useNavigate } from "react-router-dom";
import { ClipboardPlus, Database, Package, Settings } from "lucide-react";
import { useAuth } from "../auth/AuthContext.tsx";
import { Avatar } from "./Avatar.tsx";
import { cn } from "./ui.tsx";

const navItems = [
  { to: "/", label: "查询数据", icon: Database, end: true },
  { to: "/records", label: "添加记录", icon: ClipboardPlus, end: false },
  { to: "/products", label: "商品管理", icon: Package, end: false },
];

export function TopBar() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-400 text-white shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
              <path d="M4 20h16M6 20V8l6-4 6 4v12" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 20v-6h6v6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-lg font-bold tracking-tight text-slate-900">Prevo</span>
        </Link>

        <nav className="flex flex-1 items-center gap-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )
              }
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => navigate("/settings")}
          aria-label="设置"
          className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <Settings className="size-5" />
        </button>

        {user && (
          <button
            type="button"
            onClick={() => navigate("/profile")}
            aria-label="用户详情"
            title={user.username}
            className="rounded-full ring-offset-2 transition-shadow hover:ring-2 hover:ring-blue-200 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <Avatar name={user.username} size={34} />
          </button>
        )}
      </div>
    </header>
  );
}
