import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {seal,unseal,newAuthorization,flowSchema,fetchWeights,measurementId,exchangeToken,syncWithings} from '../lib/withings';
import {unseal as unsealOura} from '../lib/oura';
import {GET,POST} from '../app/api/withings/[action]/route';

test('Withings authorization is scoped to metrics and bound to a private expiring app identity',()=>{
 process.env.WITHINGS_TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.WITHINGS_CLIENT_ID='fixture-client';process.env.WITHINGS_CLIENT_SECRET='fixture-secret';
 const auth=newAuthorization('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'),url=new URL(auth.url),flow=flowSchema.parse(unseal(auth.cookie));
 assert.equal(url.origin,'https://account.withings.com');assert.equal(url.searchParams.get('scope'),'user.metrics');assert.equal(url.searchParams.get('state'),flow.state);assert(flow.expires>Date.now());
 const encrypted=seal({access_token:'not-public'});assert(!encrypted.includes('not-public'));const bytes=Buffer.from(encrypted,'base64url');bytes[14]^=1;assert.throws(()=>unseal(bytes.toString('base64url')));
 process.env.OURA_TOKEN_ENCRYPTION_KEY=process.env.WITHINGS_TOKEN_ENCRYPTION_KEY;assert.throws(()=>unsealOura(encrypted));
});
test('Withings rejects unauthenticated actions and forged callbacks without provider calls',async(t)=>{
 const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('must not contact provider');});
 for(const action of ['connect','sync','disconnect'])assert.equal((await POST(new Request('https://example.invalid/api/withings/'+action,{method:'POST'}),{params:Promise.resolve({action})})).status,401);
 assert.equal((await GET(new Request('https://example.invalid/api/withings/status'),{params:Promise.resolve({action:'status'})})).status,401);
 const auth=newAuthorization('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
 const callback=await GET(new Request('https://example.invalid/api/withings/callback?code=invalid&state=forged',{headers:{cookie:'__Host-caltrack-withings='+auth.cookie}}),{params:Promise.resolve({action:'callback'})});
 assert.equal(callback.status,303);assert(callback.headers.get('location')?.endsWith('result=failed'));assert(callback.headers.get('set-cookie')?.includes('Max-Age=0'));assert.equal(fetch.mock.callCount(),0);
});
test('Withings uses separate signed nonce and token requests and unwraps the provider envelope',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=new URL(String(input)).pathname,body=new URLSearchParams(String(init?.body));assert.equal(body.get('client_secret'),null);assert.equal(init?.redirect,'error');calls++;
  if(path==='/v2/signature'){
   assert.equal(body.get('action'),'getnonce');assert.equal(body.get('signature'),createHmac('sha256','fixture-secret').update('getnonce,fixture-client,'+body.get('timestamp')).digest('hex'));
   return Response.json({status:0,body:{nonce:'single-use-nonce'}});
  }
  assert.equal(path,'/v2/oauth2');assert.equal(body.get('nonce'),'single-use-nonce');assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('signature'),createHmac('sha256','fixture-secret').update('requesttoken,fixture-client,single-use-nonce').digest('hex'));
  return Response.json({status:0,body:{access_token:'access',refresh_token:'refresh',expires_in:10800,userid:1234,scope:'user.metrics'}});
 });
 const tokens=await exchangeToken({grant_type:'authorization_code',code:'fixture-code',redirect_uri:'https://example.invalid/callback'});assert.equal(tokens.userid,'1234');assert.equal(calls,2);
});
test('Withings converts units, keeps exact measurement times, deduplicates groups and excludes objectives',async(t)=>{
 let calls=0;const date=Math.floor(Date.now()/1000)-3600;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  assert.equal(String(input),'https://wbsapi.withings.net/measure');const body=new URLSearchParams(String(init?.body));assert.equal(body.get('meastypes'),'1,6');assert.equal(body.get('lastupdate'),'99');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer fixture-token');calls++;
  const g={grpid:10,date,modified:120,category:1,measures:[{type:1,value:72400,unit:-3},{type:6,value:1820,unit:-2}]};
  return Response.json({status:0,body:calls===1?{measuregrps:[g,{...g,grpid:11,category:2},{...g,grpid:12,measures:[{type:6,value:1820,unit:-2}]}],more:1,offset:25}:{measuregrps:[{...g,measures:[{type:1,value:72350,unit:-3},{type:6,value:1820,unit:-2}]},{...g,grpid:13,measures:[{type:1,value:73,unit:0}]}],more:0}});
 });
 const result=await fetchWeights('fixture-token','app-user','provider-user',100);assert.equal(calls,2);assert.equal(result.rows.length,2);assert.equal(result.rows[0].weight_kg,72.35);assert.equal(result.rows[0].body_fat_pct,18.2);assert.equal(result.rows[0].measured_at,new Date(date*1000).toISOString());assert.equal(result.rows[1].body_fat_pct,null);assert.equal(result.cursor,120);
 assert.notEqual(measurementId('a','p','10'),measurementId('b','p','10'));assert.notEqual(measurementId('a','p','10'),measurementId('a','q','10'));
});
test('Withings treats an HTTP-200 API error and a stuck pagination cursor as failures',async(t)=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json({status:401,error:'provider secret details'}));await assert.rejects(fetchWeights('token','user','123'),/再接続/);
 fetch.mock.mockImplementation(async()=>Response.json({status:0,body:{measuregrps:[],more:1,offset:5}}));await assert.rejects(fetchWeights('token','user','123'),/履歴/);
});
test('Withings persists rotated encrypted tokens before fetching data and scopes every database write',async(t)=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://db.example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-service-role';
 const user='11111111-1111-4111-8111-111111111111';let rotated=false,weightsSaved=false,released=false,cursorSaved=false;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)),method=init?.method||'GET';
  if(url.host==='wbsapi.withings.net'){
   if(url.pathname==='/v2/signature')return Response.json({status:0,body:{nonce:'fixture-nonce'}});
   if(url.pathname==='/v2/oauth2')return Response.json({status:0,body:{access_token:'rotated-access',refresh_token:'rotated-refresh',userid:123,expires_in:10800}});
   assert(rotated,'new refresh token must be saved before using new access token');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer rotated-access');
   return Response.json({status:0,body:{measuregrps:[{grpid:10,date:1700000000,modified:1700000100,category:1,measures:[{type:1,value:72400,unit:-3}]}],more:0}});
  }
  if(url.pathname==='/rest/v1/weights'){
   const rows=JSON.parse(String(init?.body));assert.equal(rows.length,1);assert.equal(rows[0].user_id,user);assert.equal(rows[0].source,'withings');assert.equal(url.searchParams.get('on_conflict'),'user_id,request_id');weightsSaved=true;return Response.json([],{status:201});
  }
  assert.equal(url.searchParams.get('user_id'),'eq.'+user);
  if(method==='GET')return Response.json(url.searchParams.get('select')==='last_synced_at'?[{last_synced_at:null}]:[{user_id:user}]);
  const body=JSON.parse(String(init?.body));
  if(body.lock_id&&body.lock_until)return Response.json([{encrypted_tokens:seal({access_token:'expired-access',refresh_token:'old-refresh',userid:'123'}),expires_at:'2000-01-01T00:00:00Z',sync_cursor:0}]);
  assert(url.searchParams.get('lock_id')?.startsWith('eq.'));
  if(body.encrypted_tokens){const saved=unseal(body.encrypted_tokens) as {refresh_token:string};assert.equal(saved.refresh_token,'rotated-refresh');rotated=true;return Response.json([{user_id:user}]);}
  if(body.sync_cursor){assert(weightsSaved);cursorSaved=true;}
  if(body.lock_id===null)released=true;
  return Response.json([]);
 });
 const result=await syncWithings(user,true);assert.equal(result.imported,1);assert(rotated&&weightsSaved&&cursorSaved&&released);
});
