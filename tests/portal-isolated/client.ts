import { currentUser } from './guards';
export const supabase = {
 auth: { getUser: currentUser, signOut: async () => ({ error: null }) },
 rpc: async (name: string) => { if(name === 'my_job_role') return { data: 'installer', error: null }; throw new Error('Unmocked database RPC: '+name); },
 from: (name: string) => { throw new Error('Unmocked database table: '+name); },
 storage: { from: () => ({ uploadToSignedUrl: async () => ({error:null}) }) },
};