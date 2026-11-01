import {createFileRoute} from '@tanstack/react-router';
import {createClient} from '@supabase/supabase-js';
import {publishedHarnessCapabilities} from '@/lib/published-in-house-preflight.core';
/** Raw CLI read contract. Public prefix still requires authenticated persisted admin role. No writes/providers. */
export const Route=createFileRoute('/api/public/qa-in-house-preflight')({server:{handlers:{GET:async({request})=>{
 const headers={'Cache-Control':'no-store'};
 const url=new URL(request.url),runId=url.searchParams.get('run');
 if(!runId||!/^run-[a-zA-Z0-9-]{8,80}$/.test(runId))return Response.json({error:'Invalid TEST run.'},{status:400,headers});
 const token=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token||token.split('.').length!==3)return Response.json({error:'Sign-in required.'},{status:401,headers});
 const endpoint=process.env['SUPABASE_URL'],key=process.env['SUPABASE_PUBLISHABLE_KEY'];
 if(!endpoint||!key)return Response.json({error:'Safety check unavailable.'},{status:503,headers});
 const sb=createClient(endpoint,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`},fetch:(input,init)=>{const h=new Headers(init?.headers);h.set('apikey',key);return fetch(input,{...init,headers:h});}}});
 const auth=await sb.auth.getUser(token);
 if(auth.error||!auth.data.user)return Response.json({error:'Sign-in required.'},{status:401,headers});
 const role=await sb.rpc('has_role',{_user_id:auth.data.user.id,_role:'admin'});
 if(role.error||role.data!==true)return Response.json({error:'Office administrator required.'},{status:403,headers});
 return Response.json(publishedHarnessCapabilities(url.origin,runId),{headers});
}}}});