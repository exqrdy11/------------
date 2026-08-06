"use client";

import { useMemo, useState } from "react";

type StockRow = {
  sku: string;
  name: string;
  category: string;
  color: string;
  warehouses: Record<string, number>;
  fbs: number;
  receiving: number;
  toSale: number;
  status: "В норме" | "Мало" | "Заканчивается";
  updated: string;
};

const rows: StockRow[] = [
  { sku: "LMP-1042", name: "Лампа настольная Line", category: "Освещение", color: "#ffb45c", warehouses: { "Основной": 142, "Север": 38, "Юг": 24 }, fbs: 32, receiving: 18, toSale: 14, status: "В норме", updated: "10:42" },
  { sku: "VZA-2081", name: "Ваза керамическая Aura", category: "Декор", color: "#8ea6ff", warehouses: { "Основной": 54, "Север": 12, "Юг": 8 }, fbs: 24, receiving: 24, toSale: 0, status: "В норме", updated: "10:39" },
  { sku: "PLD-3105", name: "Плед фактурный Cloud", category: "Текстиль", color: "#d7a6cc", warehouses: { "Основной": 18, "Север": 4, "Юг": 2 }, fbs: 16, receiving: 8, toSale: 8, status: "Мало", updated: "10:35" },
  { sku: "ORG-4018", name: "Органайзер модульный", category: "Хранение", color: "#94c5a6", warehouses: { "Основной": 236, "Север": 61, "Юг": 44 }, fbs: 48, receiving: 30, toSale: 18, status: "В норме", updated: "10:31" },
  { sku: "SVR-5207", name: "Свеча ароматическая Santal", category: "Ароматы", color: "#eaa070", warehouses: { "Основной": 9, "Север": 2, "Юг": 0 }, fbs: 6, receiving: 0, toSale: 6, status: "Заканчивается", updated: "10:26" },
  { sku: "PDS-6024", name: "Подставка для книг Arc", category: "Декор", color: "#79b9bd", warehouses: { "Основной": 76, "Север": 19, "Юг": 14 }, fbs: 22, receiving: 12, toSale: 10, status: "В норме", updated: "10:21" },
  { sku: "KSH-7102", name: "Кашпо бетонное Forma", category: "Декор", color: "#adb1b8", warehouses: { "Основной": 22, "Север": 6, "Юг": 3 }, fbs: 10, receiving: 4, toSale: 6, status: "Мало", updated: "10:18" },
  { sku: "POL-8043", name: "Полка настенная Mono", category: "Хранение", color: "#d0ad82", warehouses: { "Основной": 4, "Север": 0, "Юг": 1 }, fbs: 0, receiving: 0, toSale: 0, status: "Заканчивается", updated: "10:12" },
];

const warehouseOptions = ["Все склады", "Основной", "Север", "Юг"];

