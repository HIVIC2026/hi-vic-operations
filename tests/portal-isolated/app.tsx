import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createRouter,createRootRoute,createRoute,RouterProvider,Outlet} from '@tanstack/react-router';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Toaster} from 'sonner';
import {Route as Home} from '../../src/routes/_authenticated/field.index';
import {Route as Job} from '../../src/routes/_authenticated/field.$jobId';
import {Route as Needs} from '../../src/routes/_authenticated/admin.needs-me';
import {Route as InstallerJoin} from '../../src/routes/installer-onboarding';
import {Route as AddJob} from '../../src/routes/_authenticated/partner.import';
import {Route as RecJoin} from '../../src/routes/electrician-onboarding';
import {TemplatesHub} from '../../src/components/portal/template-hub';
import {TeamPersonForm} from '../../src/components/trade/TeamPersonForm';
import {TradeShell} from '../../src/components/trade/TradeShell';
import {OwnCustomerReadyCheckChoice} from '../../src/components/trade/OwnCustomerReadyCheckChoice';
import {NextStepBox} from '../../src/components/trade/NextStepBox';
import {persona,JOB} from './fixtures';
import '../../src/styles.css';
const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
function Team(){const[open,setOpen]=useState(true);return <TradeShell installer boss><h1>Team</h1>{open?<TeamPersonForm businessId="synthetic-business" onSaved={()=>{}} onClose={()=>setOpen(false)}/>:<button onClick={()=>setOpen(true)}>Add a person</button>}</TradeShell>;}
function Safety(){return <TradeShell installer boss><NextStepBox jobId={JOB} box={{kind:'book_piesa',sub:'',lines:[],blockers:[],title:'Book the safety check',line:'The owner has accepted the quote and paid for the safety check. Call them, agree a day and time, then add it here.'} as any} ownerFirst="Synthetic" installBy={null} ownCustomer/></TradeShell>;}
const root=createRootRoute({component:()=> <><Outlet/><Toaster/></>});
function content(route:any){if(!route.options.component)throw new Error('Missing real route component');return route.options.component;}
const routes=[['/partner/import',AddJob],['/field',Home],['/field/$jobId',Job],['/admin/needs-me',Needs],['/installer-onboarding',InstallerJoin],['/electrician-onboarding',RecJoin]].map(([path,route]:any)=>{
 const r=createRoute({getParentRoute:()=>root,path,component:content(route),beforeLoad:()=>({user:{id:'synthetic-'+persona()},qaOffice:false})});
 // Real page hooks resolve their own route IDs in this isolated real router.
 Object.assign(route,{useParams:()=>r.useParams(),useSearch:()=>r.useSearch(),useRouteContext:()=>r.useRouteContext()});return r;
});
routes.push(createRoute({getParentRoute:()=>root,path:'/field/business/team',component:Team}),createRoute({getParentRoute:()=>root,path:'/admin/templates',component:()=> <div className="portal-theme p-4"><TemplatesHub cat="waiting"/></div>}),createRoute({getParentRoute:()=>root,path:'/qa/safety',component:Safety}));
const router=createRouter({routeTree:root.addChildren(routes),context:{queryClient:qc}});
function App(){return <QueryClientProvider client={qc}><RouterProvider router={router}/></QueryClientProvider>;}
const el=document.getElementById('root');if(el)createRoot(el).render(<App/>);