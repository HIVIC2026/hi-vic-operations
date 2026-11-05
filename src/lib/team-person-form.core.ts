import { z } from 'zod';
export const teamPersonSchema = z.object({
  businessId:z.string().uuid(),workerId:z.string().uuid().nullable(),name:z.string().trim().min(2).max(120),role:z.enum(['office','lead','crew','electrician']),
  mobile:z.string().trim().max(30),email:z.string().trim().max(200).nullable(),dateOfBirth:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),licenceNumber:z.string().trim().max(60).nullable(),recNumber:z.string().trim().max(60).nullable(),
  certificateNumber:z.string().trim().max(100).nullable(),certificatePath:z.string().max(500).nullable(),
});
export type TeamPersonInput=z.infer<typeof teamPersonSchema>;
export function teamCertificatePath(businessId:string,path:string) { return new RegExp(`^team-certificates/${businessId}/[0-9a-f-]+\\.(jpg|png)$`).test(path); }