export default function Home() {
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("Все склады");
  const [filter, setFilter] = useState("Все");
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [lastSync, setLastSync] = useState("сегодня, 10:42");
  const [syncing, setSyncing] = useState(false);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term);
      const matchesFilter = filter === "Все" || (filter === "Дефицит" && row.status !== "В норме") || (filter === "В пути" && row.fbs > 0);
      const matchesWarehouse = warehouse === "Все склады" || row.warehouses[warehouse] > 0;
      return matchesQuery && matchesFilter && matchesWarehouse;
    });
  }, [query, filter, warehouse]);

  const syncData = () => {
    setSyncing(true);
    window.setTimeout(() => {
      setLastSync("только что");
      setSyncing(false);
    }, 700);
  };

  const exportCsv = () => {
    const header = "Артикул;Товар;Основной;Север;Юг;Отгружено FBS;Приёмка;К продаже;Статус";
    const body = filteredRows.map((row) => [row.sku, row.name, row.warehouses["Основной"], row.warehouses["Север"], row.warehouses["Юг"], row.fbs, row.receiving, row.toSale, row.status].join(";"));
    const blob = new Blob(["\uFEFF" + [header, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ostatki.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">С</span><span>СКЛАДНО</span></div>
        <nav className="nav-list" aria-label="Основная навигация">
          <a className="nav-item active" href="#overview"><span className="nav-symbol">▦</span>Обзор</a>
          <a className="nav-item" href="#stock"><span className="nav-symbol">□</span>Остатки</a>
          <a className="nav-item" href="#movement"><span className="nav-symbol">→</span>FBS-отгрузки<span className="nav-badge">14</span></a>
          <a className="nav-item" href="#sales"><span className="nav-symbol">↗</span>Продажи</a>
          <a className="nav-item" href="#reports"><span className="nav-symbol">≡</span>Отчёты</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection"><span className="live-dot" />Данные обновляются</div>
          <button className="profile" type="button" aria-label="Профиль пользователя">
            <span className="avatar">АК</span><span><strong>Анна К.</strong><small>Администратор</small></span><span className="chevron">›</span>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">ЧЕТВЕРГ, 6 АВГУСТА</p>
            <h1>Операционный обзор</h1>
          </div>
          <div className="header-actions">
            <div className="sync-state"><span className="live-dot" /><span>Синхронизация<br/><strong>{lastSync}</strong></span></div>
            <button className="secondary-btn" type="button" onClick={syncData} disabled={syncing}><span className={syncing ? "spin" : ""}>↻</span>{syncing ? "Обновляем" : "Обновить"}</button>
            <button className="primary-btn" type="button" onClick={exportCsv}>Экспорт<span>↓</span></button>
          </div>
        </header>

        <div className="content" id="overview">
          <section className="metric-grid" aria-label="Ключевые показатели">
            <article className="metric-card featured">
              <div className="metric-top"><span>Доступно к продаже</span><span className="trend up">↑ 6,4%</span></div>
              <strong className="metric-value">3 842 <small>шт.</small></strong>
              <div className="spark-bars" aria-hidden="true">{[24,31,28,42,38,52,47,62,58,74,69,83].map((height, i) => <i key={i} style={{height}} />)}</div>
              <p>+126 единиц после приёмки сегодня</p>
            </article>
            <article className="metric-card">
              <div className="metric-icon blue">→</div><div className="metric-label">Отгружено на FBS</div>
              <strong className="metric-value">286 <small>шт.</small></strong>
              <p><b>14</b> активных отгрузок</p>
            </article>
            <article className="metric-card">
              <div className="metric-icon amber">◷</div><div className="metric-label">На приёмке</div>
              <strong className="metric-value">174 <small>шт.</small></strong>
              <p><b>126</b> перейдут в продажу за 24 ч</p>
            </article>
            <article className="metric-card warning">
              <div className="metric-icon red">!</div><div className="metric-label">Риск дефицита</div>
              <strong className="metric-value">7 <small>арт.</small></strong>
              <p>Требуют пополнения остатков</p>
            </article>
          </section>

          <section className="movement-card" id="movement">
            <div className="section-heading">
              <div><span className="section-kicker">ДВИЖЕНИЕ ТОВАРА</span><h2>От склада до продажи</h2></div>
              <span className="period-pill">За последние 24 часа</span>
            </div>
            <div className="movement-flow">
              <div className="flow-node"><span className="node-dot navy">1</span><div><small>НА СКЛАДАХ</small><strong>3 842</strong><span>доступно</span></div></div>
              <div className="flow-line"><i style={{width:"78%"}} /><span>286 шт.</span></div>
              <div className="flow-node"><span className="node-dot blue">2</span><div><small>ОТГРУЖЕНО FBS</small><strong>286</strong><span>в пути</span></div></div>
              <div className="flow-line"><i style={{width:"61%"}} /><span>174 шт.</span></div>
              <div className="flow-node"><span className="node-dot amber">3</span><div><small>НА ПРИЁМКЕ</small><strong>174</strong><span>проверяются</span></div></div>
              <div className="flow-line final"><i style={{width:"72%"}} /><span>126 шт.</span></div>
              <div className="flow-node"><span className="node-dot green">✓</span><div><small>К ПРОДАЖЕ</small><strong className="green-text">+126</strong><span>сегодня</span></div></div>
            </div>
          </section>

          <section className="stock-card" id="stock">
            <div className="stock-header">
              <div><span className="section-kicker">ОСТАТКИ ПО АРТИКУЛАМ</span><h2>Все товары</h2></div>
              <div className="stock-tools">
                <label className="search-field"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Артикул или название" aria-label="Поиск по товарам"/></label>
                <label className="select-wrap"><span>Склад:</span><select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} aria-label="Выбрать склад">{warehouseOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
              </div>
            </div>
            <div className="filter-row">
              <div className="filter-tabs" role="tablist" aria-label="Фильтр остатков">
                {[{name:"Все", count:38}, {name:"Дефицит", count:7}, {name:"В пути", count:12}].map((item) => (
                  <button type="button" key={item.name} className={filter === item.name ? "active" : ""} onClick={() => setFilter(item.name)}>{item.name}<span>{item.count}</span></button>
                ))}
              </div>
              <span className="result-count">Показано {filteredRows.length} из 38 артикулов</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Товар / артикул</th><th>Основной</th><th>Север</th><th>Юг</th><th>FBS</th><th>Приёмка</th><th>К продаже</th><th>Статус</th><th /></tr></thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.sku} onClick={() => setSelected(row)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSelected(row); }}>
                      <td><div className="product-cell"><span className="product-swatch" style={{background:row.color}}>{row.name.charAt(0)}</span><span><strong>{row.name}</strong><small>{row.sku} · {row.category}</small></span></div></td>
                      {Object.values(row.warehouses).map((value, index) => <td key={index}><b>{value}</b><small> шт.</small></td>)}
                      <td><span className="number-pill blue-pill">{row.fbs}</span></td>
                      <td><span className="number-pill amber-pill">{row.receiving}</span></td>
                      <td><span className="number-pill green-pill">+{row.toSale}</span></td>
                      <td><span className={`status ${row.status === "В норме" ? "ok" : row.status === "Мало" ? "low" : "critical"}`}><i />{row.status}</span></td>
                      <td><button type="button" className="row-action" aria-label={`Открыть ${row.name}`}>›</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRows.length === 0 && <div className="empty-state"><strong>Ничего не найдено</strong><span>Попробуйте изменить поиск или фильтры.</span></div>}
            </div>
            <footer className="table-footer"><span><i className="live-dot" />Остатки обновлены {lastSync}</span><button type="button" onClick={() => {setQuery(""); setFilter("Все"); setWarehouse("Все склады");}}>Сбросить фильтры</button></footer>
          </section>
        </div>
      </section>

      {selected && (
        <div className="drawer-backdrop" onMouseDown={() => setSelected(null)} role="presentation">
          <aside className="drawer" onMouseDown={(e) => e.stopPropagation()} aria-label={`Карточка товара ${selected.name}`}>
            <button className="close-btn" type="button" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
            <span className="drawer-kicker">КАРТОЧКА ТОВАРА</span>
            <div className="drawer-product"><span className="product-swatch large" style={{background:selected.color}}>{selected.name.charAt(0)}</span><div><h2>{selected.name}</h2><p>{selected.sku} · {selected.category}</p></div></div>
            <div className="drawer-total"><span>Всего на складах</span><strong>{Object.values(selected.warehouses).reduce((a,b) => a+b,0)} <small>шт.</small></strong></div>
            <div className="warehouse-list">
              {Object.entries(selected.warehouses).map(([name, value]) => <div key={name}><span><i />{name}</span><strong>{value} шт.</strong></div>)}
            </div>
            <h3>Ближайшее движение</h3>
            <div className="timeline">
              <div className="timeline-item done"><i>✓</i><div><strong>Отгружено на FBS</strong><span>{selected.fbs} шт. · сегодня, 08:30</span></div></div>
              <div className="timeline-item active"><i>2</i><div><strong>На приёмке</strong><span>{selected.receiving} шт. · ожидается сегодня</span></div></div>
              <div className="timeline-item"><i>3</i><div><strong>Перейдёт к продаже</strong><span>{selected.toSale} шт. · прогноз до 18:00</span></div></div>
            </div>
            <button className="drawer-primary" type="button" onClick={() => setSelected(null)}>Понятно</button>
            <p className="drawer-note">Данные обновлены сегодня в {selected.updated}</p>
          </aside>
        </div>
      )}
    </main>
  );
}
