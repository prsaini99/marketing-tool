"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  number: number;
  title: string;
  draft?: boolean;
}

interface SetupGuideTocProps {
  items: TocItem[];
}

/**
 * Notion-style sticky table of contents.
 *
 * Sits in the page's right rail (lg+ screens only — collapses on mobile).
 * Uses IntersectionObserver to highlight whichever section the viewport
 * is currently centered on, so the user always knows where they are.
 * Click an entry → smooth-scroll jump to that section.
 */
export function SetupGuideToc({ items }: SetupGuideTocProps) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const elements = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    // Trigger when a section crosses the upper-third band of the viewport —
    // matches the "where am I reading" intuition better than the dead-center.
    const observer = new IntersectionObserver(
      (entries) => {
        // Among currently-intersecting sections, pick the topmost one as
        // active. Otherwise leave the last known active alone.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        // Top inset 80px gives breathing room for the page header; bottom
        // 60% so we light up the next section once it's roughly 40% on screen.
        rootMargin: "-80px 0px -60% 0px",
        threshold: 0,
      },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Mirror in URL so refresh / share keeps the anchor.
    history.replaceState(null, "", `#${id}`);
    setActiveId(id);
  }

  return (
    <nav
      aria-label="On this page"
      className="sticky top-6 hidden max-h-[calc(100vh-4rem)] w-72 shrink-0 overflow-y-auto pl-4 lg:block"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-subtle">
        On this page
      </div>
      <ul className="mt-3 space-y-0.5 border-l border-border">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => handleClick(e, item.id)}
                className={cn(
                  "relative -ml-px block border-l-2 py-1.5 pl-3 text-sm leading-snug transition-colors",
                  isActive
                    ? "border-accent font-medium text-foreground"
                    : "border-transparent text-muted hover:text-foreground",
                )}
              >
                <span className="mr-1.5 text-subtle">{item.number}.</span>
                {item.title}
                {item.draft && (
                  <span className="ml-1.5 text-[11px] text-amber-700">
                    · draft
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
