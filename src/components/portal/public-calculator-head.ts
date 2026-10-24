// Head tags for the public calculator ("/" and "/calculator"). Kept apart from the page on purpose (decision 280, speed):
// a route's `head` is not code-split, so anything it imports loads on EVERY page — this file imports nothing heavy.
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";

const title = "Ceiling insulation rebate calculator Victoria (VEU) — Home Insulation Victoria";
const description =
  "Work out an indicative price for ceiling insulation in your Victorian home — including the VEU discount you're likely to qualify for. Free, no obligation, nothing saved.";

export const publicCalculatorHead = () => ({
  meta: [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://estimate.homeinsulationvictoria.com.au/" },
    { property: "og:image", content: CUSTOMER_BRAND.logoUrl },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: CUSTOMER_BRAND.logoUrl },
    { name: "robots", content: "index, follow" },
  ],
  links: [{ rel: "canonical", href: "https://estimate.homeinsulationvictoria.com.au/" }],
});
