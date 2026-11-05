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
import {portalReadyCheckSchema,type PortalReadyCheckInput} from '@/lib/own-customer-portal-ready-check.core';
import {FLOOR_PLAN_Q,AERIAL_Q} from '@/lib/ready-check-floor-plan.core';
import {OWN_CUSTOMER_QUOTE_PREPARING_LINE} from '@/lib/installer-quote-status.core';
import {inputCls} from './trade-classes';

export function OwnCustomerReadyCheck({jobId,onOpenChange}:{jobId:string;onOpenChange?:(open:boolean)=>void}) {
 const [open,setOpen]=useState(false), [busy,setBusy]=useState(false), [uploading,setUploading]=useState(false), [saved,setSaved]=useState(false), [error,setError]=useState('');
 const [install,setInstall]=useState(''), [removal,setRemoval]=useState(''), [existing,setExisting]=useState(''), [r,setR]=useState(''), [method,setMethod]=useState(''), [access,setAccess]=useState(''), [price,setPrice]=useState(''), [other,setOther]=useState('');
 const [areas,setAreas]=useState([{name:'',size:''}]);
 const [files,setFiles]=useState<PortalReadyCheckInput['files']>([]);
 const save=useServerFn(saveOwnCustomerReadyCheck), upload=useServerFn(portalReadyCheckUpload), qc=useQueryClient();
 const prefix=`portal-rc-${jobId}`;
 async function addFiles(list:FileList|null,purpose:'floor_plan'|'aerial'|'photo') {
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
  const result=portalReadyCheckSchema.safeParse({installM2:install.trim()?Number(install):undefined,removalM2:removal.trim()?Number(removal):undefined,existing,rValue:r||undefined,method,areas:method==='onsite'?areas.map(a=>({name:a.name,m2:a.size.trim()?Number(a.size):undefined})):[],access,priceIncGst:price.trim()?Number(price):undefined,files:files.filter(f=>f.purpose==='photo'||f.purpose===method),other});
  if(!result.success){setError(result.error.issues.map(i=>i.message).join(' '));return;}
  setBusy(true);
  try {await save({data:{jobId,values:result.data}});setSaved(true); await Promise.all(['trade-job-page','installer-price','job','job-files','ready-check-photos'].map(key=>qc.invalidateQueries({queryKey:[key,jobId]})));}
  catch(e){setError(e instanceof Error?e.message:'The details could not be saved. Try again.');}finally{setBusy(false);}
 }
 if(saved)return <p role="status" className="mt-4 text-sm font-semibold text-ink">{OWN_CUSTOMER_QUOTE_PREPARING_LINE}</p>;
 return <div className="mt-4 min-w-0">
  <Button type="button" variant="outline" className="min-h-12 w-full whitespace-normal" onClick={()=>{setOpen(!open);onOpenChange?.(!open);}} aria-expanded={open}>Put the details in the portal</Button>
  {open&&<form onSubmit={submit} className="mt-4 min-w-0 space-y-4" aria-label="Ready Check details">
   <div className="grid min-w-0 grid-cols-2 gap-3">
    <div className="min-w-0"><Label htmlFor={`${prefix}-install`}>Install m²</Label><Input id={`${prefix}-install`} className={inputCls} required type="number" min="0.01" step="0.01" inputMode="decimal" value={install} onChange={e=>setInstall(e.target.value)}/></div>
    <div className="min-w-0"><Label htmlFor={`${prefix}-removal`}>Removal m² (0 if none)</Label><Input id={`${prefix}-removal`} className={inputCls} required type="number" min="0" step="0.01" inputMode="decimal" value={removal} onChange={e=>setRemoval(e.target.value)}/></div>
   </div>
   <div><Label htmlFor={`${prefix}-existing`}>Existing insulation</Label><select id={`${prefix}-existing`} required className={inputCls} value={existing} onChange={e=>{setExisting(e.target.value);if(e.target.value==='none')setR('');}}><option value="">Choose</option><option value="none">None</option><option value="present">Present</option></select></div>
   {existing==='present'&&<div><Label htmlFor={`${prefix}-r`}>Old insulation R value?</Label><select id={`${prefix}-r`} required className={inputCls} value={r} onChange={e=>setR(e.target.value)}><option value="">Choose</option><option>Below R2.0</option><option>R2.0 or more</option></select>{r==='R2.0 or more'&&<p className="mt-2 text-sm font-semibold text-rose" role="status">Ready Check failed — existing insulation is R2.0 or more.</p>}</div>}
   <div><Label htmlFor={`${prefix}-method`}>How did you measure it?</Label><select id={`${prefix}-method`} required className={inputCls} value={method} onChange={e=>setMethod(e.target.value)}><option value="">Choose</option><option value="floor_plan">Floor plan</option><option value="aerial">Aerial image</option><option value="onsite">Measured on site</option></select></div>
   {method==='onsite'&&<fieldset className="min-w-0 space-y-3"><legend className="mb-2 font-semibold">Ceiling areas</legend>{areas.map((a,i)=><div key={i} className="flex min-w-0 items-end gap-2">
    <div className="min-w-0 flex-1"><Label htmlFor={`${prefix}-name-${i}`}>Area name</Label><Input id={`${prefix}-name-${i}`} className={inputCls} required value={a.name} onChange={e=>setAreas(prev=>prev.map((v,n)=>n===i?{...v,name:e.target.value}:v))}/></div>
    <div className="min-w-0 w-24"><Label htmlFor={`${prefix}-size-${i}`}>m²</Label><Input id={`${prefix}-size-${i}`} className={inputCls} type="number" min="0.01" step="0.01" inputMode="decimal" required value={a.size} onChange={e=>setAreas(prev=>prev.map((v,n)=>n===i?{...v,size:e.target.value}:v))}/></div>
    <Button type="button" variant="ghost" size="icon" className="h-12 w-10 shrink-0" aria-label={`Remove area ${i+1}`} title="Remove area" disabled={areas.length===1} onClick={()=>setAreas(prev=>prev.filter((_,n)=>n!==i))}><Trash2 className="h-4 w-4"/></Button>
   </div>)}<Button type="button" variant="outline" className="min-h-12" disabled={areas.length>=30} onClick={()=>setAreas(prev=>[...prev,{name:'',size:''}])}><Plus className="h-4 w-4"/>Add area</Button></fieldset>}
   {(method==='floor_plan'||method==='aerial')&&<div>
    <p className="text-sm font-semibold">{method==='aerial'?AERIAL_Q.area:FLOOR_PLAN_Q.area}: {install||'—'}</p>
    <Label htmlFor={`${prefix}-plan`}>{method==='aerial'?AERIAL_Q.file:FLOOR_PLAN_Q.file}</Label>
    <p className="my-2 text-sm text-sub">{method==='aerial'?AERIAL_Q.fileInstruction:FLOOR_PLAN_Q.fileInstruction}</p>
    <Input id={`${prefix}-plan`} className="min-w-0 max-w-full" type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" disabled={busy||uploading} onChange={e=>void addFiles(e.target.files,method==='aerial'?'aerial':'floor_plan')}/>
   </div>}
   <div><Label htmlFor={`${prefix}-access`}>Access</Label><select id={`${prefix}-access`} required className={inputCls} value={access} onChange={e=>setAccess(e.target.value)}><option value="">Choose</option><option value="standard">Standard</option><option value="moderate">Moderate</option><option value="difficult">Difficult</option></select></div>
   <div><Label htmlFor={`${prefix}-price`}>Price inc GST</Label><Input id={`${prefix}-price`} className={inputCls} required type="number" min="0.01" step="0.01" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></div>
   <div><Label htmlFor={`${prefix}-photos`}>Photos (optional)</Label><Input id={`${prefix}-photos`} className="min-w-0 max-w-full" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic" disabled={busy||uploading} onChange={e=>void addFiles(e.target.files,'photo')}/></div>
   {files.filter(f=>f.purpose==='photo'||f.purpose===method).map(f=><p key={f.path} className="flex gap-2 break-all text-sm text-sub"><Upload className="h-4 w-4 shrink-0"/>{f.name}</p>)}
   <div><Label htmlFor={`${prefix}-other`}>Other (optional)</Label><Textarea id={`${prefix}-other`} maxLength={1000} value={other} onChange={e=>setOther(e.target.value)}/></div>
   {error&&<p role="alert" className="text-sm font-semibold text-rose">{error}</p>}
   {uploading&&<p role="status" className="text-sm text-sub">Uploading…</p>}
   <Button type="submit" className="min-h-12 w-full" disabled={busy||uploading}>{busy?'Saving…':'Save'}</Button>
  </form>}
 </div>;
}