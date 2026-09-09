import { cn } from "./ui.tsx";

const tones = [
  "from-blue-500 to-sky-400",
  "from-indigo-500 to-blue-400",
  "from-sky-500 to-cyan-400",
  "from-blue-600 to-indigo-500",
] as const;

export function Avatar({
  name,
  size = 32,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  // stable tone per user, not per render
  const tone = tones[(name.length + (name.charCodeAt(0) || 0)) % tones.length] ?? tones[0];
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white",
        tone,
        className,
      )}
    >
      {initial}
    </span>
  );
}
