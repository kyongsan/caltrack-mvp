import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MEAL_IMAGES, MAX_MEAL_IMAGES_LENGTH, prepareMealPhotos } from '../lib/meal-images';

test('photo preparation limits decoding concurrency, yields during encoding, preserves order and stays within the upload budget',async(t)=>{
  let active=0, peak=0, encodes=0;
  const revoked:string[]=[], widths:number[]=[];
  t.mock.method(URL,'createObjectURL',(file:any)=>{peak=Math.max(peak,++active);return file.name;});
  t.mock.method(URL,'revokeObjectURL',(url:string)=>{active--;revoked.push(url);});
  class FakeImage {
    width=4000;height=3000;onload=()=>{};onerror=()=>{};value='';
    set src(value:string){this.value=value;setTimeout(()=>this.onload(),value==='0.jpg'?8:1);}
  }
  class FakeReader {
    result='';onload=()=>{};
    async readAsDataURL(blob:Blob){this.result='data:image/jpeg;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');this.onload();}
  }
  const globals={Image:FakeImage,FileReader:FakeReader,document:{createElement:()=>{
    let source='';
    const canvas={width:0,height:0,getContext:()=>({fillStyle:'',fillRect(){},drawImage(image:FakeImage){source=image.value;}}),toBlob(callback:(blob:Blob)=>void,type:string,quality:number){encodes++;widths.push(canvas.width);setTimeout(()=>callback(new Blob([quality>.6?'A'.repeat(300000):source],{type})),1);}};
    return canvas;
  }}};
  for(const [key,value] of Object.entries(globals)){
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>{if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});
  }
  const progress:number[]=[];
  const files=Array.from({length:MAX_MEAL_IMAGES},(_,i)=>new File(['fixture'],`${i}.jpg`,{type:'image/jpeg'}));
  const photos=await prepareMealPhotos(files,(completed,total)=>{assert.equal(total,MAX_MEAL_IMAGES);progress.push(completed);});
  assert.equal(peak,2);assert.equal(active,0);assert.equal(revoked.length,MAX_MEAL_IMAGES);
  assert.deepEqual(photos.map(photo=>Buffer.from(photo.split(',')[1],'base64').toString()),files.map(file=>file.name));
  assert.deepEqual(progress,Array.from({length:MAX_MEAL_IMAGES},(_,i)=>i+1));
  assert.ok(photos.reduce((sum,photo)=>sum+photo.length,0)<=MAX_MEAL_IMAGES_LENGTH);
  assert.ok(widths.every(width=>width<=1024));assert.equal(encodes,MAX_MEAL_IMAGES*2);
  await assert.rejects(()=>prepareMealPhotos([...files,files[0]]),/12/);
  await assert.rejects(()=>prepareMealPhotos([new File(['bad'],'bad.txt',{type:'text/plain'})]),/画像ファイル/);
  assert.equal(active,0);
});
