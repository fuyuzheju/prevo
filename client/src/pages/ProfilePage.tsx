import { Link } from "react-router-dom";
import { CalendarDays, Hash, Settings, UserRound } from "lucide-react";
import { useAuth } from "../auth/AuthContext.tsx";
import { Avatar } from "../components/Avatar.tsx";
import { Button, Card } from "../components/ui.tsx";

const fmtDate = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "long",
  timeStyle: "short",
});

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  const registeredAt = new Date(user.createdAt);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">用户详情</h1>
        <p className="mt-1 text-sm text-slate-500">你的账号信息。</p>
      </div>

      <Card className="overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-blue-600 via-blue-500 to-sky-400" />
        <div className="px-6 pb-6">
          <div className="-mt-10 mb-4 flex items-end justify-between">
            <Avatar name={user.username} size={88} className="ring-4 ring-white" />
            <Link to="/settings">
              <Button variant="secondary">
                <Settings className="size-4" />
                前往设置
              </Button>
            </Link>
          </div>
          <h2 className="text-lg font-bold text-slate-900">{user.username}</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <DetailRow icon={UserRound} label="用户名" value={user.username} />
            <DetailRow icon={Hash} label="用户 ID" value={`#${user.id}`} />
            <DetailRow icon={CalendarDays} label="加入时间" value={fmtDate.format(registeredAt)} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="truncate text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  );
}
