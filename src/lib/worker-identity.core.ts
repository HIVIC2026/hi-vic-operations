export function dateOfBirthProblem(value:string|null|undefined,today:string):string|null {
 if(!value)return 'Add their date of birth for ESC registration.';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)return 'Enter a valid date of birth.';
 return value>=today?'Date of birth must be before today.':null;
}
export function escRegistrationTasks(rows:readonly {id:string;business_id:string;full_legal_name:string;trade_role:string;worker_role?:string|null;esc_registered?:boolean;removed_at?:string|null}[]){
 return rows.filter(w=>!w.removed_at&&w.trade_role==='installer'&&w.worker_role!=='crew'&&!w.esc_registered).map(w=>({key:`esc-register:${w.id}`,tag:'Person',who:w.full_legal_name,line:`Register ${w.full_legal_name} with ESC`,since:null,button:'Register',href:`/admin/partners/business/${w.business_id}`}));
}