import type { RecordKind } from "../lib/types.ts";
import { cn } from "./ui.tsx";

const KIND_LABEL: Record<RecordKind, string> = {
  PURCHASE: "购买",
  SELL: "出售",
  RECEIVE: "收到",
  SEND: "发出",
};

const KIND_TONE: Record<RecordKind, string> = {
  PURCHASE: "bg-blue-50 text-blue-700",
  SELL: "bg-sky-50 text-sky-700",
  RECEIVE: "bg-teal-50 text-teal-700",
  SEND: "bg-indigo-50 text-indigo-700",
};

export function RecordBadge({ kind, className }: { kind: RecordKind; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        KIND_TONE[kind],
        className,
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}
