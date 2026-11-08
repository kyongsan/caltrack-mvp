import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError, db } from './server';

export const withingsOrigin=()=>process.env.CALTRACK_ORIGIN||'https://caltrack-mvp-haaanco.vercel.app';
export const withingsCallback=()=>withingsOrigin()+'/api/withings/callback';
export const withingsConfigured=()=>Boolean(process.env.WITHINGS_CLIENT_ID&&process.env.WITHINGS_CLIENT_SECRET&&process.env.WITHINGS_TOKEN_ENCRYPTION_KEY);
export const flowCookie='__Host-caltrack-withings';
function encryptionKey(){const key=Buffer.from(process.env.WITHINGS_TOKEN_ENCRYPTION_KEY||'','base64');if(key.length!==32)throw new ApiError(503,'Withings連携の接続設定が未完了です');return key;}
export function seal(value:unknown){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAAD(Buffer.from('caltrack-withings-v1'));
  return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
export function unseal(value:string):unknown{
  const raw=Buffer.from(value,'base64url');if(raw.length<29)throw new Error('Invalid connection');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),raw.subarray(0,12));decipher.setAAD(Buffer.from('caltrack-withings-v1'));decipher.setAuthTag(raw.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12,-16)),decipher.final()]).toString());
}
export function matchesState(actual:string,expected:string){const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
export const flowSchema=z.object({userId:z.string().uuid(),authId:z.string().uuid(),state:z.string().min(20),expires:z.number()});
export function newAuthorization(userId:string,authId:string){
  if(!withingsConfigured())throw new ApiError(503,'Withings連携の接続設定が未完了です');
  const state=randomBytes(32).toString('base64url'),url=new URL('https://account.withings.com/oauth2_user/authorize2');
  url.search=new URLSearchParams({response_type:'code',client_id:process.env.WITHINGS_CLIENT_ID!,redirect_uri:withingsCallback(),scope:'user.metrics',state}).toString();
  return {url:url.toString(),cookie:seal({userId,authId,state,expires:Date.now()+30*60000})};
}
// Withings signs action, client_id, nonce (or timestamp) in this exact order.
export function signature(action:string,clientId:string,nonceOrTimestamp:string,secret:string){return createHmac('sha256',secret).update([action,clientId,nonceOrTimestamp].join(',')).digest('hex');}
async function request(path:'/v2/signature'|'/v2/oauth2'|'/measure',params:Record<string,string>,accessToken?:string){
  const response=await fetch('https://wbsapi.withings.net'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},body:new URLSearchParams(params),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new ApiError(502,'Withingsに接続できませんでした。後でもう一度お試しください');
  const envelope=z.object({status:z.number().int(),body:z.unknown().optional()}).parse(await response.json());
  if(envelope.status!==0)throw new ApiError(502,[100,101,102,200,401].includes(envelope.status)?'Withingsへの再接続が必要です':'Withingsのデータを取得できませんでした。後でもう一度お試しください');
  return envelope.body;
}
const providerId=z.union([z.number().int().nonnegative().safe().transform(String),z.string().regex(/^\d+$/)]);
export const tokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1),expires_in:z.number().positive().max(31536000),userid:providerId,scope:z.string().optional()});
export async function exchangeToken(params:Record<string,string>){
  if(!withingsConfigured())throw new ApiError(503,'Withings連携の接続設定が未完了です');
  const clientId=process.env.WITHINGS_CLIENT_ID!,secret=process.env.WITHINGS_CLIENT_SECRET!,timestamp=String(Math.floor(Date.now()/1000));
  const {nonce}=z.object({nonce:z.string().min(1)}).parse(await request('/v2/signature',{action:'getnonce',client_id:clientId,timestamp,signature:signature('getnonce',clientId,timestamp,secret)}));
  const tokens=tokenSchema.parse(await request('/v2/oauth2',{...params,action:'requesttoken',client_id:clientId,nonce,signature:signature('requesttoken',clientId,nonce,secret)}));
  if(tokens.scope&&!tokens.scope.split(/[ ,]+/).includes('user.metrics'))throw new ApiError(403,'体重データの共有を許可して再接続してください');
  return tokens;
}
const measureSchema=z.object({type:z.number().int(),value:z.number().finite(),unit:z.number().int().min(-12).max(12)});
const groupSchema=z.object({grpid:providerId,date:z.number().int().positive().max(8640000000000),modified:z.number().int().nonnegative().optional(),category:z.number().int(),measures:z.array(measureSchema)});
const measuresSchema=z.object({measuregrps:z.array(groupSchema),more:z.union([z.number().int().min(0).max(1),z.boolean()]).optional(),offset:z.number().int().nonnegative().optional()});
export function measurementId(userId:string,providerUserId:string,groupId:string){
  const hex=createHash('sha256').update(`withings:weight:${userId}:${providerUserId}:${groupId}`).digest('hex').slice(0,32).split('');hex[12]='5';hex[16]='8';
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
}
export type ImportedWeight={user_id:string;request_id:string;measured_at:string;weight_kg:number;body_fat_pct:number|null;source:'withings'};
export async function fetchWeights(accessToken:string,userId:string,providerUserId:string,cursor=0){
  const rows=new Map<string,ImportedWeight>();let offset:number|undefined,maxModified=cursor;const started=Date.now(),now=Math.floor(started/1000);
  for(let page=0;page<40;page++){
    if(Date.now()-started>40000)throw new ApiError(502,'履歴の取得に時間がかかっています。後でもう一度同期してください');
    const body=measuresSchema.parse(await request('/measure',{action:'getmeas',meastypes:'1,6',category:'1',lastupdate:String(Math.max(0,cursor-1)),...(offset===undefined?{}:{offset:String(offset)})},accessToken));
    for(const group of body.measuregrps){
      if(group.modified!==undefined)maxModified=Math.max(maxModified,Math.min(group.modified,now));
      if(group.category!==1||group.date>now+300)continue;
      const weight=group.measures.find(m=>m.type===1),fat=group.measures.find(m=>m.type===6);
      if(!weight)continue;const kg=weight.value*10**weight.unit,fatPct=fat?fat.value*10**fat.unit:null;
      if(!Number.isFinite(kg)||kg<20||kg>400)continue;
      const id=measurementId(userId,providerUserId,group.grpid);
      rows.set(id,{user_id:userId,request_id:id,measured_at:new Date(group.date*1000).toISOString(),weight_kg:Math.round(kg*1000)/1000,body_fat_pct:fatPct!==null&&Number.isFinite(fatPct)&&fatPct>=0&&fatPct<=80?Math.round(fatPct*1000)/1000:null,source:'withings'});
    }
    if(!body.more)return {rows:[...rows.values()].sort((a,b)=>a.measured_at.localeCompare(b.measured_at)),cursor:maxModified};
    if(body.offset===undefined||body.offset===offset)throw new ApiError(502,'Withingsの履歴を取得できませんでした');offset=body.offset;
  }
  throw new ApiError(502,'Withingsの履歴が多いため取得を完了できませんでした');
}
const storedTokens=z.object({access_token:z.string(),refresh_token:z.string(),userid:providerId});
export async function syncWithings(userId:string,force=false){
  const supabase=db(),existing=await supabase.from('withings_connections').select('last_synced_at').eq('user_id',userId).maybeSingle();
  if(existing.error)throw existing.error;if(!existing.data)return {connected:false,imported:0};
  if(!force&&existing.data.last_synced_at&&Date.now()-Date.parse(existing.data.last_synced_at)<12*3600000)return {connected:true,imported:0,cached:true};
  const lock=randomBytes(16).toString('hex'),now=new Date().toISOString();
  const acquired=await supabase.from('withings_connections').update({lock_id:lock,lock_until:new Date(Date.now()+180000).toISOString()}).eq('user_id',userId).or(`lock_until.is.null,lock_until.lt.${now}`).select('*').maybeSingle();
  if(acquired.error)throw acquired.error;if(!acquired.data)throw new ApiError(409,'Withingsを同期中です。少し待ってからお試しください');
  try{
    const row=acquired.data;let tokens=storedTokens.parse(unseal(row.encrypted_tokens));
    if(Date.parse(row.expires_at)<Date.now()+60000){
      const refreshed=await exchangeToken({grant_type:'refresh_token',refresh_token:tokens.refresh_token});
      if(refreshed.userid!==tokens.userid)throw new ApiError(409,'Withingsの接続アカウントを確認してください');
      tokens={access_token:refreshed.access_token,refresh_token:refreshed.refresh_token,userid:refreshed.userid};
      const saved=await supabase.from('withings_connections').update({encrypted_tokens:seal(tokens),expires_at:new Date(Date.now()+refreshed.expires_in*1000).toISOString()}).eq('user_id',userId).eq('lock_id',lock).select('user_id').maybeSingle();
      if(saved.error||!saved.data)throw new ApiError(409,'Withingsとの接続が変更されました。再接続してください');
    }
    const result=await fetchWeights(tokens.access_token,userId,tokens.userid,Number(row.sync_cursor||0));
    const lease=await supabase.from('withings_connections').select('user_id').eq('user_id',userId).eq('lock_id',lock).maybeSingle();if(lease.error||!lease.data)throw new ApiError(409,'Withingsとの接続が変更されました');
    for(let i=0;i<result.rows.length;i+=500){const saved=await supabase.from('weights').upsert(result.rows.slice(i,i+500),{onConflict:'user_id,request_id'});if(saved.error)throw saved.error;}
    const saved=await supabase.from('withings_connections').update({last_synced_at:new Date().toISOString(),last_error:null,sync_cursor:result.cursor}).eq('user_id',userId).eq('lock_id',lock);if(saved.error)throw saved.error;
    return {connected:true,imported:result.rows.length};
  }catch(error){await supabase.from('withings_connections').update({last_error:'同期できませんでした。再接続または再同期してください。'}).eq('user_id',userId).eq('lock_id',lock);throw error;}
  finally{await supabase.from('withings_connections').update({lock_id:null,lock_until:null}).eq('user_id',userId).eq('lock_id',lock);}
}
