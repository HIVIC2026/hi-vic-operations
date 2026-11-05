// Disposable localStorage fixtures only. No hosted sessions, SQL, invoices or deliveries.
export const JOB = '00000000-0000-4000-8000-000000000101';
export const persona = () => sessionStorage.getItem('qa-role') || 'installer';
const STORE = 'isolated-portal-fixtures-v1';
export function state(): any { return JSON.parse(localStorage.getItem(STORE) || '{"price":null,"team":[],"mitti":false,"calls":[],"fail":null}'); }
export function update(s: any) { localStorage.setItem(STORE, JSON.stringify(s)); }
export function home() { const s=state();const c={jobId:JOB,pill:'Your customer',owner:'Synthetic Owner',hvSuburb:'HV-TEST-101 · Testville',step:s.price?'Quote being prepared':'Measure and quote',reason:s.price?'Home Insulation Victoria is checking it':'New job',button:s.price?null:'Measure and quote',by:null,overdue:false}; return {kind:'installer',boss:true,money:true,isTest:true,myWork:{greeting:{title:'Hi, TEST Partner team',sub:''},yourTurn:[c],all:[c]}}; }
const overview=()=>({id:JOB,job_number:'HV-TEST-101',owner_name:'Synthetic Owner',property_address:'101 Test Street, Testville VIC 3000',stage:'ready_check_ready_to_schedule',life_support:false,mitti_ready_check_audit_id:null});
function page() {return {kind:'installer',channel:'installer_sourced',prices:true,boss:true,money:true,isTest:true,nextStep:{kind:'book_ready_check',title:'Measure and quote'},install:{form:{complete:false},rebateSigned:false,ownerReady:null,recordedAt:null},price:{entered:!!state().price},form:{linked:false,complete:false},progress:[{label:'Ready Check',state:'now'}],label:'Measure & quote',rows:{siteNotes:[],jobDetails:[],ownerTold:[],paperwork:[{label:'Ready Check',ready:false,note:'Not done yet'}],owner:[['Name','Synthetic Owner'],['Mobile','0400000000'],['Email','owner@isolated.invalid']],visits:[],site:[],money:[],told:[]},paperwork:[],readyCheck:{complete:false},countdown:null,ownerFirst:'Synthetic',installBy:null};}
function price() { const s=state();return {canSet:true,locked:false,current:s.price,removalRequired:false,quoteCore:{ready:false,information:[]},change:null}; }
export async function callFixture(name: string, args?: any): Promise<any> {
 const s=state();s.calls.push(name);update(s);
 if(s.fail===name){s.fail=null;update(s);throw new Error('Synthetic request failed. Try again.');}
 const d=args?.data??{};
 if(name==='getTradeHome')return home();
 if(name==='getJobOverview')return overview();
 if(name==='getTradeJobPage')return page();
 if(name==='getTradeJobBundle')return {overview:overview(),role:'installer',page:page(),price:price(),inHouseBookingAccess:{allowed:false},ownerQuote:{kind:'none'}};
 if(name==='getInstallerPriceFn')return price();
 if(name==='getOwnMittiStatus')return {requested:s.mitti,auditId:null,portalSaved:!!s.price};
 if(name==='requestOwnMittiForm'){s.mitti=true;update(s);return {ok:true};}
 if(name==='saveOwnCustomerReadyCheck'){s.price={record:{price_inc_gst:d.values.priceIncGst,included:['Ceiling insulation - supply & install']},setAt:new Date().toISOString(),setBy:null,sendToQuote:true};update(s);return {ok:true};}
 if(name==='saveTeamPersonFn'){s.team.push(d);update(s);return {ok:true};}
 if(name==='readTeamPersonFn')return s.team[0]??null;
 if(name==='getNeedsMePage')return {groups:{quotes:[{key:'quote',kind:'quote_check',jobId:JOB,jobNumber:'HV-TEST-101',surname:'Synthetic',suburb:'Testville',line:s.price?'Price changed by installer':'Quote needs checking',since:'2026-11-05T01:00:00Z',button:{to:'job',label:'Check'}}]},system:[],total:1,computedAt:new Date().toISOString(),now:Date.now(),refreshing:false};
 if(['getMittiPickups','getMittiSyncProblems','getRobotFailures'].includes(name))return {rows:[]};
 if(name==='getOfficeSwitches')return {switches:[{key:'customer_comms',on:false}],named:1};
 if(name==='getInHouseBookingAccess')return {allowed:false};
 if(name==='getMyOwnerQuote')return {kind:'none'};
 if(name==='getReadyCheckPhotos')return {photos:[]};
 if(name==='loadInstallerOnboarding'||name==='loadRecOnboarding')return {data:{},step:'business',revision:1,status:'draft'};
 if(name==='startInstallerOnboarding'||name==='startRecOnboarding')return {token:'synthetic-resume-token-12345678901234567890',revision:1,data:{},step:'business'};
 if(name==='saveInstallerOnboarding'||name==='saveRecOnboarding'){localStorage.setItem('qa-onboarding-'+persona(),JSON.stringify(d));return {revision:2,data:d.data??{},step:d.step};}
 throw new Error('ISOLATED_FIXTURE_UNSUPPORTED: '+name);
}