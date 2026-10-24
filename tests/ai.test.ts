import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMeal } from '../lib/meal-ai';
const item={name:'ご飯（半分）',amount:75,unit:'g',kcal:117,protein_g:2,fat_g:0,carbs_g:26,assumption:'通常の半量として推定'};
test('AI uses structured output, does not retain photos, and reconciles item totals',async(t)=>{
  process.env.OPENAI_API_KEY='test-only-key';let payload:Record<string,any>={};
  t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>{payload=JSON.parse(String(init?.body));return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({meal_type:'lunch',items:[item,{...item,name:'スープ',kcal:200}],total_kcal:999,protein_g:10,fat_g:5,carbs_g:50})}]}]});});
  const result=await analyzeMeal('data:image/jpeg;base64,AAAA','ご飯は半分');
  assert.equal(result.total_kcal,317);assert.equal(payload.store,false);assert.equal(payload.text.format.type,'json_schema');assert.equal(payload.text.format.strict,true);
  assert.equal(payload.input[0].content[1].image_url,'data:image/jpeg;base64,AAAA');assert.ok(payload.input[0].content[0].text.includes('ご飯は半分'));
});
test('AI rejects incomplete and empty results instead of saving invented zero calories',async(t)=>{
  process.env.OPENAI_API_KEY='test-only-key';
  t.mock.method(globalThis,'fetch',async()=>Response.json({status:'incomplete',output:[]}));
  await assert.rejects(()=>analyzeMeal(undefined,'食事'),/AI_INCOMPLETE/);
  t.mock.method(globalThis,'fetch',async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({meal_type:'unknown',items:[],total_kcal:0,protein_g:null,fat_g:null,carbs_g:null})}]}]}));
  await assert.rejects(()=>analyzeMeal(undefined,'食事'));
});
