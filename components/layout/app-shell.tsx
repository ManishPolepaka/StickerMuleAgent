export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const showHeader = Boolean(title || description || actions);

  return (
    <>
      {showHeader ? (
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 bg-white/80 px-6 py-5 backdrop-blur-md">
          <div className="min-w-0">
            {title ? (
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>
          ) : null}
        </header>
      ) : null}
      <main className="flex-1 bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-6 py-6">
        {children}
      </main>
    </>
  );
}
