import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokyoDate, dayBounds, shiftDay, summary, csvCell, type Meal } from '../lib/balance';
const meal=(overrides:Partial<Meal>={}):Meal=>({id:'one',eaten_at:'2026-10-23T15:00:00Z',total_kcal:700,protein_g:null,fat_g:null,carbs_g:null,original_text:'夕飯',meal_type:'dinner',source:'web',status:'active',...overrides});
test('Tokyo midnight and half-open day interval include the correct local day',()=>{
  assert.equal(tokyoDate(new Date('2026-10-23T14:59:59.999Z')),'2026-10-23');
  assert.equal(tokyoDate(new Date('2026-10-23T15:00:00Z')),'2026-10-24');
  assert.deepEqual(dayBounds('2026-10-24'),{start:'2026-10-23T15:00:00.000Z',end:'2026-10-24T15:00:00.000Z'});
  assert.throws(()=>dayBounds('2026-02-30'));assert.throws(()=>dayBounds('2026-13-01'));
  assert.equal(shiftDay('2026-03-01',-1),'2026-02-28');
});
test('exclude deleted and out-of-day meals, never double count active energy',()=>{
  const result=summary([meal(),meal({id:'two',total_kcal:300}),meal({status:'deleted'}),meal({eaten_at:'2026-10-24T15:00:00Z'})],
  [{date:'2026-10-24',value_kcal:2400,value_type:'total',is_estimated:false,created_at:'2026-10-24T10:00Z'}, {date:'2026-10-24',value_kcal:2300,value_type:'total',is_estimated:true,created_at:'2026-10-24T09:00Z'}, {date:'2026-10-24',value_kcal:500,value_type:'active',is_estimated:false}], '2026-10-24',2000);
  assert.equal(result.intake,1000);assert.equal(result.balance,-1400);assert.equal(result.remaining,1000);assert.equal(result.mealCount,2);assert.equal(result.isEstimated,false);
});
test('missing expenditure or target stays unknown, and over-budget is preserved',()=>{
  assert.equal(summary([meal()],[],'2026-10-24',null).balance,null);
  assert.equal(summary([meal()],[],'2026-10-24',null).remaining,null);
  assert.equal(summary([meal()],[],'2026-10-24',500).remaining,-200);
  assert.equal(summary([],[],'2026-10-24',null).mealCount,0);
});
test('CSV protects spreadsheet formulas, quotes, commas and line breaks',()=>{
  assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(' \t+1'),'"\' \t+1"');assert.equal(csvCell('a,b\n"c"'),'"a,b\n""c"""');
});
