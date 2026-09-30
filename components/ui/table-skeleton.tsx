export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <div
              key={c}
              className="h-8 flex-1 animate-pulse rounded-md bg-slate-100"
              style={{ animationDelay: `${(r + c) * 40}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
