import { test, expect } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
const { default: React } = await import('react');
const { render, fireEvent, cleanup, waitFor } = await import('@testing-library/react');
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import * as core from '../src/lib/in-house-booking.core';
import * as days from '../src/lib/install-days.core';
function fixture(depositPaid=true){
 const calls:any[]=[];const book=async(p:any)=>{calls.push(p);return {ok:true};};
 const deps:Record<string,any>={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'@tanstack/react-query':{useQuery:(o:any)=>o.queryKey[0]==='in-house-booking-team'?{data:{depositPaid,workers:[{id:'new',name:'New Installer',tradeRole:'installer',workerRole:'lead',cleared:true,reason:null,escRegistered:true,escRegisteredAt:'2026-11-01'}],selection:null}}:{data:{allowed:true}},useQueryClient:()=>({invalidateQueries:async()=>{}})},'@tanstack/react-start':{useServerFn:(fn:any)=>fn},sonner:{toast:{success:()=>{}}},'@/lib/trade-view.functions':{inHouseBookVisit:book},'@/lib/in-house-booking.core':core,'@/lib/install-days.core':days,'@/lib/office-list-refresh':{markOfficeChanged:()=>{}},'@/components/ui/input':{Input:(p:any)=>React.createElement('input',p)},'@/components/ui/button':{Button:({size,variant,...p}:any)=>React.createElement('button',p)},'./installer-kit':{Group:({children}:any)=>children}};
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/components/trade/InHouseBookingCard.tsx','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});
 return {api,calls};
}
test('inline install row refuses missing Lead Installer, then submits the chosen person and Melbourne arrival through the canonical booking action',async()=>{
 const f=fixture();const ui=render(React.createElement(f.api.InHouseBookingRow,{jobId:'j',kind:'installation'}));
 const button=ui.getByRole('button',{name:'Book'}) as HTMLButtonElement;
 expect(button.disabled).toBe(true);fireEvent.submit(button.closest('form') as HTMLFormElement);expect(f.calls).toHaveLength(0);
 fireEvent.change(ui.getByLabelText('Install day day'),{target:{value:'2026-11-03'}});fireEvent.change(ui.getByLabelText('Install day arrival'),{target:{value:'09:00'}});
 fireEvent.change(ui.getByLabelText("Install day who's going"),{target:{value:'new'}});expect(button.disabled).toBe(false);fireEvent.click(button);
 await waitFor(()=>expect(f.calls).toHaveLength(1));expect(f.calls[0].data).toEqual({jobId:'j',kind:'installation',start:'2026-11-02T22:00:00.000Z',workerId:'new',crewIds:[]});cleanup();
});
test('inline install row cannot book before the deposit is confirmed paid',()=>{
 const f=fixture(false);const ui=render(React.createElement(f.api.InHouseBookingRow,{jobId:'j',kind:'installation'}));
 expect(ui.queryByRole('button',{name:'Book'})).toBeNull();expect(f.calls).toHaveLength(0);cleanup();
});