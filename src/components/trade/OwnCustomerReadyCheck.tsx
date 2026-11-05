import {useState} from 'react';
import {useServerFn} from '@tanstack/react-start';
import {useQueryClient} from '@tanstack/react-query';
import {Plus, Trash2, Upload} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {supabase} from '@/integrations/supabase/client';
import {saveOwnCustomerReadyCheck,portalReadyCheckUpload} from '@/lib/own-customer-portal-ready-check.functions';
import {portalReadyCheckSchema,calculatedPortalArea,portalAreaNudge,type PortalReadyCheckInput} from '@/lib/own-customer-portal-ready-check.core';
import {OWN_READY_CHECK_COPY as W} from '@/lib/own-customer-ready-check-copy.core';

import {inputCls} from './trade-classes';

export function OwnCustomerReadyCheck({jobId,onOpenChange}:{jobId:string;onOpenChange?:(open:boolean)=>void}) {
 const [open,setOpen]=useState(false), [busy,setBusy]=useState(false), [uploading,setUploading]=useState(false), [saved,setSaved]=useState(false), [error,setError]=useState('');
 const [install,setInstall]=useState(''), [removal,setRemoval]=useState(''), [existing,setExisting]=useState(''), [r,setR]=useState(''), [method,setMethod]=useState(''), [access,setAccess]=useState(''), [price,setPrice]=useState(''), [other,setOther]=useState('');
 const [areas,setAreas]=useState([{name:'',length:'',width:'',size:''}]);
 const [planArea,setPlanArea]=useState(''), [measurementNote,setMeasurementNote]=useState('');
 const [files,setFiles]=useState<PortalReadyCheckInput['files']>([]);
 const save=useServerFn(saveOwnCustomerReadyCheck), upload=useServerFn(portalReadyCheckUpload), qc=useQueryClient();
 const prefix=`portal-rc-${jobId}`;
 const visibleFiles=files.filter(f=>f.purpose==='photo'||f.purpose===method||(method==='onsite'&&f.purpose==='sketch'));
 const measured=method==='onsite'?areas.reduce((n,a)=>n+Number(a.size),0):Number(planArea);
 const nudge=portalAreaNudge(Number(install),measured);
 function dimension(i:number,key:'length'|'width',value:string){setAreas(prev=>prev.map((a,n)=>{if(n!==i)return a;const next={...a,[key]:value};const size=calculatedPortalArea(Number(next.length),Number(next.width));return {...next,size:size==null?'':String(size)};}));}
 async function addFiles(list:FileList|null,purpose:PortalReadyCheckInput['files'][number]['purpose']) {
  if(!list)return;
  setUploading(true); setError('');
  try { for(const f of Array.from(list)) {
   const meta={name:f.name,mime:f.type,size:f.size,purpose};
   const dest=await upload({data:{jobId,file:meta}});
   const result=await supabase.storage.from('job-files').uploadToSignedUrl(dest.path,dest.token,f,{contentType:f.type});
   if(result.error)throw result.error;
   setFiles(prev=>[...prev,{...meta,path:dest.path}]);
  }}catch(e){setError(e instanceof Error?e.message:'The upload failed. Try again.');}finally{setUploading(false);}
 }
 async function submit(e:React.FormEvent) {
  e.preventDefault();setError('');
  const result=portalReadyCheckSchema.safeParse({installM2:install.trim()?Number(install):undefined,removalM2:removal.trim()?Number(removal):undefined,existing,rValue:r||undefined,method,areas:method==='onsite'?areas.map(a=>({name:a.name,m2:a.size.trim()?Number(a.size):undefined,lengthM:a.length.trim()?Number(a.length):undefined,widthM:a.width.trim()?Number(a.width):undefined})):[],access,priceIncGst:price.trim()?Number(price):undefined,files:visibleFiles,planM2:(method==='floor_plan'||method==='aerial')&&planArea.trim()?Number(planArea):undefined,measurementNote:method==='other'?measurementNote:'',other});
  if(!result.success){setError(result.error.issues.map(i=>i.message).join(' '));return;}
  setBusy(true);
  try {await save({data:{jobId,values:result.data}});setSaved(true); await Promise.all(['trade-job-page','installer-price','job','job-files','ready-check-photos'].map(key=>qc.invalidateQueries({queryKey:[key,jobId]})));}
  catch(e){setError(e instanceof Error?e.message:'The details could not be saved. Try again.');}finally{setBusy(false);}
 }
 if(saved)return <p role="status" className="mt-4 text-sm font-semibold text-ink">{W.preparing}</p>;
 return <div className="mt-4 min-w-0">
  <Button type="button" variant="outline" className="h-auto min-h-12 w-full flex-col items-start gap-2 whitespace-normal py-4 text-left" onClick={()=>{setOpen(!open);onOpenChange?.(!open);}} aria-expanded={open}><span className="font-semibold">{W.portalOption}</span><span className="text-sm font-normal text-sub">{W.portalIntro}</span></Button>
  {open&&<form onSubmit={submit} className="mt-4 min-w-0 space-y-4" aria-label="Ready Check details">
   <h2 className="font-display text-[22px] font-semibold">{W.title}</h2><p className="text-sm text-sub">{W.intro}</p><div className="grid min-w-0 grid-cols-1 gap-4">
    <div className="min-w-0"><Label htmlFor={`${prefix}-install`}>Install m²</Label><p className="my-2 text-sm text-sub">{W.install}</p><Input id={`${prefix}-install`} className={inputCls} required type="number" min="0.01" step="0.01" inputMode="decimal" value={install} onChange={e=>setInstall(e.target.value)}/></div>
    <div className="min-w-0"><Label htmlFor={`${prefix}-removal`}>Removal m²</Label><p className="my-2 text-sm text-sub">{W.removal}</p><Input id={`${prefix}-removal`} className={inputCls} required type="number" min="0" step="0.01" inputMode="decimal" value={removal} onChange={e=>setRemoval(e.target.value)}/></div>
   </div>
   <div><Label htmlFor={`${prefix}-existing`}>What's in the ceiling now?</Label><select id={`${prefix}-existing`} required className={inputCls} value={existing} onChange={e=>{setExisting(e.target.value);if(e.target.value==='none')setR('');}}><option value="">Choose</option><option value="none">Nothing</option><option value="present">Old insulation</option></select></div>
   {existing==='present'&&<div><Label htmlFor={`${prefix}-r`}>What R-value is it?</Label><select id={`${prefix}-r`} required className={inputCls} value={r} onChange={e=>setR(e.target.value)}><option value="">Choose</option><option>R0.5</option><option>R1.0</option><option>R1.5</option><option>R2.0 or more</option><option>Don't know</option></select>{r==='R2.0 or more'&&<p className="mt-2 text-sm font-semibold text-rose" role="status">Ready Check failed — existing insulation is R2.0 or more.</p>}</div>}
   <div><Label htmlFor={`${prefix}-method`}>How did you measure it?</Label><select id={`${prefix}-method`} required className={inputCls} value={method} onChange={e=>setMethod(e.target.value)}><option value="">Choose</option><option value="floor_plan">Floor plan</option><option value="aerial">Aerial view</option><option value="onsite">Measured on site</option><option value="other">Other</option></select></div>
   {method==='onsite'&&<fieldset className="min-w-0 space-y-3"><legend className="mb-2 font-semibold">List each ceiling area:</legend>{areas.map((a,i)=><div key={i} className="grid min-w-0 grid-cols-2 items-end gap-2">
    <div className="col-span-2 min-w-0"><Label htmlFor={`${prefix}-name-${i}`}>Area name</Label><Input id={`${prefix}-name-${i}`} className={inputCls} required value={a.name} onChange={e=>setAreas(prev=>prev.map((v,n)=>n===i?{...v,name:e.target.value}:v))}/></div>
    <div className="min-w-0"><Label htmlFor={`${prefix}-length-${i}`}>Length (m)</Label><Input id={`${prefix}-length-${i}`} className={inputCls} type="number" min="0.01" step="0.01" inputMode="decimal" required value={a.length} onChange={e=>dimension(i,'length',e.target.value)}/></div>
    <div className="min-w-0"><Label htmlFor={`${prefix}-width-${i}`}>× Width (m)</Label><Input id={`${prefix}-width-${i}`} className={inputCls} type="number" min="0.01" step="0.01" inputMode="decimal" required value={a.width} onChange={e=>dimension(i,'width',e.target.value)}/></div>
    <div className="min-w-0"><Label htmlFor={`${prefix}-size-${i}`}>m²</Label><Input id={`${prefix}-size-${i}`} className={inputCls} type="number" min="0.01" step="0.01" inputMode="decimal" required value={a.size} onChange={e=>setAreas(prev=>prev.map((v,n)=>n===i?{...v,size:e.target.value}:v))}/></div>
    <Button type="button" variant="ghost" size="icon" className="h-12 w-10 shrink-0" aria-label={`Remove area ${i+1}`} title="Remove area" disabled={areas.length===1} onClick={()=>setAreas(prev=>prev.filter((_,n)=>n!==i))}><Trash2 className="h-4 w-4"/></Button>
   </div>)}<Button type="button" variant="outline" className="min-h-12" disabled={areas.length>=30} onClick={()=>setAreas(prev=>[...prev,{name:'',length:'',width:'',size:''}])}><Plus className="h-4 w-4"/>Add another area</Button><div><input id={`${prefix}-sketch`} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic" disabled={busy||uploading} onChange={e=>void addFiles(e.target.files,'sketch')}/><Button type="button" variant="outline" className="min-h-12" disabled={busy||uploading} onClick={()=>document.getElementById(`${prefix}-sketch`)?.click()}><Upload className="h-4 w-4"/>Add a sketch</Button></div></fieldset>}
   {(method==='floor_plan'||method==='aerial')&&<div>
    <Label htmlFor={`${prefix}-plan`}>{method==='aerial'?'Upload the aerial image':'Upload the floor plan'}</Label>
    <Input id={`${prefix}-plan`} className="min-w-0 max-w-full" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" disabled={busy||uploading} onChange={e=>void addFiles(e.target.files,method==='aerial'?'aerial':'floor_plan')}/>
    <Label htmlFor={`${prefix}-plan-area`}>Install m²</Label><Input id={`${prefix}-plan-area`} className={inputCls} type="number" min="0.01" step="0.01" inputMode="decimal" value={planArea} onChange={e=>setPlanArea(e.target.value)}/>
   </div>}
   {method==='other'&&<div className="space-y-2"><Label htmlFor={`${prefix}-measurement-note`}>How did you measure it?</Label><Textarea id={`${prefix}-measurement-note`} required maxLength={1000} value={measurementNote} onChange={e=>setMeasurementNote(e.target.value)}/><input id={`${prefix}-measurement-upload`} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" disabled={busy||uploading} onChange={e=>void addFiles(e.target.files,'other')}/><Button type="button" variant="outline" className="min-h-12" disabled={busy||uploading} onClick={()=>document.getElementById(`${prefix}-measurement-upload`)?.click()}><Upload className="h-4 w-4"/>Upload</Button></div>}
   {nudge&&(method==='onsite'||method==='floor_plan'||method==='aerial')&&<p role="status" className="text-sm text-sub">{nudge}</p>}
   <div><Label htmlFor={`${prefix}-access`}>Access</Label><select id={`${prefix}-access`} required className={inputCls} value={access} onChange={e=>setAccess(e.target.value)}><option value="">Choose</option><option value="standard">Standard</option><option value="moderate">Moderate</option><option value="difficult">Difficult</option></select></div>
   <div><Label htmlFor={`${prefix}-photos`}>Photos (optional)</Label><p className="my-2 text-sm text-sub">{W.photos}</p><Input id={`${prefix}-photos`} className="min-w-0 max-w-full" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic" disabled={busy||uploading} onChange={e=>void addFiles(e.target.files,'photo')}/></div>
   {visibleFiles.map(f=><p key={f.path} className="flex gap-2 break-all text-sm text-sub"><Upload className="h-4 w-4 shrink-0"/>{f.name}</p>)}
   <div><Label htmlFor={`${prefix}-price`}>Your price inc GST</Label><p className="my-2 text-sm text-sub">{W.price}</p><Input id={`${prefix}-price`} className={inputCls} required type="number" min="0.01" step="0.01" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></div>
   <div><Label htmlFor={`${prefix}-other`}>Anything else? (optional)</Label><p className="my-2 text-sm text-sub">{W.other}</p><Textarea id={`${prefix}-other`} maxLength={1000} value={other} onChange={e=>setOther(e.target.value)}/></div>
   {error&&<p role="alert" className="text-sm font-semibold text-rose">{error}</p>}
   {uploading&&<p role="status" className="text-sm text-sub">Uploading…</p>}
   <Button type="submit" className="min-h-12 w-full" disabled={busy||uploading}>{busy?'Saving…':W.submit}</Button><p className="text-sm text-sub">{W.locked}</p>
  </form>}
 </div>;
}