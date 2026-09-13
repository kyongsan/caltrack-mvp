export default function Dashboard(){
  return <main className="shell">
    <div className="nav"><a href="/">Home</a><a href="/setup">Setup</a></div>
    <p className="muted">2026年9月13日</p>
    <section className="card">
      <div className="muted">今日のカロリー収支</div>
      <div className="big">−320 kcal</div>
      <div className="grid"><div><div className="muted">摂取</div><b>1,780 kcal</b></div><div><div className="muted">現在までの消費</div><b>2,100 kcal</b></div></div>
    </section>
    <section className="card">
      <div className="muted">今日あと食べられる目安</div>
      <div className="big">220 kcal</div>
      <p className="muted">予測総消費 2,400 kcal / 今日の目標 −400 kcal</p>
    </section>
    <section className="card"><h2>9月の進捗</h2><p><b>−0.6 kg / −1.5 kg</b></p><div className="bar"><div /></div><p className="muted">体重進捗 40%　｜　日数進捗 43%</p></section>
    <section className="card"><h2>次の接続</h2><p>Supabase・OpenAI・Slackを接続すると、ここが実データに切り替わります。</p></section>
  </main>
}
