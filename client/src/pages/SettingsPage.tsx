import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext.tsx";
import * as api from "../lib/api.ts";
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  InlineMessage,
  Input,
} from "../components/ui.tsx";

export function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordOk, setPasswordOk] = useState(false);

  const [typedName, setTypedName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!user) return null;

  function doLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  async function handlePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordOk(false);
    if (newPassword !== confirm) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setPasswordOk(true);
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setPasswordError(api.errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteAccount();
      logout();
      navigate("/login", { replace: true });
    } catch (err) {
      setDeleteError(api.errorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">设置</h1>
        <p className="mt-1 text-sm text-slate-500">管理密码与会话。</p>
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <KeyRound className="size-4 text-blue-600" />
          修改密码
        </h2>
        <form onSubmit={handlePassword} className="mt-4 space-y-4">
          <Field label="当前密码">
            <Input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="新密码" hint="6-72 位">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </Field>
            <Field label="确认新密码">
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
          </div>
          {passwordError && <InlineMessage tone="error">{passwordError}</InlineMessage>}
          {passwordOk && <InlineMessage tone="success">密码已更新，下次登录请使用新密码。</InlineMessage>}
          <Button type="submit" loading={saving}>
            更新密码
          </Button>
        </form>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold text-slate-900">会话</h2>
        <p className="mt-1 text-sm text-slate-500">
          当前登录：{user.username}
        </p>
        <Button variant="secondary" className="mt-4" onClick={doLogout}>
          <LogOut className="size-4" />
          退出登录
        </Button>
      </Card>

      <Card className="border-rose-200 p-5 sm:p-6">
        <h2 className="font-semibold text-rose-700">危险操作</h2>
        <p className="mt-1 text-sm text-slate-500">
          删除账号会一并删除该账号下的所有商品周期数据，且不可恢复。
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={`输入用户名 ${user.username} 以确认`}
            className="sm:max-w-xs"
          />
          <Button
            variant="danger"
            disabled={typedName !== user.username}
            onClick={() => setDeleteOpen(true)}
            className="shrink-0"
          >
            <Trash2 className="size-4" />
            删除账号
          </Button>
        </div>
        {deleteError && (
          <div className="mt-3">
            <InlineMessage tone="error">{deleteError}</InlineMessage>
          </div>
        )}
      </Card>

      {deleteOpen && (
        <ConfirmDialog
          title="删除账号？"
          confirmLabel="永久删除"
          danger
          busy={deleting}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => void handleDelete()}
        >
          将永久删除用户 {user.username} 及其全部周期数据。此操作无法撤销。
        </ConfirmDialog>
      )}
    </div>
  );
}
