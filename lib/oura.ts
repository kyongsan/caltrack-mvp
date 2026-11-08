import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError, db } from './server';
import { dayBounds, shiftDay, tokyoDate } from './balance';

export const ouraOrigin = () => process.env.CALTRACK_ORIGIN || 'https://caltrack-mvp-haaanco.vercel.app';
export const ouraCallback = () => ouraOrigin() + '/api/oura/callback';
export const ouraConfigured = () => Boolean(process.env.OURA_CLIENT_ID && process.env.OURA_CLIENT_SECRET && process.env.OURA_TOKEN_ENCRYPTION_KEY);
export const flowCookie = '__Host-caltrack-oura';
function encryptionKey(){
  const value=process.env.OURA_TOKEN_ENCRYPTION_KEY || '';
  const key=Buffer.from(value,'base64');
  if(key.length!==32)throw new ApiError(503,'Oura連携の接続設定が未完了です');
  return key;
}
export function seal(value:unknown){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
  cipher.setAAD(Buffer.from('caltrack-oura-v1'));
  return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
export function unseal(value:string):unknown{
  const raw=Buffer.from(value,'base64url');if(raw.length<29)throw new Error('Invalid encrypted connection');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),raw.subarray(0,12));
  decipher.setAAD(Buffer.from('caltrack-oura-v1'));decipher.setAuthTag(raw.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12,-16)),decipher.final()]).toString());
}
export function matchesState(actual:string,expected:string){const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
export const tokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1),expires_in:z.number().positive().max(31536000),scope:z.string().optional()});
export async function exchangeToken(params:Record<string,string>){
  if(!ouraConfigured())throw new ApiError(503,'Oura連携の接続設定が未完了です');
  const response=await fetch('https://api.ouraring.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:process.env.OURA_CLIENT_ID!,client_secret:process.env.OURA_CLIENT_SECRET!}),signal:AbortSignal.timeout(20000),redirect:'error',cache:'no-store'});
  if(!response.ok)throw new ApiError(502,'Ouraとの認証に失敗しました。もう一度接続してください');
  return tokenSchema.parse(await response.json());
}
export function newAuthorization(userId:string,authId:string){
  if(!ouraConfigured())throw new ApiError(503,'Oura連携の接続設定が未完了です');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
  const url=new URL('https://cloud.ouraring.com/oauth/authorize');
  url.search=new URLSearchParams({response_type:'code',client_id:process.env.OURA_CLIENT_ID!,redirect_uri:ouraCallback(),scope:'daily',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
  return {url:url.toString(),cookie:seal({userId,authId,state,verifier,expires:Date.now()+600000})};
}
export const flowSchema=z.object({userId:z.string().uuid(),authId:z.string().uuid(),state:z.string().min(20),verifier:z.string().min(43),expires:z.number()});
const activitySchema=z.object({data:z.array(z.object({day:z.string(),total_calories:z.number().finite().nonnegative().max(20000)})),next_token:z.string().nullable().optional()});
export function energyId(userId:string,day:string){
  const hex=createHash('sha256').update(`oura:energy:${userId}:${day}`).digest('hex').slice(0,32).split('');hex[12]='5';hex[16]='8';
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
}
export async function fetchEnergy(accessToken:string,userId:string,now=new Date()){
  const today=tokyoDate(now),start=shiftDay(today,-30),end=shiftDay(today,-1),rows=new Map<string,Record<string,unknown>>();
  let next:string|undefined;
  for(let page=0;page<10;page++){
    const url=new URL('https://api.ouraring.com/v2/usercollection/daily_activity');url.search=new URLSearchParams({start_date:start,end_date:end,...(next?{next_token:next}:{})}).toString();
    const response=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new ApiError(response.status===401?401:502,response.status===401?'Ouraへの再接続が必要です':'Ouraのデータを取得できませんでした。後でもう一度お試しください');
    const result=activitySchema.parse(await response.json());
    for(const item of result.data){dayBounds(item.day);if(item.day<start||item.day>end||item.total_calories===0)continue;rows.set(item.day,{user_id:userId,request_id:energyId(userId,item.day),date:item.day,value_kcal:Math.round(item.total_calories),value_type:'total',source:'oura',is_estimated:true});}
    if(!result.next_token)return [...rows.values()];next=result.next_token;
  }
  throw new ApiError(502,'Ouraのデータが多いため取得を完了できませんでした');
}
const storedTokens=z.object({access_token:z.string(),refresh_token:z.string()});
export async function syncOura(userId:string,force=false){
  const supabase=db();
  const existing=await supabase.from('oura_connections').select('last_synced_at').eq('user_id',userId).maybeSingle();
  if(existing.error)throw existing.error;
  if(!existing.data)return {connected:false,imported:0};
  if(!force&&existing.data.last_synced_at&&Date.now()-Date.parse(existing.data.last_synced_at)<12*3600000)return {connected:true,imported:0,cached:true};
  const now=new Date().toISOString(),lock=randomBytes(16).toString('hex');
  const acquired=await supabase.from('oura_connections').update({lock_id:lock,lock_until:new Date(Date.now()+120000).toISOString()}).eq('user_id',userId).or(`lock_until.is.null,lock_until.lt.${now}`).select('*').maybeSingle();
  if(acquired.error)throw acquired.error;if(!acquired.data)throw new ApiError(409,'Ouraを同期中です。少し待ってからお試しください');
  try{
    const row=acquired.data;let tokens=storedTokens.parse(unseal(row.encrypted_tokens));
    if(Date.parse(row.expires_at)<Date.now()+60000){
      const refreshed=await exchangeToken({grant_type:'refresh_token',refresh_token:tokens.refresh_token});
      tokens={access_token:refreshed.access_token,refresh_token:refreshed.refresh_token};
      const saved=await supabase.from('oura_connections').update({encrypted_tokens:seal(tokens),expires_at:new Date(Date.now()+refreshed.expires_in*1000).toISOString()}).eq('user_id',userId).eq('lock_id',lock).select('user_id').maybeSingle();
      if(saved.error||!saved.data)throw new ApiError(409,'Ouraとの接続が変更されました。再接続してください');
    }
    const rows=await fetchEnergy(tokens.access_token,userId);
    // Only one daily total is selected by the dashboard. Activity is never added again.
    if(rows.length){const saved=await supabase.from('energy_expenditures').upsert(rows,{onConflict:'user_id,request_id'});if(saved.error)throw saved.error;}
    const saved=await supabase.from('oura_connections').update({last_synced_at:new Date().toISOString(),last_error:null}).eq('user_id',userId).eq('lock_id',lock);if(saved.error)throw saved.error;
    return {connected:true,imported:rows.length};
  }catch(error){await supabase.from('oura_connections').update({last_error:'同期できませんでした。再接続または再同期してください。'}).eq('user_id',userId).eq('lock_id',lock);throw error;}
  finally{await supabase.from('oura_connections').update({lock_id:null,lock_until:null}).eq('user_id',userId).eq('lock_id',lock);}
}
