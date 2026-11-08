import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, db, failure, json, requireUser } from '@/lib/server';
import { exchangeToken, flowCookie, flowSchema, matchesState, newAuthorization, withingsCallback, withingsConfigured, withingsOrigin, seal, syncWithings, unseal } from '@/lib/withings';
export const dynamic='force-dynamic';
export const maxDuration=60;
type Context={params:Promise<{action:string}>};
function returned(status:string){
  const response=NextResponse.redirect(withingsOrigin()+'/integrations/withings?result='+status,303);
  response.cookies.set(flowCookie,'',{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:0});
  response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
}
export async function GET(req:Request,context:Context){
  const {action}=await context.params;
  if(action==='callback'){
    try{
      const query=new URL(req.url).searchParams;
      const cookie=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(flowCookie+'='))?.slice(flowCookie.length+1);
      if(!cookie)throw new Error('Missing authorization session');
      const flow=flowSchema.parse(unseal(cookie));
      if(flow.expires<Date.now()||!matchesState(query.get('state')||'',flow.state))throw new Error('Invalid authorization session');
      if(query.has('error'))return returned('denied');
      const code=query.get('code');if(!code)throw new Error('Missing code');
      const supabase=db();const owner=await supabase.from('users').select('id').eq('id',flow.userId).eq('auth_user_id',flow.authId).maybeSingle();if(owner.error||!owner.data)throw new Error('Account unavailable');
      const tokens=await exchangeToken({grant_type:'authorization_code',code,redirect_uri:withingsCallback()});
      const saved=await supabase.from('withings_connections').upsert({user_id:flow.userId,encrypted_tokens:seal({access_token:tokens.access_token,refresh_token:tokens.refresh_token,userid:tokens.userid}),expires_at:new Date(Date.now()+tokens.expires_in*1000).toISOString(),last_synced_at:null,sync_cursor:0,last_error:null,lock_id:null,lock_until:null},{onConflict:'user_id'});
      if(saved.error)throw saved.error;
      return returned('connected');
    }catch{return returned('failed');}
  }
  try{
    if(action!=='status')throw new ApiError(404,'見つかりません');
    const {supabase,user}=await requireUser(req);
    const result=await supabase.from('withings_connections').select('last_synced_at,last_error').eq('user_id',user.id).maybeSingle();if(result.error)throw result.error;
    return json({configured:withingsConfigured(),connected:!!result.data,lastSyncedAt:result.data?.last_synced_at||null,lastError:result.data?.last_error||null});
  }catch(error){return failure(error);}
}
export async function POST(req:Request,context:Context){
  try{
    const {action}=await context.params;const {supabase,user}=await requireUser(req);
    if(action==='connect'){
      const authorization=newAuthorization(user.id,user.auth_user_id);
      const response=json({url:authorization.url});response.cookies.set(flowCookie,authorization.cookie,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:1800});return response;
    }
    if(action==='sync'){
      const raw=await req.text();const body=raw?z.object({force:z.boolean().optional()}).parse(JSON.parse(raw)):{};
      return json(await syncWithings(user.id,body.force));
    }
    if(action==='disconnect'){
      const removed=await supabase.from('withings_connections').delete().eq('user_id',user.id);if(removed.error)throw removed.error;
      return json({ok:true});
    }
    throw new ApiError(404,'見つかりません');
  }catch(error){return failure(error);}
}
