"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type StockStatus = "В норме" | "Мало" | "Заканчивается";

type StockRow = {
  key: string;
  sku: string;
  nmId: number | null;
  name: string;
  category: string;
  color: string;
  warehouses: Record<string, number>;
  fbs: number;
  receiving: number;
  toSale: number;
  status: StockStatus;
  updated: string;
};

type InventoryResponse = {
  configured: boolean;
  rows?: StockRow[];
  warehouseNames?: string[];
  totals?: {
    available: number;
    fbs: number;
    receiving: number;
    toSale: number;
    risk: number;
    activeSupplies: number;
  };
  warnings?: string[];
  updatedAt?: string;
  error?: string;
};

const emptyTotals = { available: 0, fbs: 0, receiving: 0, toSale: 0, risk: 0, activeSupplies: 0 };
const formatNumber = new Intl.NumberFormat("ru-RU");

function stockTotal(row: StockRow) {
  return Object.values(row.warehouses).reduce((sum, value) => sum + value, 0);
}

function formatSyncTime(value: string | null) {
  if (!value) return "ожидаем данные";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(value));
}

export default function Home() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [warehouseNames, setWarehouseNames] = useState<string[]>([]);
  const [totals, setTotals] = useState(emptyTotals);
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("Все склады");
  const [filter, setFilter] = useState("Все");
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/inventory${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await response.json() as InventoryResponse;
      setConfigured(data.configured);
      setWarnings(data.warnings ?? []);
      if (!response.ok) throw new Error(data.error || "Не удалось получить данные Wildberries");
      setRows(data.rows ?? []);
      setWarehouseNames(data.warehouseNames ?? []);
      setTotals(data.totals ?? emptyTotals);
      setUpdatedAt(data.updatedAt ?? new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось получить данные Wildberries");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term) || String(row.nmId ?? "").includes(term);
      const matchesFilter = filter === "Все" || (filter === "Дефицит" && row.status !== "В норме") || (filter === "В пути" && row.fbs > 0);
      const matchesWarehouse = warehouse === "Все склады" || (row.warehouses[warehouse] ?? 0) > 0;
      return matchesQuery && matchesFilter && matchesWarehouse;
    });
  }, [rows, query, filter, warehouse]);

  const counts = useMemo(() => ({
    all: rows.length,
    risk: rows.filter((row) => row.status !== "В норме").length,
    transit: rows.filter((row) => row.fbs > 0).length,
  }), [rows]);

  const exportCsv = () => {
    const header = ["Артикул продавца", "Артикул WB", ...warehouseNames, "Всего", "Отгружено FBS", "На приёмке", "Ожидают продажи", "Статус"];
    const body = filteredRows.map((row) => [row.sku, row.nmId ?? "", ...warehouseNames.map((name) => row.warehouses[name] ?? 0), stockTotal(row), row.fbs, row.receiving, row.toSale, row.status]);
    const content = [header, ...body].map((line) => line.map((cell) => String(cell).replaceAll(";", ",")).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ostatki-wb-${new Date().toISOString().slice(0, 10)}.csv`;
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
          <a className="nav-item" href="#movement"><span className="nav-symbol">→</span>FBS-отгрузки<span className="nav-badge">{totals.fbs}</span></a>
          <a className="nav-item" href="#sales"><span className="nav-symbol">↗</span>Продажи</a>
          <a className="nav-item" href="#reports"><span className="nav-symbol">≡</span>Отчёты</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection"><span className={error ? "live-dot offline" : "live-dot"} />{error ? "Нужна проверка подключения" : "Подключено к WB API"}</div>
          <div className="profile">
            <span className="avatar">WB</span><span><strong>Wildberries</strong><small>{configured ? "Рабочий кабинет" : "Токен не добавлен"}</small></span><span className="chevron">›</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">WILDBERRIES · ОПЕРАЦИИ</p><h1>Остатки и движение товаров</h1></div>
          <div className="header-actions">
            <div className="sync-state"><span className={error ? "live-dot offline" : "live-dot"} /><span>Последнее обновление<br/><strong>{formatSyncTime(updatedAt)} МСК</strong></span></div>
            <button className="secondary-btn" type="button" onClick={() => void loadData(true)} disabled={loading}><span className={loading ? "spin" : ""}>↻</span>{loading ? "Обновляем" : "Обновить"}</button>
            <button className="primary-btn" type="button" onClick={exportCsv} disabled={!rows.length}>Экспорт<span>↓</span></button>
          </div>
        </header>

        <div className="content" id="overview">
          {error && (
            <section className="api-notice" role="alert">
              <span className="api-notice-icon">!</span>
              <div><strong>{error}</strong><p>{configured ? "Для полной загрузки токену нужны категории: Контент, Маркетплейс и Статистика." : "Безопасный токен хранится только на сервере и не передаётся в браузер."}</p></div>
              <button type="button" onClick={() => void loadData(true)}>Проверить снова</button>
            </section>
          )}
          {!error && warnings.length > 0 && (
            <section className="warning-strip"><span>!</span><p>{warnings.join(" · ")}</p></section>
          )}

          <section className="metric-grid" aria-label="Ключевые показатели">
            <article className="metric-card featured">
              <div className="metric-top"><span>Всего на складах</span><span className="trend up">● WB API</span></div>
              <strong className="metric-value">{loading ? "—" : formatNumber.format(totals.available)} <small>шт.</small></strong>
              <div className="spark-bars" aria-hidden="true">{[24,31,28,42,38,52,47,62,58,74,69,83].map((height, index) => <i key={index} style={{height}} />)}</div>
              <p>{warehouseNames.length} складов в едином отчёте</p>
            </article>
            <article className="metric-card">
              <div className="metric-icon blue">→</div><div className="metric-label">Отгружено FBS</div>
              <strong className="metric-value">{loading ? "—" : formatNumber.format(totals.fbs)} <small>шт.</small></strong>
              <p><b>{totals.activeSupplies}</b> активных поставок за 30 дней</p>
            </article>
            <article className="metric-card">
              <div className="metric-icon amber">◷</div><div className="metric-label">Ожидают приёмки</div>
              <strong className="metric-value">{loading ? "—" : formatNumber.format(totals.receiving)} <small>шт.</small></strong>
              <p><b>{totals.toSale}</b> ожидают перехода в продажу</p>
            </article>
            <article className="metric-card warning">
              <div className="metric-icon red">!</div><div className="metric-label">Риск дефицита</div>
              <strong className="metric-value">{loading ? "—" : formatNumber.format(totals.risk)} <small>арт.</small></strong>
              <p>Остаток меньше 21 единицы</p>
            </article>
          </section>

          <section className="movement-card" id="movement">
            <div className="section-heading">
              <div><span className="section-kicker">ДВИЖЕНИЕ FBS</span><h2>От вашего склада до продажи</h2></div>
              <span className="period-pill">Актуальные заказы за 30 дней</span>
            </div>
            <div className="movement-flow">
              <div className="flow-node"><span className="node-dot navy">1</span><div><small>НА СКЛАДАХ</small><strong>{formatNumber.format(totals.available)}</strong><span>доступно</span></div></div>
              <div className="flow-line"><i style={{width:"78%"}} /><span>{totals.fbs} шт.</span></div>
              <div className="flow-node"><span className="node-dot blue">2</span><div><small>ОТГРУЖЕНО FBS</small><strong>{formatNumber.format(totals.fbs)}</strong><span>в доставке</span></div></div>
              <div className="flow-line"><i style={{width:"61%"}} /><span>{totals.receiving} шт.</span></div>
              <div className="flow-node"><span className="node-dot amber">3</span><div><small>ОЖИДАЮТ WB</small><strong>{formatNumber.format(totals.receiving)}</strong><span>на приёмке</span></div></div>
              <div className="flow-line final"><i style={{width:"72%"}} /><span>{totals.toSale} шт.</span></div>
              <div className="flow-node"><span className="node-dot green">✓</span><div><small>К ПРОДАЖЕ</small><strong className="green-text">{formatNumber.format(totals.toSale)}</strong><span>ожидаются</span></div></div>
            </div>
          </section>

          <section className="stock-card" id="stock">
            <div className="stock-header">
              <div><span className="section-kicker">ОСТАТКИ ПО АРТИКУЛАМ</span><h2>Все товары Wildberries</h2></div>
              <div className="stock-tools">
                <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Артикул или название" aria-label="Поиск по товарам"/></label>
                <label className="select-wrap"><span>Склад:</span><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} aria-label="Выбрать склад"><option>Все склады</option>{warehouseNames.map((item) => <option key={item}>{item}</option>)}</select></label>
              </div>
            </div>
            <div className="filter-row">
              <div className="filter-tabs" role="tablist" aria-label="Фильтр остатков">
                {[{name:"Все", count:counts.all}, {name:"Дефицит", count:counts.risk}, {name:"В пути", count:counts.transit}].map((item) => (
                  <button type="button" key={item.name} className={filter === item.name ? "active" : ""} onClick={() => setFilter(item.name)}>{item.name}<span>{item.count}</span></button>
                ))}
              </div>
              <span className="result-count">Показано {filteredRows.length} из {rows.length} артикулов</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Товар / артикул</th><th>Всего</th><th>{warehouse === "Все склады" ? "Складов" : "На выбранном"}</th><th>FBS</th><th>Приёмка</th><th>К продаже</th><th>Статус</th><th /></tr></thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.key} onClick={() => setSelected(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelected(row); }}>
                      <td><div className="product-cell"><span className="product-swatch" style={{background:row.color}}>{row.name.charAt(0).toUpperCase()}</span><span><strong>{row.name}</strong><small>{row.sku}{row.nmId ? ` · WB ${row.nmId}` : ""} · {row.category}</small></span></div></td>
                      <td><b>{formatNumber.format(stockTotal(row))}</b><small> шт.</small></td>
                      <td><b>{warehouse === "Все склады" ? Object.values(row.warehouses).filter((value) => value > 0).length : formatNumber.format(row.warehouses[warehouse] ?? 0)}</b>{warehouse !== "Все склады" && <small> шт.</small>}</td>
                      <td><span className="number-pill blue-pill">{row.fbs}</span></td>
                      <td><span className="number-pill amber-pill">{row.receiving}</span></td>
                      <td><span className="number-pill green-pill">{row.toSale}</span></td>
                      <td><span className={`status ${row.status === "В норме" ? "ok" : row.status === "Мало" ? "low" : "critical"}`}><i />{row.status}</span></td>
                      <td><button type="button" className="row-action" aria-label={`Открыть ${row.name}`}>›</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading && <div className="loading-state"><span className="loader"/><strong>Загружаем данные из Wildberries</strong><small>Остатки и статусы FBS собираются в единый отчёт</small></div>}
              {!loading && !filteredRows.length && <div className="empty-state"><strong>{error ? "Данные пока не загружены" : "Ничего не найдено"}</strong><span>{error ? "Проверьте подключение WB API." : "Попробуйте изменить поиск или фильтры."}</span></div>}
            </div>
            <footer className="table-footer"><span><i className={error ? "live-dot offline" : "live-dot"} />{updatedAt ? `Остатки обновлены в ${formatSyncTime(updatedAt)} МСК` : "Ожидаем синхронизацию"}</span><button type="button" onClick={() => {setQuery(""); setFilter("Все"); setWarehouse("Все склады");}}>Сбросить фильтры</button></footer>
          </section>
        </div>
      </section>

      {selected && (
        <div className="drawer-backdrop" onMouseDown={() => setSelected(null)} role="presentation">
          <aside className="drawer" onMouseDown={(event) => event.stopPropagation()} aria-label={`Карточка товара ${selected.name}`}>
            <button className="close-btn" type="button" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
            <span className="drawer-kicker">КАРТОЧКА ТОВАРА · WB API</span>
            <div className="drawer-product"><span className="product-swatch large" style={{background:selected.color}}>{selected.name.charAt(0).toUpperCase()}</span><div><h2>{selected.name}</h2><p>{selected.sku}{selected.nmId ? ` · WB ${selected.nmId}` : ""}</p></div></div>
            <div className="drawer-total"><span>Всего на складах</span><strong>{formatNumber.format(stockTotal(selected))} <small>шт.</small></strong></div>
            <div className="warehouse-list">
              {Object.entries(selected.warehouses).sort((a,b) => b[1] - a[1]).map(([name, value]) => <div key={name}><span><i />{name}</span><strong>{formatNumber.format(value)} шт.</strong></div>)}
              {!Object.keys(selected.warehouses).length && <div><span>Нет остатков</span><strong>0 шт.</strong></div>}
            </div>
            <h3>Текущее движение FBS</h3>
            <div className="timeline">
              <div className="timeline-item done"><i>✓</i><div><strong>Отгружено на FBS</strong><span>{selected.fbs} шт. в доставке</span></div></div>
              <div className="timeline-item active"><i>2</i><div><strong>Ожидает приёмки WB</strong><span>{selected.receiving} шт. в статусе waiting</span></div></div>
              <div className="timeline-item"><i>3</i><div><strong>Ожидает продажи</strong><span>{selected.toSale} шт. отсортировано или готово к выдаче</span></div></div>
            </div>
            <button className="drawer-primary" type="button" onClick={() => setSelected(null)}>Понятно</button>
            <p className="drawer-note">Данные Wildberries обновлены в {selected.updated} МСК</p>
          </aside>
        </div>
      )}
    </main>
  );
}
