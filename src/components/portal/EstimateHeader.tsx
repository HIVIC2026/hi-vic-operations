import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

export function EstimateHeader() {
  return <header className="border-b border-estimate-blue/20 bg-estimate-white"><div className="mx-auto grid max-w-[720px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 sm:px-8 sm:py-4"><img src={logo.url} alt="Home Insulation Victoria" className="h-12 w-auto max-w-[142px] object-contain object-left sm:h-20 sm:max-w-60" /><span className="min-w-0 text-right text-[10px] font-extrabold uppercase tracking-widest text-estimate-green sm:text-xs">Your indicative estimate</span></div></header>;
}