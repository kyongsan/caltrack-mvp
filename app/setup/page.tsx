'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
type Check={status:string};
export default function Setup(){
  const [state,setState]=useState<Record<string,Check>|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;(async()=>{try{
    const config=await fetch('/api/config').then(r=>r.json());
    if(!config.url||!config.key)throw new Error('ログインの接続設定が未完了です');
    const client=createClient(config.url,config.key);const {data:{session}}=await client.auth.getSession();
    if(!session)throw new Error('ログインすると接続状態を確認できます');
    const response=await fetch('/api/setup/health',{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error);if(active)setState(body);
  }catch(e){if(active)setError(e instanceof Error?e.message:'接続に失敗しました');}})();return()=>{active=false;};},[]);
  return <main className="shell"><header className="header"><a className="brand" href="/dashboard">CalTrack</a><a href="/dashboard">記録に戻る</a></header><section className="card" style={{marginTop:30}}><h1>接続状態</h1>{error?<p role="alert">{error}</p>:!state?<p>確認中…</p>:<dl>{['supabase','openai','slack'].map(key=><div key={key} className="meal-meta"><dt>{{supabase:'データ保存',openai:'カロリー推定',slack:'Slack入力'}[key]}</dt><dd>{({ok:'接続済み',error:'接続エラー',not_configured:'未設定'} as Record<string,string>)[state[key]?.status]||'不明'}</dd></div>)}</dl>}<p className="small muted">カロリー推定が未設定でも、カロリーを直接入力して記録できます。</p></section></main>;
}
