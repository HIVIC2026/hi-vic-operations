// A job-page panel whose read failed (panel-load.core): say so plainly and offer Try again — the MoneyCard pattern.
export function LoadFailed({ what, onRetry, className = "" }: { what: string; onRetry: () => void; className?: string }) {
  return (
    <p role="alert" className={`text-sm text-danger ${className}`.trim()}>
      {what} could not load.{" "}
      <button type="button" className="font-semibold underline" onClick={onRetry}>Try again</button>
    </p>
  );
}
