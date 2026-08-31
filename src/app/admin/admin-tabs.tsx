import Link from "next/link";

// The nav bar has a single Admin entry pointing at /admin/analytics, so any
// second admin page would otherwise be reachable only by typing its URL.
// These tabs are how you get between them. `active` is passed in rather than
// read from usePathname() so this stays a server component.
const TABS = [
  { href: "/admin/analytics", label: "Analytics", key: "analytics" },
  { href: "/admin/plans", label: "Plans", key: "plans" },
] as const;

export function AdminTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-subtle">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            tab.key === active
              ? "border-primary text-primary"
              : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
