import type { LucideIcon } from "lucide-react";
import { cn } from "./ui.tsx";

export function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="px-3 py-3 text-center">
      <p
        className={cn(
          "flex items-center justify-center gap-1 text-xs",
          accent ? "text-blue-600" : "text-slate-400",
        )}
      >
        <Icon className="size-3" />
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          accent ? "text-blue-600" : "text-slate-800",
        )}
      >
        {value}
      </p>
    </div>
  );
}
