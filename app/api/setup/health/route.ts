import { requireUser, failure, json } from '@/lib/server';
export const dynamic = 'force-dynamic';
type Check={status:'ok'|'not_configured'|'error';message?:string;workspace_id?:string};
export async function GET(req:Request){
  try{
    const {supabase}=await requireUser(req);
    const [{error},ai,slack]=await Promise.all([
      supabase.from('meals').select('id').limit(1),
      process.env.OPENAI_API_KEY?fetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},cache:'no-store',signal:AbortSignal.timeout(8000)}).then(r=>({status:r.ok?'ok':'error'} as Check)).catch(()=>({status:'error'} as Check)):Promise.resolve({status:'not_configured'} as Check),
      process.env.SLACK_BOT_TOKEN?fetch('https://slack.com/api/auth.test',{method:'POST',headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`},cache:'no-store',signal:AbortSignal.timeout(8000)}).then(r=>r.json()).then(r=>({status:r.ok?'ok':'error',...(r.ok&&r.team_id?{workspace_id:r.team_id}:{})} as Check)).catch(()=>({status:'error'} as Check)):Promise.resolve({status:'not_configured'} as Check),
    ]);
    return json({app:{status:'ok'},supabase:{status:error?'error':'ok'},openai:ai,slack,checked_at:new Date().toISOString()});
  }catch(error){return failure(error);}
}
