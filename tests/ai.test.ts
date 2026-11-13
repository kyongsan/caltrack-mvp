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
  assert.deepEqual(Object.keys(payload.text.format.schema.properties.items.items.properties),['name','kcal','assumption']);
  assert.equal(payload.text.format.schema.properties.total_kcal,undefined);
  assert.equal(result.protein_g,10);assert.equal(result.fat_g,5);assert.equal(result.carbs_g,50);
});
test('compact AI response preserves nutrition totals and produces the existing app response shape',async(t)=>{
  process.env.OPENAI_API_KEY='test-only-key';
  t.mock.method(globalThis,'fetch',async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({meal_type:'dinner',items:[{name:'鶏胸肉',kcal:220,assumption:'150gとして推定'}],protein_g:40,fat_g:6,carbs_g:0})}]}]}));
  const result=await analyzeMeal(undefined,'鶏胸肉150g');
  assert.equal(result.total_kcal,220);assert.equal(result.protein_g,40);
  assert.equal(result.items[0].amount,null);assert.equal(result.items[0].protein_g,null);
});
test('AI rejects incomplete and empty results instead of saving invented zero calories',async(t)=>{
  process.env.OPENAI_API_KEY='test-only-key';
  t.mock.method(globalThis,'fetch',async()=>Response.json({status:'incomplete',output:[]}));
  await assert.rejects(()=>analyzeMeal(undefined,'食事'),/AI_INCOMPLETE/);
  t.mock.method(globalThis,'fetch',async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({meal_type:'unknown',items:[],total_kcal:0,protein_g:null,fat_g:null,carbs_g:null})}]}]}));
  await assert.rejects(()=>analyzeMeal(undefined,'食事'));
});
test('AI receives every meal photo together with overlap and portion instructions',async(t)=>{
  process.env.OPENAI_API_KEY='test-only-key';let payload:Record<string,any>={};
  t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>{payload=JSON.parse(String(init?.body));return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({meal_type:'lunch',items:[item],total_kcal:117,protein_g:2,fat_g:0,carbs_g:26})}]}]});});
  const images=['data:image/jpeg;base64,AAAA','data:image/png;base64,BBBB','data:image/webp;base64,CCCC'];
  await analyzeMeal(images,'写真1と2は同じ皿。ご飯は半分');
  assert.deepEqual(payload.input[0].content.filter((part:{type:string})=>part.type==='input_image').map((part:{image_url:string})=>part.image_url),images);
  assert.match(payload.input[0].content[0].text,/do not double-count/);
  assert.match(payload.input[0].content[0].text,/写真1と2は同じ皿/);
  assert.equal(payload.store,false);
});
