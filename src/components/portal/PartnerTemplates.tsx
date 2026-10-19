// Reusable partner invitation templates. Preview / copy / download only — nothing here sends email.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PARTNER_TEMPLATES,
  previewPartnerTemplate,
  renderPartnerTemplate,
  type PartnerTemplate,
} from "@/lib/partner-templates";

export function PartnerTemplates() {
  const [open, setOpen] = useState<PartnerTemplate | null>(null);
  const [copied, setCopied] = useState("");
  return (
    <section
      id="partner-invitation-templates"
      className="mt-8 scroll-mt-20 rounded-md border bg-card p-5"
    >
      <h2 className="text-lg font-bold">Partner invitation templates</h2>
      <p className="mt-1 text-sm text-sub">
        Reusable, office-approved invitations. Preview, copy the subject or download the HTML
        template. Nothing here sends email.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PARTNER_TEMPLATES.map((t) => (
          <article key={t.key} className="min-w-0 rounded-md border p-4">
            <div className="font-bold">{t.label}</div>
            <p className="mt-1 text-xs text-sub">Subject: {t.subject}</p>
            <p className="mt-1 text-xs text-sub">
              Registration link:{" "}
              <a
                className="break-all text-primary underline"
                href={t.registrationUrl}
                target="_blank"
                rel="noopener"
              >
                {t.registrationUrl}
              </a>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen(open?.key === t.key ? null : t)}
              >
                {open?.key === t.key ? "Close preview" : "Preview"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(t.subject);
                  setCopied(t.key);
                }}
              >
                {copied === t.key ? "Copied" : "Copy subject"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const blob = new Blob([renderPartnerTemplate(t)], {
                    type: "text/html;charset=utf-8",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = t.fileName;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Download HTML template
              </Button>
            </div>
          </article>
        ))}
      </div>
      {open && (
        <div className="mt-4 overflow-hidden rounded-md border">
          <iframe
            title={open.label}
            srcDoc={previewPartnerTemplate(open)}
            className="h-[560px] w-full bg-white"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}
    </section>
  );
}
