import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { persona } from './fixtures';
import { showTradeSaved } from '../../src/lib/trade-save-confirmation';
export const useMe = () => ({ data: { user: { id: 'synthetic-'+persona() }, roles: [persona()==='office'?'admin':persona()==='rec'?'electrician':persona()], profile: { full_name: 'Synthetic Tester' } } });
export const useAccess = () => ({ data: { admin: persona()==='office', businessAdmin:persona()==='installer', installerBusinessAdmin:persona()==='installer' }, isLoading:false });
export function useAction(fn: (a: {data:unknown})=>Promise<unknown>) {
 const qc=useQueryClient();
 return async (data:unknown, success?:string) => { try { const out=await fn({data}); if(success){toast.success(success);showTradeSaved(success);} await qc.invalidateQueries(); return out; } catch(e){toast.error(e instanceof Error?e.message:'Failed'); return undefined;} };
}