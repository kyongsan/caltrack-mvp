import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST, DELETE } from '../app/api/records/route';
import { POST as analyze } from '../app/api/meals/analyze/route';
import { GET as health } from '../app/api/setup/health/route';
import { requireUser, ApiError } from '../lib/server';
const url='https://caltrack-test.invalid';
const req=(method='GET',body?:unknown,token?:string)=>new Request(`${url}/api/records`,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
test('records, analysis and connection checks reject unauthenticated access',async()=>{
  for(const response of [await GET(req()),await POST(req('POST',{kind:'meal'})),await DELETE(req('DELETE',{id:'not-owned'})),await analyze(req('POST',{text:'ご飯'})),await health(req())])assert.equal(response.status,401);
});
test('invalid or anonymous tokens never reach private profile queries',async(t)=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL=url;process.env.SUPABASE_SERVICE_ROLE_KEY='test-server-key';
  let requests=0;
  t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json({message:'invalid JWT'},{status:401});});
  const response=await GET(req('GET',undefined,'invalid'));
  assert.equal(response.status,401);assert.equal(requests,1);
});
test('a valid unprovisioned account is forbidden even with a forged client user ID',async(t)=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL=url;process.env.SUPABASE_SERVICE_ROLE_KEY='test-server-key';
  const urls:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
    const target=String(input);urls.push(target);
    if(target.includes('/auth/v1/user'))return Response.json({id:'other-auth-user',email:'other@example.invalid',email_confirmed_at:'2026-10-24T00:00:00Z',is_anonymous:false});
    if(target.includes('/rest/v1/users'))return Response.json([]);
    throw new Error('An unprovisioned account reached a private data table');
  });
  const response=await POST(req('POST',{kind:'meal',user_id:'victim'},'other-user-token'));
  assert.equal(response.status,403);assert.ok(urls.some(u=>u.includes('auth_user_id=eq.other-auth-user')));assert.ok(urls.some(u=>u.includes('email=eq.other%40example.invalid')));
});
test('provisioned auth identity selects its own profile rather than any client-supplied ID',async(t)=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL=url;process.env.SUPABASE_SERVICE_ROLE_KEY='test-server-key';
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
    const target=String(input);
    if(target.includes('/auth/v1/user'))return Response.json({id:'owner-auth',email:'owner@example.invalid',email_confirmed_at:'2026-10-24T00:00:00Z',is_anonymous:false});
    assert.ok(target.includes('auth_user_id=eq.owner-auth'));
    return Response.json({id:'owner-profile',auth_user_id:'owner-auth'});
  });
  const {user}=await requireUser(req('POST',{user_id:'someone-else'},'owner-token'));
  assert.equal(user.id,'owner-profile');
});
