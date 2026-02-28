"use client";

import Link from "next/link";

type NextStepItem = {
  label: string;
  href: string;
  detail?: string;
};

export default function NextStepHint({
  title = "What To Do Next",
  items,
}: {
  title?: string;
  items: NextStepItem[];
}) {
  if (!items.length) return null;

  return (
    <section
      className="border border-border rounded-lg p-3 mb-4 bg-accent/20"
      aria-label="Next steps guidance"
    >
      <h3 className="text-sm font-semibold m-0 mb-2">{title}</h3>
      <div className="grid gap-2">
        {items.map((item) => (
          <div key={`${item.label}-${item.href}`} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium">{item.label}</div>
              {item.detail && <div className="text-[11px] text-muted-foreground">{item.detail}</div>}
            </div>
            <Link href={item.href} className="text-xs font-semibold no-underline text-primary whitespace-nowrap">
              Open
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

