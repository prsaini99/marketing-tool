"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  placeholder?: string;
  // The URL query-string key this search writes to. Default "q".
  paramKey?: string;
}

/**
 * URL-backed search input. Keystrokes update local state immediately so
 * typing feels native; the URL `?q=` only updates after a 250ms debounce
 * so we don't fire a server render per character. The server pages read
 * `?q=` and pass it into their Prisma where-clause for name filtering.
 */
export function SearchBar({
  placeholder = "Search by name…",
  paramKey = "q",
}: SearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState<string>(
    searchParams.get(paramKey) ?? "",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External URL changes (back button, sidebar nav, etc.) should reset the
  // input — otherwise stale local state lingers after navigation.
  useEffect(() => {
    const fromUrl = searchParams.get(paramKey) ?? "";
    setValue((prev) => (prev === fromUrl ? prev : fromUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get(paramKey)]);

  function push(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set(paramKey, next.trim());
    else params.delete(paramKey);
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  function handleChange(next: string) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => push(next), 250);
  }

  function clear() {
    setValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    push("");
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="w-56 rounded-md border border-border bg-background pl-7 pr-7 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
