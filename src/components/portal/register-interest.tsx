/**
 * "Register my interest" band on the public calculator.
 *
 * Decision 1 (Jo 2 Nov 2026): the button sends people to homeinsulationvictoria.com.au/homeowner. The calculator shows
 * a price only and creates no enquiry, so there is no form and no server call here.
 */
import { HOMEOWNER_URL } from "@/lib/interest.core";

type Props = {
  address: string;
  suburb: string;
  postcode: string;
  ceilingM2: number;
  insulation: "none" | "present" | "unknown";
};

export function RegisterInterest(_props: Props) {
  return (
    <section
      id="register-interest"
      className="relative mt-4 scroll-mt-4 overflow-hidden rounded-3xl bg-estimate-white px-5 py-6 text-center shadow-[0_30px_70px_-45px_rgba(34,55,107,0.45)] sm:px-8 sm:py-8"
    >
      <p className="text-[0.8rem] leading-relaxed text-estimate-navy/75">
        Spots are released in the order they were saved. We&apos;ll be in touch when your spot is released.
      </p>
      <a
        href={HOMEOWNER_URL}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-estimate-green px-4 text-base font-extrabold text-estimate-white shadow-lg shadow-estimate-green/25 transition hover:bg-estimate-accent active:scale-[0.99] sm:w-auto sm:min-w-64"
      >
        Register my interest
      </a>
      <p className="mt-1.5 text-[0.7rem] text-estimate-navy/75">Free, no obligation.</p>
    </section>
  );
}
