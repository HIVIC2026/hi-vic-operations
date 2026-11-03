import { Outlet } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTradeRole } from "@/lib/trade-view.functions";
import { NO_LOGIN_NEEDED } from "@/lib/trade-access-role.core";
import { TradePublicShell, card, ghostBtn } from "@/components/trade/TradeShell";
import { clearTradeCache } from "@/lib/trade-cache";
import { supabase } from "@/integrations/supabase/client";

/** Lead Installers, Crew and Electricians never log in: if one gets here, say so plainly. The screens draw meanwhile
 *  (the server decides what they may read); only a confirmed "none" swaps to this page. */
export default function FieldLayout() {
  const loadRole = useServerFn(getTradeRole);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["trade-role"], queryFn: () => loadRole(), staleTime: 300_000, retry: false });
  if (data?.role !== "none") return <Outlet />;
  const signOut = async () => { await qc.cancelQueries(); clearTradeCache(); await supabase.auth.signOut(); window.location.replace("/portal"); };
  return (
    <TradePublicShell>
      <div className={card} data-no-login>
        <p className="text-base">{NO_LOGIN_NEEDED}</p>
        <button type="button" onClick={() => void signOut()} className={`${ghostBtn} mt-4`}>Sign out</button>
      </div>
    </TradePublicShell>
  );
}
