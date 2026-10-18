import {useState} from "react";
import {SyntheticMap} from "./SyntheticMap";
import {CONTRACT_VERSION} from "@gis/contracts";
type Density="compact"|"comfortable"|"touch";
const views=["Карта","Шари","Дані","Історія"] as const;
export function App(){
 const [dark,setDark]=useState(true);
 const [density,setDensity]=useState<Density>("comfortable");
 const [view,setView]=useState<(typeof views)[number]>("Карта");
 return <div className={"app "+(dark?"dark":"light")+" "+density}>
  <header className="topbar">
   <div className="brand"><span className="logo">A</span><div><strong>ANALISE / OSM MAP STUDIO</strong><small>FOUNDATION · SYNTHETIC ONLY · v{CONTRACT_VERSION}</small></div></div>
   <div className="header-actions"><button onClick={()=>setDark(v=>!v)} aria-label="Перемкнути тему">{dark?"Світла тема":"Темна тема"}</button>
    <select value={density} onChange={e=>setDensity(e.target.value as Density)} aria-label="Щільність інтерфейсу">
      <option value="compact">Компактний</option><option value="comfortable">Звичайний</option><option value="touch">Для дотику</option>
    </select></div>
  </header>
  <div className="workspace">
   <aside className="panel"><h2>Проєкти</h2><p className="muted">Серверні проєкти вимкнені до перевірки Foundation Gate 00.</p>
    <h2>Шари</h2><p className="layer">◉ Умовні точки <span>2</span></p></aside>
   <main className="center">
    <nav className="tabs" aria-label="Розділи карти">{views.map(x=><button aria-current={view===x?"page":undefined} key={x} onClick={()=>setView(x)}>{x}</button>)}</nav>
    {view==="Карта"?<SyntheticMap/>:<section className="placeholder"><h2>{view}</h2><p>Функція запланована на GIS Core. Тут немає доступу до реальних даних.</p></section>}
   </main>
   <aside className="panel"><h2>Інспектор</h2><p className="muted">Обери об'єкт після ввімкнення GIS Core.</p>
    <div className="notice"><strong>Без підключення до D1 / R2</strong><p>Тільки тестова карта без серверного імпорту, експорту та публікації.</p></div>
   </aside>
  </div><footer>OSM MAP STUDIO · FOUNDATION PREVIEW · Жодних реальних даних чи мережевих геошарів</footer>
 </div>;
}
