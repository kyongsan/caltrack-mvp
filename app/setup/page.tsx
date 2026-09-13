export default function Setup(){
  return <main className="shell">
    <div className="nav"><a href="/">Home</a><a href="/dashboard">Dashboard</a></div>
    <section className="card">
      <h1>Setup</h1>
      <p className="muted">外部サービスの接続状態を確認するページです。</p>
      <p>○ Supabase</p>
      <p>○ OpenAI</p>
      <p>○ Slack</p>
    </section>
    <section className="card">
      <h2>次の順番</h2>
      <p>Supabase → OpenAI → Slack → 実食事でE2Eテスト</p>
    </section>
  </main>
}
