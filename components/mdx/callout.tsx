import { cn } from "@/lib/utils";

type CalloutType = "info" | "tip" | "warning";

const STYLES: Record<CalloutType, string> = {
  info: "border-sky-300 bg-sky-50 text-sky-900",
  tip: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
};

export function Callout({
  type = "info",
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      className={cn(
        "my-6 rounded-lg border-l-4 px-4 py-3 text-sm not-prose",
        STYLES[type],
      )}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="leading-relaxed">{children}</div>
    </aside>
  );
}
