export default function Home(){
  return <main className="shell">
    <div className="nav"><a href="/dashboard">Dashboard</a><a href="/setup">Setup</a></div>
    <section className="card">
      <span className="pill">CalTrack MVP</span>
      <h1>今日のカロリー収支を、迷わず見る。</h1>
      <p className="muted">食事入力 → 収支計算 → 月間目標の進捗確認を、SlackとWebでつなぐ個人用MVPです。</p>
      <p><a href="/dashboard"><b>ダッシュボードを見る →</b></a></p>
    </section>
  </main>
}
