import {test,expect} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
test('practice office scope closes terminal/test records and requires progression for enquiry stages',async()=>{
 const db=new PGlite();
 await db.exec(`create table jobs(id text,stage text,progressed boolean,spot_saved boolean,closed boolean);
 insert into jobs values ('new','new_enquiry',false,false,false),('review','eligibility_review',false,false,false),('estimate','preliminary_estimate_ready',false,false,false),('hold','on_hold',false,false,false),('saved','new_enquiry',false,true,false),('requested','on_hold',true,false,false),('completed','complete',true,false,true),('cancelled','cancelled',false,false,true),('ineligible','on_hold',false,false,true),('test','new_enquiry',false,false,true),('removed','new_enquiry',false,false,true),('duplicate','new_enquiry',false,false,true);
 create view office_scope as select *,case when closed then 'closed' when spot_saved or progressed or stage not in ('new_enquiry','eligibility_review','preliminary_estimate_ready','on_hold','ready_check_awaiting_acceptance','ready_check_awaiting_payment','ready_check_ready_to_schedule') then 'active' else 'enquiry' end bucket from jobs;`);
 const r=await db.query<{id:string;bucket:string}>('select id,bucket from office_scope order by id');
 expect(r.rows.filter(x=>x.bucket==='enquiry').map(x=>x.id)).toEqual(['estimate','hold','new','review']);
 expect(r.rows.filter(x=>x.bucket==='active').map(x=>x.id)).toEqual(['requested','saved']);
 expect(r.rows.filter(x=>x.bucket==='closed').map(x=>x.id)).toEqual(['cancelled','completed','duplicate','ineligible','removed','test']);await db.close();
});
