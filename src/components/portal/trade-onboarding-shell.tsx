import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

export function TradeOnboardingShell({ children, progress, footer }: { children: React.ReactNode; progress?: { current: number; total: number; label: string }; footer?: React.ReactNode }) {
  return <div className="estimate-brand min-h-screen bg-estimate-canvas text-estimate-navy">
    <header className="border-b border-estimate-line bg-estimate-white">
      <div className="mx-auto flex max-w-[640px] items-center justify-between gap-4 px-5 py-4 sm:px-7">
        <img src={logo.url} alt="Home Insulation Victoria" className="h-10 w-auto" />
        {progress && <span className="text-xs font-bold text-estimate-navy/70">{progress.current} of {progress.total}</span>}
      </div>
      {progress && <div className="mx-auto max-w-[640px] px-5 pb-4 sm:px-7">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold"><span>{progress.label}</span><span>{Math.round(progress.current / progress.total * 100)}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-estimate-line"><div className="h-full rounded-full bg-estimate-green transition-[width]" style={{ width: `${progress.current / progress.total * 100}%` }} /></div>
      </div>}
    </header>
    <main className="mx-auto max-w-[640px] px-4 py-6 pb-28 sm:px-7 sm:py-9">{children}</main>
    {footer}
  </div>;
}

export function TradeOnboardingFooter() {
  return <footer className="border-t border-estimate-line bg-estimate-white px-5 py-5 text-center text-xs leading-relaxed text-estimate-navy/70">
    <strong className="text-estimate-navy">Home Insulation Victoria</strong><br />
    DC Construction Solutions Pty Ltd trading as Home Insulation Victoria
  </footer>;
}