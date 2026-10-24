import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InstallerIntakeFlow } from "@/components/trade/installer-intake-flow";
import { IntakeDetailsEditor } from "@/components/trade/intake-details-editor";
import { PREVIEW_BUSINESS_ID, createPreviewIntakeApi } from "@/components/trade/intake-preview-adapter";

export const Route = createFileRoute("/installer-preview")({
  head: () => ({
    meta: [
      { title: "Installer Add job preview — Home Insulation Victoria" },
      { name: "description", content: "Sample walkthrough of the installer Add job form. Nothing is saved or sent." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Installer Add job preview — Home Insulation Victoria" },
      { property: "og:description", content: "Sample walkthrough of the installer Add job form. Nothing is saved or sent." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InstallerPreview,
});

function InstallerPreview() {
  // Own query cache + local adapter: no sign-in, database, storage or external calls.
  const [qc] = useState(() => new QueryClient());
  const [{ api, submitted }] = useState(createPreviewIntakeApi);
  if (typeof window !== "undefined") (window as unknown as { __previewSubmitted: unknown[] }).__previewSubmitted = submitted;
  return (
    <QueryClientProvider client={qc}>
      <div className="portal-theme min-h-screen bg-canvas p-4 text-ink">
        <div className="mx-auto max-w-lg">
          <p role="note" data-preview-banner className="sticky top-2 z-10 rounded-[12px] border border-primary bg-paper p-3 text-center text-sm font-bold">Preview only — sample job, nothing is saved or sent</p>
          <h1 className="mt-4 font-display text-2xl font-bold">Add job</h1>
          <InstallerIntakeFlow businessId={PREVIEW_BUSINESS_ID} preview={api} />
          <h2 className="mt-8 font-display text-xl font-bold">Sample received job (not quoted yet)</h2>
          <p className="text-sm text-sub">How the installer adds measurements and a quote later, on the same job. Sample only — nothing is saved.</p>
          <div className="mt-3" data-preview-editor><IntakeDetailsEditor preview businessId={PREVIEW_BUSINESS_ID} upload={api.uploadFiles}
            facts={{ areaM2: null, insulation: "unknown", quoted: "no", quoteIncGst: null, includes: null, proposedR: null, files: [], electricianChosen: false, payerEditable: true, electricianPayer: "undecided", quoteHeld: ["Ceiling area not measured yet", "No installer quote yet", "Existing insulation not yet confirmed"] }}
            electricians={{ approved: [{ businessId: "preview-electrician", name: "Sample Electrical (sample)" }], pending: [] }}
            onSave={async () => ({ quoteHeld: [] })} /></div>
        </div>
      </div>
    </QueryClientProvider>
  );
}
