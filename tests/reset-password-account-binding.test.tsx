import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
let active: string | null = 'office';
let listener: (event: string, session: unknown) => void = () => {};
let exchange: () => Promise<any>;
let redemption: () => Promise<any>;
let timeout: () => void = () => {};
const updates: unknown[] = [];
const session = (id: string) => ({ user: { id } });
const originalTimeout = window.setTimeout.bind(window);
mock.module('@tanstack/react-router', () => ({ createFileRoute: () => (o: any) => ({ options: o }), useNavigate: () => () => {} }));
mock.module('sonner', () => ({ toast: { error: () => {}, success: () => {} } }));
mock.module('../src/components/trade/TradeShell', () => ({ TradePublicShell: ({children}: any) => <div>{children}</div>, card: '', greenBtn: '', inputCls: '' }));
mock.module('../src/lib/partner-login-link.functions', () => ({ redeemPartnerLink: () => redemption() }));
mock.module('../src/integrations/supabase/client', () => ({ supabase: { auth: {
 getSession: async () => ({data: {session: active ? session(active) : null}}),
 getUser: async () => ({data: {user: active ? {id: active} : null}, error: null}),
 onAuthStateChange: (cb: typeof listener) => { listener = cb; return {data:{subscription:{unsubscribe:()=>{listener=()=>{};}}}}; },
 verifyOtp: () => exchange(),
 updateUser: async (v: unknown) => { updates.push({id: active, input: v});return {error:null}; },
 resetPasswordForEmail: async () => ({error:null}),
} } }));
const { Route } = await import('../src/routes/reset-password');
const Component = Route.options.component as React.ComponentType;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const emit = async (id: string | null, event='SIGNED_IN') => { active=id; await act(async()=>listener(event,id?session(id):null)); };
const pending = () => { let resolve: (v:any)=>void = () => {}; const promise = new Promise<any>(r=>{resolve=r;}); return {promise,resolve}; };
beforeEach(() => {
 active='office';updates.length=0;
 exchange=async()=>({data:{session:null},error:{message:'invalid'}});
 redemption=async()=>({outcome:'invalid'});
 window.history.replaceState(null,'','http://localhost/reset-password');
 window.setTimeout = ((cb: any, ms?:number, ...args:any[]) => { if(ms===4000||ms===15000){timeout=cb;return 12345;}return originalTimeout(cb,ms,...args); }) as typeof window.setTimeout;
});
afterEach(()=>{cleanup();window.setTimeout=originalTimeout as typeof window.setTimeout;});
const form = () => screen.queryByLabelText('New password');
const submit = async () => { fireEvent.change(screen.getByLabelText('New password'),{target:{value:'Synthetic-test-only-123'}});fireEvent.change(screen.getByLabelText('Confirm password'),{target:{value:'Synthetic-test-only-123'}});fireEvent.click(screen.getByRole('button',{name:'Save password & continue'}));await flush(); };
test('Office session and unrelated sign-in cannot enable pending incoming partner credential',async()=>{
 const d=pending();redemption=()=>d.promise;window.history.replaceState(null,'','/reset-password?link=synthetic-placeholder-long');render(<Component/>);await flush();await emit('office');expect(form()).toBeNull();expect(updates).toHaveLength(0);
});
for(const query of ['?link=','?link=x','?token_hash=','?token_hash=synthetic&type=unsupported','?link=synthetic-placeholder-long&token_hash=synthetic&type=recovery']) {
 test(`malformed incoming credential fails closed: ${query}`,async()=>{window.history.replaceState(null,'','/reset-password'+query);render(<Component/>);await flush();await emit('office');expect(form()).toBeNull();expect(screen.getByRole('alert')).toBeTruthy();expect(updates).toHaveLength(0);});
}
for(const outcome of ['invalid','expired','used']) {
 test(`${outcome} partner exchange never reuses Office`,async()=>{redemption=async()=>({outcome});window.history.replaceState(null,'','/reset-password?link=synthetic-placeholder-long');render(<Component/>);await flush();expect(form()).toBeNull();expect(updates).toHaveLength(0);});
}
test('successful incoming credential binds password update only to returned TEST account',async()=>{
 exchange=async()=>{active='dad-test';listener('SIGNED_IN',session(active));return {data:{session:session(active)},error:null};};window.history.replaceState(null,'','/reset-password?token_hash=synthetic&type=recovery&next=/portal');render(<Component/>);await flush();expect(form()).toBeTruthy();await submit();expect(updates).toHaveLength(1);expect((updates[0] as any).id).toBe('dad-test');
});
test('session event switching account before Save removes form and refuses update',async()=>{
 exchange=async()=>{active='dad-test';return {data:{session:session(active)},error:null};};window.history.replaceState(null,'','/reset-password?token_hash=synthetic&type=invite');render(<Component/>);await flush();await emit('office');expect(form()).toBeNull();expect(updates).toHaveLength(0);
});
test('fresh user check refuses account switch even without auth event',async()=>{
 exchange=async()=>{active='dad-test';return {data:{session:session(active)},error:null};};window.history.replaceState(null,'','/reset-password?token_hash=synthetic&type=recovery');render(<Component/>);await flush();active='office';await submit();expect(updates).toHaveLength(0);expect(form()).toBeNull();
});
test('timeout ignores old Office session and late successful verification cannot revive form',async()=>{
 const d=pending();exchange=()=>d.promise;window.history.replaceState(null,'','/reset-password?token_hash=synthetic&type=recovery');render(<Component/>);await act(async()=>timeout());expect(form()).toBeNull();expect(screen.getByRole('alert')).toBeTruthy();active='dad-test';d.resolve({data:{session:session(active)},error:null});await flush();expect(form()).toBeNull();expect(updates).toHaveLength(0);
});
test('unmount prevents late exchange from enabling or updating password',async()=>{
 const d=pending();exchange=()=>d.promise;window.history.replaceState(null,'','/reset-password?token_hash=synthetic&type=recovery');const view=render(<Component/>);view.unmount();active='dad-test';d.resolve({data:{session:session(active)},error:null});await flush();expect(updates).toHaveLength(0);
});
test('ordinary no-query reset preserves current-user flow',async()=>{render(<Component/>);await flush();expect(form()).toBeTruthy();await submit();expect((updates[0] as any).id).toBe('office');});
test('native recovery callback without query credential still enables password form',async()=>{active=null;render(<Component/>);await flush();expect(form()).toBeNull();await emit('dad-test','PASSWORD_RECOVERY');expect(form()).toBeTruthy();await submit();expect((updates[0] as any).id).toBe('dad-test');});
