// New job flow Part 6 Task 8. TODO(join): Part 5 Task 1 owns a FieldLayout that decides `noLogin` from the server
// (getTradeRole: no active business membership at all). At join keep Part 5's layout and OR in this rule (an
// electrician-only app role from the access memo) so both cases show the one plain line.
import { Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAccess } from "@/hooks/use-me";
import { NO_LOGIN_NEEDED } from "@/lib/trade-access-role.core";
import { TradePublicShell, card, ghostBtn } from "@/components/trade/TradeShell";
import { clearTradeCache } from "@/lib/trade-cache";
import { supabase } from "@/integrations/supabase/client";

/** Electricians never log in: an old electrician-only login that still reaches the trade area sees one plain line (never a
 *  blank page) with Sign out. Everyone else gets the screens as before. The screens draw meanwhile (the route guard and
 *  the server already decide what they may read); only a confirmed electrician-only role swaps to this page. */
export default function FieldLayout() {
  const qc = useQueryClient();
  const { data: a } = useAccess();
  const noLogin = !!a && a.electrician && !a.installer && !a.admin;
  if (!noLogin) return <Outlet />;
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
