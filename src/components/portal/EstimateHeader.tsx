import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";

export function EstimateHeader() {
  return <header className="bg-estimate-canvas"><div className="mx-auto flex max-w-[760px] items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-7"><img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-12 w-auto max-w-[150px] object-contain object-left sm:h-16 sm:max-w-52" /><div className="text-right"><span className="block text-xs font-semibold uppercase tracking-wider text-estimate-green">Step 3</span><span className="mt-0.5 block text-sm font-semibold text-estimate-navy">Indicative estimate</span></div></div></header>;
}