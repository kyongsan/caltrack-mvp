import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError, db } from './server';
import { dayBounds, shiftDay, tokyoDate } from './balance';

export const googleHealthOrigin = () => process.env.CALTRACK_ORIGIN || 'https://caltrack-mvp-haaanco.vercel.app';
export const googleHealthCallback = () => googleHealthOrigin() + '/api/google-health/callback';
export const googleHealthConfigured = () => Boolean(process.env.GOOGLE_HEALTH_CLIENT_ID && process.env.GOOGLE_HEALTH_CLIENT_SECRET && process.env.GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY);
export const healthScope='https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly';
export const flowCookie = '__Host-caltrack-google-health';
function encryptionKey(){
  const value=process.env.GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY || '';
  const key=Buffer.from(value,'base64');
  if(key.length!==32)throw new ApiError(503,'Google Health連携の接続設定が未完了です');
  return key;
}
export function seal(value:unknown){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
  cipher.setAAD(Buffer.from('caltrack-google-health-v1'));
  return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
export function unseal(value:string):unknown{
  const raw=Buffer.from(value,'base64url');if(raw.length<29)throw new Error('Invalid encrypted connection');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),raw.subarray(0,12));
  decipher.setAAD(Buffer.from('caltrack-google-health-v1'));decipher.setAuthTag(raw.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12,-16)),decipher.final()]).toString());
}
export function matchesState(actual:string,expected:string){const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
export const tokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),expires_in:z.number().positive().max(31536000),scope:z.string().optional()});
export async function exchangeToken(params:Record<string,string>){
  if(!googleHealthConfigured())throw new ApiError(503,'Google Health連携の接続設定が未完了です');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:process.env.GOOGLE_HEALTH_CLIENT_ID!,client_secret:process.env.GOOGLE_HEALTH_CLIENT_SECRET!}),signal:AbortSignal.timeout(20000),redirect:'error',cache:'no-store'});
  if(!response.ok)throw new ApiError(502,'Google Healthとの認証に失敗しました。もう一度接続してください');
  const tokens=tokenSchema.parse(await response.json());if(tokens.scope&&!tokens.scope.split(' ').includes(healthScope))throw new ApiError(403,'体重データの共有を許可してください');return tokens;
}
export function newAuthorization(userId:string,authId:string){
  if(!googleHealthConfigured())throw new ApiError(503,'Google Health連携の接続設定が未完了です');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({response_type:'code',client_id:process.env.GOOGLE_HEALTH_CLIENT_ID!,redirect_uri:googleHealthCallback(),scope:healthScope,access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
  return {url:url.toString(),cookie:seal({userId,authId,state,verifier,expires:Date.now()+1800000})};
}
export const flowSchema=z.object({userId:z.string().uuid(),authId:z.string().uuid(),state:z.string().min(20),verifier:z.string().min(43),expires:z.number()});
const sample=z.object({physicalTime:z.string().datetime({offset:true})});
const point=z.object({name:z.string().regex(/^users\/[^/]+\/dataTypes\/(weight|body-fat)\/dataPoints\/[^/]+$/),dataSource:z.object({platform:z.string().optional(),device:z.record(z.unknown()).optional(),application:z.record(z.unknown()).optional()}).optional(),weight:z.object({sampleTime:sample,weightGrams:z.number().finite()}).optional(),bodyFat:z.object({sampleTime:sample,percentage:z.number().finite()}).optional()});
type Point=z.infer<typeof point>;
function stable(value:unknown):string{if(Array.isArray(value))return JSON.stringify(value.map(stable));if(value&&typeof value==='object')return JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));return JSON.stringify(value);}
function sampleKey(p:Point,time:string){return Date.parse(time)+':'+stable(p.dataSource||{});}
export function measurementId(userId:string,name:string){const hex=createHash('sha256').update(`google-health:${userId}:${name}`).digest('hex').slice(0,32).split('');hex[12]='5';hex[16]='8';return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;}
async function fetchPoints(type:'weight'|'body-fat',accessToken:string){
  const points=new Map<string,Point>(),seen=new Set<string>();let next:string|undefined;const started=Date.now();
  for(let page=0;page<40;page++){
    if(Date.now()-started>40000)throw new ApiError(502,'Google Healthの履歴取得に時間がかかっています。後でもう一度お試しください');
    const url=new URL(`https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints`);url.search=new URLSearchParams({pageSize:'10000',dataSourceFamily:'users/me/dataSourceFamilies/all-sources',...(next?{pageToken:next}:{})}).toString();
    const response=await fetch(url,{headers:{Authorization:'Bearer '+accessToken},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new ApiError(502,response.status===401?'Google Healthへの再接続が必要です':response.status===403?'Google HealthのAPI設定・共有権限を確認してください':response.status===429?'Google Healthが混み合っています。時間をおいて再同期してください':'Google Healthのデータを取得できませんでした');
    const body=z.object({dataPoints:z.array(point).optional().default([]),nextPageToken:z.string().optional()}).parse(await response.json());
    for(const p of body.dataPoints){if(!p.name.includes(`/dataTypes/${type}/`))throw new Error('Unexpected data type');points.set(p.name,p);}
    if(!body.nextPageToken)return [...points.values()];if(seen.has(body.nextPageToken))throw new Error('Repeated pagination token');seen.add(body.nextPageToken);next=body.nextPageToken;
  }
  throw new ApiError(502,'Google Healthの履歴が多いため取得を完了できませんでした');
}
export async function fetchWeights(accessToken:string,userId:string){
  const [weights,fats]=await Promise.all([fetchPoints('weight',accessToken),fetchPoints('body-fat',accessToken)]);
  const fatBySample=new Map<string,number>();
  for(const p of fats){const f=p.bodyFat;if(f&&f.percentage>=0&&f.percentage<=80)fatBySample.set(sampleKey(p,f.sampleTime.physicalTime),f.percentage);}
  return weights.flatMap(p=>{const w=p.weight;if(!w)return [];const kg=w.weightGrams/1000,time=w.sampleTime.physicalTime;if(kg<20||kg>400||Date.parse(time)>Date.now()+300000)return [];
    return [{user_id:userId,request_id:measurementId(userId,p.name),measured_at:new Date(time).toISOString(),weight_kg:Math.round(kg*1000)/1000,body_fat_pct:fatBySample.get(sampleKey(p,time))??null,source:'google_health'}];
  }).sort((a,b)=>a.measured_at.localeCompare(b.measured_at));
}
const storedTokens=z.object({access_token:z.string(),refresh_token:z.string()});
export async function syncGoogleHealth(userId:string,force=false){
  const supabase=db(),existing=await supabase.from('google_health_connections').select('last_synced_at').eq('user_id',userId).maybeSingle();
  if(existing.error)throw existing.error;if(!existing.data)return {connected:false,imported:0};
  if(!force&&existing.data.last_synced_at&&Date.now()-Date.parse(existing.data.last_synced_at)<12*3600000)return {connected:true,imported:0,cached:true};
  const lock=randomBytes(16).toString('hex'),now=new Date().toISOString();
  const acquired=await supabase.from('google_health_connections').update({lock_id:lock,lock_until:new Date(Date.now()+180000).toISOString()}).eq('user_id',userId).or(`lock_until.is.null,lock_until.lt.${now}`).select('*').maybeSingle();
  if(acquired.error)throw acquired.error;if(!acquired.data)throw new ApiError(409,'Google Healthを同期中です。少し待ってからお試しください');
  try{
    const row=acquired.data;let tokens=storedTokens.parse(unseal(row.encrypted_tokens));
    if(Date.parse(row.expires_at)<Date.now()+60000){const refreshed=await exchangeToken({grant_type:'refresh_token',refresh_token:tokens.refresh_token});tokens={access_token:refreshed.access_token,refresh_token:refreshed.refresh_token||tokens.refresh_token};
      const saved=await supabase.from('google_health_connections').update({encrypted_tokens:seal(tokens),expires_at:new Date(Date.now()+refreshed.expires_in*1000).toISOString()}).eq('user_id',userId).eq('lock_id',lock).select('user_id').maybeSingle();if(saved.error||!saved.data)throw new ApiError(409,'Google Healthとの接続が変更されました');}
    const rows=await fetchWeights(tokens.access_token,userId);
    const lease=await supabase.from('google_health_connections').select('user_id').eq('user_id',userId).eq('lock_id',lock).maybeSingle();if(lease.error||!lease.data)throw new ApiError(409,'Google Healthとの接続が変更されました');
    for(let i=0;i<rows.length;i+=500){const saved=await supabase.from('weights').upsert(rows.slice(i,i+500),{onConflict:'user_id,request_id'});if(saved.error)throw saved.error;}
    const saved=await supabase.from('google_health_connections').update({last_synced_at:new Date().toISOString(),last_error:null}).eq('user_id',userId).eq('lock_id',lock);if(saved.error)throw saved.error;return {connected:true,imported:rows.length};
  }catch(error){await supabase.from('google_health_connections').update({last_error:'同期できませんでした。再接続または再同期してください。'}).eq('user_id',userId).eq('lock_id',lock);throw error;}
  finally{await supabase.from('google_health_connections').update({lock_id:null,lock_until:null}).eq('user_id',userId).eq('lock_id',lock);}
}
