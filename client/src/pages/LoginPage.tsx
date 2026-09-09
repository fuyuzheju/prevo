import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Leaf, LineChart, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext.tsx";
import * as api from "../lib/api.ts";
import { Button, Card, Field, Input, InlineMessage, cn } from "../components/ui.tsx";

type Mode = "login" | "register";

const MODES: readonly Mode[] = ["login", "register"];

// react-router navigation state is opaque; read the optional "from" path
function redirectTarget(state: unknown): string {
  if (typeof state === "object" && state !== null && "from" in state) {
    const from = state.from;
    if (typeof from === "string") return from;
  }
  return "/";
}

export function LoginPage() {
  const { user, initializing, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = redirectTarget(location.state);

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!initializing && user) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        await api.register(username.trim(), password);
        await login(username.trim(), password);
      } else {
        await login(username.trim(), password);
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(api.errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <div className="flex min-h-dvh">
      {/* brand panel */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-sky-500 p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <Leaf className="size-6" />
          </span>
          <span className="text-2xl font-bold tracking-tight">Prevo</span>
        </div>
        <div className="relative">
          <h1 className="text-3xl font-bold leading-snug tracking-tight">
            周期化的库存与采购管理
          </h1>
          <ul className="mt-8 space-y-4 text-blue-50">
            <li className="flex items-center gap-3">
              <RefreshCw className="size-5 shrink-0" />
              每个周期汇总一次，库存、在途与欠货一目了然
            </li>
            <li className="flex items-center gap-3">
              <LineChart className="size-5 shrink-0" />
              基于销量历史预测下一周期，指导采购
            </li>
            <li className="flex items-center gap-3">
              <ShieldCheck className="size-5 shrink-0" />
              每种商品独立核算，互不干扰
            </li>
          </ul>
        </div>
        <p className="relative text-sm text-blue-200">© {new Date().getFullYear()} Prevo</p>
      </aside>

      {/* form panel */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-400 text-white">
              <Leaf className="size-6" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Prevo</h1>
          </div>

          <Card className="p-6 sm:p-8">
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={cn(
                    "rounded-lg py-2 text-sm font-medium transition-colors",
                    mode === m ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {m === "login" ? "登录" : "注册"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="用户名">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="你的用户名"
                  autoComplete="username"
                  required
                />
              </Field>
              <Field label="密码">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "至少 6 位" : "你的密码"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                />
              </Field>
              {mode === "register" && (
                <Field label="确认密码">
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="再输一次密码"
                    autoComplete="new-password"
                    required
                  />
                </Field>
              )}
              {error && <InlineMessage tone="error">{error}</InlineMessage>}
              <Button type="submit" className="w-full" loading={busy}>
                {mode === "login" ? "登录" : "注册并登录"}
              </Button>
            </form>
          </Card>
          <p className="mt-4 text-center text-xs text-slate-400">
            {mode === "login" ? "还没有账号？点击上方「注册」创建" : "已有账号？点击上方「登录」"}
          </p>
        </div>
      </div>
    </div>
  );
}
