import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

export function EstimateHeader() {
  return <header className="border-b border-estimate-blue/20 bg-estimate-white shadow-sm"><div className="mx-auto grid max-w-[840px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 sm:px-8 sm:py-4"><img src={logo.url} alt="Home Insulation Victoria" className="h-12 w-auto max-w-[142px] object-contain object-left sm:h-20 sm:max-w-60" /><span className="border-l-4 border-estimate-green pl-2 text-right text-[10px] font-extrabold uppercase tracking-widest text-estimate-navy sm:text-xs">Indicative estimate</span></div></header>;
}