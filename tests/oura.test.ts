import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {seal,unseal,matchesState,newAuthorization,fetchEnergy,energyId} from '../lib/oura';
import {summary} from '../lib/balance';
import {GET,POST} from '../app/api/oura/[action]/route';
test('Oura tokens and browser flow are authenticated encryption; tampering fails',()=>{
 process.env.OURA_TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const value={access_token:'secret-token',refresh_token:'secret-refresh'};const encrypted=seal(value);assert(!encrypted.includes('secret-token'));assert.deepEqual(unseal(encrypted),value);
 const bytes=Buffer.from(encrypted,'base64url');bytes[15]^=1;assert.throws(()=>unseal(bytes.toString('base64url')));
 assert(matchesState('a'.repeat(43),'a'.repeat(43)));assert(!matchesState('a','ab'));assert(!matchesState('a','b'));
});
test('Oura consent requests daily data only, with PKCE and a bound expiring user',()=>{
 process.env.OURA_CLIENT_ID='test-id';process.env.OURA_CLIENT_SECRET='test-secret';
 const auth=newAuthorization('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
 const url=new URL(auth.url),flow=unseal(auth.cookie) as {userId:string;state:string;verifier:string;expires:number};
 assert.equal(url.origin,'https://cloud.ouraring.com');assert.equal(url.searchParams.get('scope'),'daily');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('state'),flow.state);assert(flow.verifier.length>=43);assert(flow.expires>Date.now());assert(flow.expires<=Date.now()+600000);
});
test('Oura API and callback reject missing app authorization and invalid state',async()=>{
 for(const action of ['connect','sync','disconnect']){
  const res=await POST(new Request('https://example.invalid/api/oura/'+action,{method:'POST'}),{params:Promise.resolve({action})});assert.equal(res.status,401);
 }
 const status=await GET(new Request('https://example.invalid/api/oura/status'),{params:Promise.resolve({action:'status'})});assert.equal(status.status,401);
 const callback=await GET(new Request('https://example.invalid/api/oura/callback?state=forged&code=invalid'),{params:Promise.resolve({action:'callback'})});assert.equal(callback.status,303);assert(callback.headers.get('location')?.endsWith('result=failed'));assert(callback.headers.get('set-cookie')?.includes('Max-Age=0'));
});
test('daily sync uses total calories, deduplicates pages, excludes today and zero placeholders',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async(input:RequestInfo | URL,init?:RequestInit)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://api.ouraring.com');assert.equal(url.pathname,'/v2/usercollection/daily_activity');assert.equal(url.searchParams.get('end_date'),'2026-11-07');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer fixture-token');calls++;
  return Response.json(calls===1?{data:[{day:'2026-11-07',total_calories:2400},{day:'2026-11-08',total_calories:123},{day:'2026-11-06',total_calories:0}],next_token:'page2'}:{data:[{day:'2026-11-07',total_calories:2500}],next_token:null});
 });
 const rows=await fetchEnergy('fixture-token','11111111-1111-4111-8111-111111111111',new Date('2026-11-08T03:00:00Z'));assert.equal(rows.length,1);assert.equal(rows[0].value_kcal,2500);assert.equal(rows[0].source,'oura');assert.equal(rows[0].value_type,'total');assert.equal(rows[0].is_estimated,true);assert.equal(calls,2);
 assert.equal(energyId('owner','2026-11-07'),energyId('owner','2026-11-07'));assert.notEqual(energyId('owner','2026-11-07'),energyId('other-owner','2026-11-07'));
});
test('manual energy overrides imported Oura total without adding active energy',()=>{
 const common={date:'2026-11-07',value_type:'total',is_estimated:false};
 assert.equal(summary([],[{...common,source:'oura',value_kcal:2600,created_at:'2026-11-09'},{...common,source:'web',value_kcal:2200,created_at:'2026-11-07'},{...common,value_type:'active',value_kcal:800}],common.date,null).expenditure,2200);
 assert.equal(summary([],[{...common,source:'oura',value_kcal:2600},{...common,value_type:'active',value_kcal:800}],common.date,null).expenditure,2600);
});
