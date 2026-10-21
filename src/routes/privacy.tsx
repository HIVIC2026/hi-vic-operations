import { createFileRoute } from "@tanstack/react-router";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";

// APPROVED — wording approved exactly as written by Jo Lowe on 6 Oct 2026,
// with info@homeinsulationvictoria.com.au as the contact. Do not change the
// wording without Jo's approval.
const PRIVACY_CONTACT_EMAIL = "info@homeinsulationvictoria.com.au";
const LAST_UPDATED = "6 October 2026";

const title = "Privacy policy — Home Insulation Victoria";
const description = "How Home Insulation Victoria (DC Construction Solutions Pty Ltd) collects, uses, shares and protects your personal information.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://estimate.homeinsulationvictoria.com.au/privacy" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "index, follow" },
    ],
    links: [{ rel: "canonical", href: "https://estimate.homeinsulationvictoria.com.au/privacy" }],
  }),
  component: PrivacyPage,
});

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="text-[1.05rem] font-extrabold tracking-tight text-estimate-navy">{heading}</h2>
      <p className="mt-1.5 text-[0.9rem] leading-relaxed text-estimate-navy/85">{children}</p>
    </section>
  );
}

function PrivacyPage() {
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
      <div className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-3 sm:px-6">
        <header className="flex items-center justify-between gap-2 pb-4">
          <a href="/" aria-label="Home Insulation Victoria calculator">
            <img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-9 w-auto sm:h-10" />
          </a>
        </header>


        <div className="rounded-[22px] bg-estimate-white p-5 shadow-sm sm:p-8">
          <h1 className="text-[1.6rem] font-extrabold leading-tight tracking-tight text-estimate-navy sm:text-[2rem]">Privacy policy</h1>
          <p className="mt-3 text-[0.9rem] leading-relaxed text-estimate-navy/85">
            Home Insulation Victoria is a trading name of DC Construction Solutions Pty Ltd (ABN 44 671 613 979), an Accredited Person under the Victorian Energy Upgrades (VEU) program (accreditation A003654). This policy explains how we handle your personal information under the Privacy Act 1988 (Cth) and the Australian Privacy Principles.
          </p>

          <Section heading="What we collect">
            Your name, phone, email and property address, details about your home and ceiling (such as size, existing insulation, photos and videos), eligibility answers, quotes, signed forms, and payment records. We also collect details about the installers and electricians who work with us.
          </Section>

          <Section heading="How we collect it">
            From you, through our website, calculator, emails, forms and phone calls; from installers and electricians who visit your home; and, with your permission, from installers who refer you to us.
          </Section>

          <Section heading="Why we use it">
            To check your eligibility, give you an estimate and quote, arrange your free Ready Check, Pre Insulation Electrical Safety Assessment (PIESA) and installation, meet our obligations under the VEU program (including creating Victorian energy efficiency certificates), process payments, handle complaints, and contact you about your enquiry.
          </Section>

          <Section heading="Who we share it with">
            The installers and electricians allocated to your job; the Essential Services Commission and other regulators when the law or the VEU program requires it; and service providers who help us run our business, such as email, SMS, payment, accounting and hosting providers. We don't sell your information.
          </Section>

          <Section heading="Overseas">
            Some of our service providers may store information outside Australia. We take reasonable steps to make sure they protect it.
          </Section>

          <Section heading="Storage and security">
            We keep information securely and only for as long as we need it. VEU records must be kept for at least six years.
          </Section>

          <Section heading="Marketing">
            We only contact you about your enquiry or our services. You can opt out at any time using the link in our emails.
          </Section>

          <Section heading="Access and correction">
            You can ask to see or correct the information we hold about you by contacting us.
          </Section>

          <Section heading="Complaints">
            Contact us first at{" "}
            <a
              href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
              className="font-bold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green"
            >
              {PRIVACY_CONTACT_EMAIL}
            </a>
            . If you're not satisfied with our response, you can contact the Office of the Australian Information Commissioner (oaic.gov.au).
          </Section>

          <p className="mt-6 border-t border-estimate-line pt-4 text-[0.8rem] text-estimate-navy/70">Last updated: {LAST_UPDATED}</p>
        </div>

        <footer className="mt-6 pb-6 text-center text-xs leading-relaxed text-estimate-navy/85 lg:pb-4">
          <p className="font-bold text-estimate-navy">Home Insulation Victoria · Accredited Person for Victorian Energy Upgrades</p>
          <a href="/" className="font-bold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green">Back to the calculator</a>
        </footer>
      </div>
    </div>
  );
}
