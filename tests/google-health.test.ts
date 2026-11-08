import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {fetchWeights,newAuthorization,seal,unseal,healthScope,exchangeToken,measurementId} from '../lib/google-health';
import {GET,POST} from '../app/api/google-health/[action]/route';
test('Google Health OAuth uses only readonly health scope, offline PKCE and an encrypted bound flow',()=>{
 process.env.GOOGLE_HEALTH_CLIENT_ID='fixture-client';process.env.GOOGLE_HEALTH_CLIENT_SECRET='fixture-secret';process.env.GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const auth=newAuthorization('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'),url=new URL(auth.url),flow=unseal(auth.cookie) as {state:string;verifier:string};
 assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),healthScope);assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('state'),flow.state);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert(flow.verifier.length>=43);
 const encrypted=seal({refresh_token:'private'}),raw=Buffer.from(encrypted,'base64url');raw[15]^=1;assert.throws(()=>unseal(raw.toString('base64url')));
});
test('Google Health private actions require app auth and callback rejects forged state',async()=>{
 for(const action of ['connect','sync','disconnect'])assert.equal((await POST(new Request('https://example.invalid/api/google-health/'+action,{method:'POST'}),{params:Promise.resolve({action})})).status,401);
 assert.equal((await GET(new Request('https://example.invalid/api/google-health/status'),{params:Promise.resolve({action:'status'})})).status,401);
 const r=await GET(new Request('https://example.invalid/api/google-health/callback?code=invalid&state=forged'),{params:Promise.resolve({action:'callback'})});assert.equal(r.status,303);assert(r.headers.get('location')?.endsWith('result=failed'));
});
test('Google Health paginates and deduplicates weight while matching fat only to the same instant and data source',async(t)=>{
 const time='2026-11-01T01:00:00Z',source={platform:'HEALTH_CONNECT',application:{packageName:'withings'}},w={name:'users/123/dataTypes/weight/dataPoints/1',dataSource:source,weight:{sampleTime:{physicalTime:time},weightGrams:72400}};
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const u=new URL(String(input));assert.equal(u.origin,'https://health.googleapis.com');assert.equal(u.searchParams.get('dataSourceFamily'),'users/me/dataSourceFamilies/all-sources');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer fixture');
  if(u.pathname.includes('body-fat'))return Response.json({dataPoints:[{name:'users/123/dataTypes/body-fat/dataPoints/2',dataSource:source,bodyFat:{sampleTime:{physicalTime:time},percentage:18.2}},{name:'users/123/dataTypes/body-fat/dataPoints/3',dataSource:{platform:'OTHER'},bodyFat:{sampleTime:{physicalTime:time},percentage:40}}]});
  return Response.json(u.searchParams.has('pageToken')?{dataPoints:[w,{...w,name:'users/123/dataTypes/weight/dataPoints/4',weight:{sampleTime:{physicalTime:'2026-11-02T01:00:00Z'},weightGrams:73000}}]}:{dataPoints:[w],nextPageToken:'second'});
 });
 const rows=await fetchWeights('fixture','app-user');assert.equal(rows.length,2);assert.equal(rows[0].weight_kg,72.4);assert.equal(rows[0].body_fat_pct,18.2);assert.equal(rows[1].body_fat_pct,null);assert.notEqual(measurementId('a',w.name),measurementId('b',w.name));
});
test('Google refresh accepts missing replacement refresh token and uses the official token endpoint',async(t)=>{
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{assert.equal(String(input),'https://oauth2.googleapis.com/token');assert.equal(new URLSearchParams(String(init?.body)).get('grant_type'),'refresh_token');return Response.json({access_token:'new',expires_in:3600,scope:healthScope});});
 const tokens=await exchangeToken({grant_type:'refresh_token',refresh_token:'existing'});assert.equal(tokens.refresh_token,undefined);
});
