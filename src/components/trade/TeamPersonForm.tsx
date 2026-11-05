import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { readTeamPersonFn,saveTeamPersonFn } from '@/lib/team-person-form.functions';
import { ADD_PERSON_ROLES,ADD_PERSON_ROLE_LABEL,TEAM_WORDS,addPersonProblems,type AddPersonRole } from '@/lib/team-screen.core';
import { melbourneToday } from '@/lib/melbourne-time.core';
import { card } from './TradeShell';
import { showTradeSaved } from '@/lib/trade-save-confirmation';

export function TeamPersonForm({businessId,workerId=null,onSaved,onClose,kind='installer'}:{businessId:string;workerId?:string|null;onSaved:()=>void;onClose:()=>void;kind?:'installer'|'electrician'}) {
 const read=useServerFn(readTeamPersonFn);
 const q=useQuery({queryKey:['team-person',businessId,workerId],queryFn:()=>workerId?read({data:{businessId,workerId}}):null,enabled:!!workerId});
 if(workerId&&!q.data)return <p role={q.error?'alert':'status'} className="text-sm text-sub">{q.error instanceof Error?q.error.message:'Loading…'}</p>;
 return <PersonFields key={workerId??'new'} businessId={businessId} workerId={workerId} initial={q.data??null} onSaved={onSaved} onClose={onClose} kind={kind}/>;
}
type Initial=Awaited<ReturnType<typeof readTeamPersonFn>>|null;
function PersonFields({businessId,workerId,initial,onSaved,onClose,kind}:{businessId:string;workerId:string|null;initial:Initial;onSaved:()=>void;onClose:()=>void;kind:'installer'|'electrician'}) {
 const [f,setF]=useState({name:initial?.name??'',role:(initial?.role??(kind==='electrician'?'electrician':'lead')) as AddPersonRole,mobile:initial?.mobile??'',email:initial?.email??'',dateOfBirth:'',licenceNumber:initial?.licenceNumber??'',recNumber:initial?.recNumber??'',certificateNumber:initial?.certificateNumber??'',certificateExpiry:initial?.certificateExpiry??'',certificatePath:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const save=useServerFn(saveTeamPersonFn),qc=useQueryClient();
 const installer=f.role==='lead'||f.role==='crew';
 const requiredEmail=f.role==='office'||f.role==='electrician';
 const problems=addPersonProblems({...f,hasDob:initial?.hasDob===true,requireCertificate:installer,certificatePath:null},melbourneToday());
 const field=(key:keyof typeof f,value:string)=>setF(prev=>({...prev,[key]:value}));
 const prefix=`team-person-${workerId??'new'}`;
 return <form className={`${card} mt-3 min-w-0 space-y-4`} aria-label={workerId?'Edit person':'Add a person'} onSubmit={async e=>{
  e.preventDefault();if(busy||problems.length)return;setBusy(true);setError('');
  try{await save({data:{businessId,workerId,...f,email:f.email||null,dateOfBirth:installer?f.dateOfBirth||null:null,licenceNumber:f.role==='electrician'?f.licenceNumber:null,recNumber:f.role==='electrician'?f.recNumber:null,certificateNumber:installer?f.certificateNumber:null,certificatePath:installer?f.certificatePath||null:null}});showTradeSaved(`Team member saved: ${f.name}`);void qc.invalidateQueries({queryKey:['team-person',businessId,workerId]});onSaved();onClose();}
  catch(e){setError(e instanceof Error?e.message:'The person could not be saved. Try again.');}finally{setBusy(false);}
 }}>
  <h3 className="font-display text-[20px] font-semibold text-ink">{workerId?'Edit person':'Add a person'}</h3>
  {!workerId&&kind==='installer'&&<fieldset><legend className="text-sm font-semibold">Role</legend>{ADD_PERSON_ROLES.map(role=><label key={role} className="flex min-h-12 items-start gap-3 py-2"><input className="mt-1" type="radio" name={`${prefix}-role`} checked={f.role===role} onChange={()=>field('role',role)}/><span className="text-[15px] font-semibold">{ADD_PERSON_ROLE_LABEL[role]}<span className="block text-sm font-normal text-sub">{TEAM_WORDS.roleHelp[role]}</span></span></label>)}</fieldset>}
  {workerId&&<p className="text-sm text-sub">{ADD_PERSON_ROLE_LABEL[f.role]} — {TEAM_WORDS.roleHelp[f.role]}</p>}
  <div><Label htmlFor={`${prefix}-name`}>Full name</Label><Input id={`${prefix}-name`} className="mt-2 min-h-12" required value={f.name} onChange={e=>field('name',e.target.value)}/></div>
  <div><Label htmlFor={`${prefix}-mobile`}>Mobile</Label><Input id={`${prefix}-mobile`} className="mt-2 min-h-12" required inputMode="tel" value={f.mobile} onChange={e=>field('mobile',e.target.value)}/></div>
  {installer&&<div><Label htmlFor={`${prefix}-dob`}>Date of birth</Label>{initial?.hasDob&&<p className="mt-1 text-sm text-sub">Date of birth on file ✓</p>}<Input id={`${prefix}-dob`} type="date" className="mt-2 min-h-12 max-w-full" required={!initial?.hasDob} max={melbourneToday()} value={f.dateOfBirth} onChange={e=>field('dateOfBirth',e.target.value)}/></div>}
  {installer&&<div><Label htmlFor={`${prefix}-cert`}>CII/EEC certificate number</Label><Input id={`${prefix}-cert`} className="mt-2 min-h-12" required value={f.certificateNumber} onChange={e=>field('certificateNumber',e.target.value)}/></div>}
  {installer&&<div><Label htmlFor={`${prefix}-expiry`}>CII/EEC expiry date</Label><Input id={`${prefix}-expiry`} type="date" className="mt-2 min-h-12 max-w-full" required value={f.certificateExpiry} onChange={e=>field('certificateExpiry',e.target.value)}/></div>}
  <div><Label htmlFor={`${prefix}-email`}>{requiredEmail?'Email':'Email (optional)'}</Label><Input id={`${prefix}-email`} className="mt-2 min-h-12" type="email" required={requiredEmail} value={f.email} onChange={e=>field('email',e.target.value)}/>{f.role==='lead'&&<p className="mt-1 text-sm text-sub">Needed for their Mitti login</p>}{f.role==='electrician'&&<p className="mt-1 text-sm text-sub">Needed for the Mitti safety check form</p>}</div>
  {f.role==='electrician'&&<><div><Label htmlFor={`${prefix}-licence`}>Electrical licence number</Label><Input id={`${prefix}-licence`} className="mt-2 min-h-12" required value={f.licenceNumber} onChange={e=>field('licenceNumber',e.target.value)}/></div><div><Label htmlFor={`${prefix}-rec`}>REC number</Label><Input id={`${prefix}-rec`} className="mt-2 min-h-12" required value={f.recNumber} onChange={e=>field('recNumber',e.target.value)}/></div></>}
  {error&&<p role="alert" className="text-sm font-semibold text-rose">{error}</p>}
  <Button type="submit" className="min-h-12 w-full" disabled={busy||problems.length>0}>{busy?'Saving…':workerId?'Save':'Add to team'}</Button>
  <Button type="button" variant="outline" className="min-h-12 w-full" disabled={busy} onClick={onClose}>Cancel</Button>
 </form>;
}