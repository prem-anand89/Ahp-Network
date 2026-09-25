"use client";

// Step 7G — the directory's live name/role/certification search. The rest
// of the directory (filters, results) is a plain GET form with no client
// JS (directory-search.tsx's own header comment); this one field is the
// deliberate exception, since a debounced live search is worse as a
// submit-button form. Builds the next URL from `currentSearch` (passed
// down from the server component that already parsed searchParams)
// rather than useSearchParams(), so this needs no Suspense boundary.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

export function OmniSearchInput({
  basePath,
  currentSearch,
  initialQuery,
}: {
  basePath: string;
  /** The current query string (without the leading '?'), so other active
   * filters survive a search-box edit. */
  currentSearch: string;
  initialQuery: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function handleChange(next: string) {
    setValue(next);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(currentSearch);
      if (next.trim()) params.set("q", next.trim());
      else params.delete("q");
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
      });
    }, DEBOUNCE_MS);
  }

  return (
    <div className="relative mt-6">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search by name, role, or certification"
        aria-label="Search the directory"
        className={cn(
          "w-full rounded-pill border-[1.5px] border-graphite bg-background py-2.5 pl-10 pr-4 text-sm",
          "focus:border-primary focus:outline-none",
        )}
      />
      {isPending && <span className="sr-only" role="status">Searching…</span>}
    </div>
  );
}
