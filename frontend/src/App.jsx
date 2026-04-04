import { useCallback, useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_BASE ?? "";
const TOAST_DURATION = 6000; // ms

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function formatUpdated(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || "请求失败");
  return data;
}

// ── 固定列宽常量 ──────────────────────────────────────────────────────────────
const STICKY_DEL  = "left-0 w-12 min-w-12";
const STICKY_ACCT = "left-12 min-w-[8.5rem] max-w-[11rem] sm:min-w-[9.5rem] sm:max-w-[13rem]";

// ── Toast 组件 ───────────────────────────────────────────────────────────────

function ToastBar({ toasts, onUndo, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-50 flex flex-col-reverse items-center gap-2
                 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-enter pointer-events-auto w-full max-w-sm overflow-hidden rounded-2xl
                     border border-white/15 bg-night-800/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-sm text-slate-300">
              已删除{" "}
              <span className="font-semibold text-white">「{t.label}」</span>
            </span>
            <button
              onClick={() => onUndo(t)}
              className="shrink-0 rounded-lg bg-mint-500/20 px-3 py-1.5 text-sm font-semibold
                         text-mint-400 transition hover:bg-mint-500/35 active:scale-95"
            >
              撤销
            </button>
            <button
              onClick={() => onDismiss(t.id)}
              className="shrink-0 rounded-lg p-1.5 text-slate-500 transition
                         hover:bg-white/10 hover:text-slate-300"
              aria-label="关闭"
            >
              <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" fill="none" />
              </svg>
            </button>
          </div>
          {/* 倒计时进度条 */}
          <div className="h-0.5 w-full bg-white/5">
            <div
              className="toast-bar h-full bg-mint-500/60"
              style={{ "--toast-duration": `${TOAST_DURATION}ms` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 主应用 ───────────────────────────────────────────────────────────────────

export default function App() {
  const [columns, setColumns]   = useState([]);
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState(null);
  const [saving, setSaving]     = useState(false);
  const [toasts, setToasts]     = useState([]);

  const timers      = useRef({});
  const titleTimers = useRef({});
  const toastTimers = useRef({});

  // ── 数据加载 ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const data = await api("/api/state");
      setColumns(data.columns || []);
      setRows(data.rows || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Toast 管理 ─────────────────────────────────────────────────────────────

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (toastTimers.current[id]) {
      clearTimeout(toastTimers.current[id]);
      delete toastTimers.current[id];
    }
  }, []);

  const showUndoToast = useCallback((label, onUndo) => {
    const id = Date.now();
    const timer = setTimeout(() => dismissToast(id), TOAST_DURATION);
    toastTimers.current[id] = timer;
    setToasts((prev) => [...prev, { id, label, onUndo }]);
  }, [dismissToast]);

  const handleUndo = useCallback(async (toast) => {
    dismissToast(toast.id);
    try {
      await toast.onUndo();
    } catch (e) {
      setErr(e.message);
    }
  }, [dismissToast]);

  // ── 单元格保存 ─────────────────────────────────────────────────────────────

  const flushSave = useCallback((rowId, columnId, value) => {
    const key = `${rowId}-${columnId}`;
    if (timers.current[key]) { clearTimeout(timers.current[key]); delete timers.current[key]; }
    setSaving(true);
    return api("/api/cells", {
      method: "PATCH",
      body: JSON.stringify({ row_id: rowId, column_id: columnId, value }),
    })
      .then((cell) => {
        setRows((prev) =>
          prev.map((r) => {
            if (r.id !== rowId) return r;
            return {
              ...r,
              cells: {
                ...r.cells,
                [String(columnId)]: { value: cell.value, updated_at: cell.updated_at ?? null },
              },
            };
          })
        );
      })
      .catch((e) => setErr(e.message))
      .finally(() => setSaving(false));
  }, []);

  const scheduleSave = useCallback((rowId, columnId, value) => {
    const key = `${rowId}-${columnId}`;
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      delete timers.current[key];
      flushSave(rowId, columnId, value);
    }, 550);
  }, [flushSave]);

  const onCellChange = (rowId, columnId, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const prev0 = r.cells[String(columnId)] || { value: "", updated_at: null };
        return { ...r, cells: { ...r.cells, [String(columnId)]: { ...prev0, value } } };
      })
    );
    scheduleSave(rowId, columnId, value);
  };

  const onCellBlur = (rowId, columnId, value) => {
    const key = `${rowId}-${columnId}`;
    if (timers.current[key]) { clearTimeout(timers.current[key]); delete timers.current[key]; }
    flushSave(rowId, columnId, value);
  };

  // ── 账号名保存 ─────────────────────────────────────────────────────────────

  const flushRowTitle = useCallback((rowId, title) => {
    const key = `t-${rowId}`;
    if (titleTimers.current[key]) { clearTimeout(titleTimers.current[key]); delete titleTimers.current[key]; }
    setSaving(true);
    return api(`/api/rows/${rowId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    })
      .then((row) => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? { ...r, title: row.title, title_updated_at: row.title_updated_at ?? null }
              : r
          )
        );
      })
      .catch((e) => setErr(e.message))
      .finally(() => setSaving(false));
  }, []);

  const scheduleRowTitle = useCallback((rowId, title) => {
    const key = `t-${rowId}`;
    if (titleTimers.current[key]) clearTimeout(titleTimers.current[key]);
    titleTimers.current[key] = setTimeout(() => {
      delete titleTimers.current[key];
      flushRowTitle(rowId, title);
    }, 550);
  }, [flushRowTitle]);

  const onRowTitleChange = (rowId, title) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, title } : r)));
    scheduleRowTitle(rowId, title);
  };

  const onRowTitleBlur = (rowId, title) => {
    const key = `t-${rowId}`;
    if (titleTimers.current[key]) { clearTimeout(titleTimers.current[key]); delete titleTimers.current[key]; }
    flushRowTitle(rowId, title);
  };

  // ── 添加行 / 列 ────────────────────────────────────────────────────────────

  const addRow = async () => {
    try {
      await api("/api/rows", { method: "POST", body: JSON.stringify({ title: "" }) });
      await load();
    } catch (e) { setErr(e.message); }
  };

  const addColumn = async () => {
    try {
      await api("/api/columns", { method: "POST", body: JSON.stringify({ title: "新列" }) });
      await load();
    } catch (e) { setErr(e.message); }
  };

  const renameColumn = async (colId, title) => {
    try {
      await api(`/api/columns/${colId}`, { method: "PATCH", body: JSON.stringify({ title }) });
      setColumns((prev) => prev.map((c) => (c.id === colId ? { ...c, title } : c)));
    } catch (e) { setErr(e.message); }
  };

  // ── 删除（软删除 + 撤销 Toast）─────────────────────────────────────────────

  const removeColumn = async (colId) => {
    const colData = columns.find((c) => c.id === colId);
    if (!colData) return;

    // 立即从界面移除
    setColumns((prev) => prev.filter((c) => c.id !== colId));

    try {
      await api(`/api/columns/${colId}`, { method: "DELETE" });
      showUndoToast(`列 ${colData.title}`, async () => {
        await api(`/api/columns/${colId}/restore`, { method: "POST" });
        await load();
      });
    } catch (e) {
      // 删除失败：回滚界面
      setColumns((prev) =>
        [...prev, colData].sort((a, b) => a.position - b.position || a.id - b.id)
      );
      setErr(e.message);
    }
  };

  const removeRow = async (rowId) => {
    const rowData = rows.find((r) => r.id === rowId);
    if (!rowData) return;

    // 立即从界面移除
    setRows((prev) => prev.filter((r) => r.id !== rowId));

    try {
      await api(`/api/rows/${rowId}`, { method: "DELETE" });
      const label = rowData.title?.trim() || "未命名账号";
      showUndoToast(label, async () => {
        await api(`/api/rows/${rowId}/restore`, { method: "POST" });
        await load();
      });
    } catch (e) {
      setRows((prev) =>
        [...prev, rowData].sort((a, b) => a.position - b.position || a.id - b.id)
      );
      setErr(e.message);
    }
  };

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-night-950 via-night-900 to-night-850 pb-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(45,212,191,0.12),transparent)]" />

      {/* 顶部导航栏 */}
      <header className="relative z-10 border-b border-white/10 bg-night-900/80 px-4 py-4 backdrop-blur-xl
                         pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-mint-500/90">Delta · 台账</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              三角洲 · 账号管理表
            </h1>
            <p className="mt-1 max-w-lg text-sm text-slate-400">
              手动填写哈币、仓库、邮件等栏目；每格记录上次保存时间。
              删除行/列后底部会出现<span className="text-mint-400">撤销</span>按钮，6 秒内可恢复。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addRow}
              className="min-h-11 min-w-[5.5rem] rounded-xl bg-mint-500 px-4 text-sm font-semibold
                         text-night-950 shadow-glow transition hover:bg-mint-400 active:scale-[0.98]"
            >
              ＋ 添加账号行
            </button>
            <button
              type="button"
              onClick={addColumn}
              className="min-h-11 min-w-[5.5rem] rounded-xl border border-white/15 bg-white/5 px-4
                         text-sm font-medium text-slate-100 backdrop-blur transition
                         hover:bg-white/10 active:scale-[0.98]"
            >
              ＋ 添加列
            </button>
            <button
              type="button"
              onClick={load}
              className="min-h-11 rounded-xl border border-white/10 px-4 text-sm
                         text-slate-300 hover:bg-white/5"
            >
              刷新
            </button>
          </div>
        </div>
        {saving && (
          <p className="mx-auto mt-3 max-w-6xl text-xs text-mint-400/90">正在保存…</p>
        )}
      </header>

      {/* 主内容 */}
      <main className="relative z-10 mx-auto max-w-6xl px-3 py-6 sm:px-4">
        {err && (
          <div
            role="alert"
            className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-500/30
                       bg-red-950/40 px-4 py-3 text-sm text-red-200"
          >
            <span>{err}</span>
            <button
              onClick={() => setErr(null)}
              className="shrink-0 text-red-400/70 hover:text-red-200"
              aria-label="关闭错误提示"
            >
              ×
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-white/10 bg-night-850/50">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-mint-500/30 border-t-mint-400" />
          </div>
        ) : columns.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">
            暂无列，请点击「添加列」开始。
          </p>
        ) : (
          <>
            <p className="mb-2 px-1 text-center text-[11px] text-slate-500 sm:text-left">
              表格可左右滑动 · 停止输入或点击其他位置自动保存 · 删除后底部可撤销
            </p>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-night-850/40
                            shadow-2xl shadow-black/40 backdrop-blur-sm">
              <div className="overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] touch-pan-x">
                <table className="w-max min-w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-night-800/90">
                      {/* 删除列 */}
                      <th className={`sticky ${STICKY_DEL} z-30 border-r border-white/10
                                     bg-night-800/95 py-3 text-center text-xs font-medium text-slate-500
                                     shadow-[6px_0_12px_-6px_rgba(0,0,0,0.5)] backdrop-blur-sm`} />
                      {/* 账号名列 */}
                      <th className={`sticky ${STICKY_ACCT} z-30 border-r border-white/10
                                     bg-night-800/95 px-2 py-3 text-xs font-semibold uppercase
                                     tracking-wide text-slate-300
                                     shadow-[8px_0_14px_-6px_rgba(0,0,0,0.45)] backdrop-blur-sm`}>
                        账号名
                      </th>
                      {columns.map((col) => (
                        <th
                          key={col.id}
                          className="relative min-w-[10.5rem] max-w-[16rem] border-l border-white/5 px-2 py-2"
                        >
                          <div className="group flex items-stretch gap-1">
                            <input
                              defaultValue={col.title}
                              key={`h-${col.id}-${col.title}`}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v && v !== col.title) renameColumn(col.id, v);
                              }}
                              className="min-h-10 w-full flex-1 rounded-lg border border-transparent
                                         bg-white/5 px-2 py-2 text-sm font-semibold text-white
                                         placeholder:text-slate-500 focus:border-mint-500/50
                                         focus:outline-none focus:ring-1 focus:ring-mint-500/40"
                              aria-label={`列标题 ${col.title}`}
                            />
                            <button
                              type="button"
                              onClick={() => removeColumn(col.id)}
                              className="shrink-0 rounded-lg px-2 text-slate-500 opacity-0 transition
                                         hover:bg-red-500/15 hover:text-red-300
                                         group-hover:opacity-100 focus:opacity-100"
                              aria-label={`删除列 ${col.title}`}
                              title="删除列（可撤销）"
                            >
                              ×
                            </button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={columns.length + 2}
                          className="px-4 py-10 text-center text-slate-500"
                        >
                          暂无账号行，点击「添加账号行」新增一行。
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-white/5 transition hover:bg-white/[0.02]"
                        >
                          {/* 删除按钮 */}
                          <td className={`sticky ${STICKY_DEL} z-20 border-r border-white/10
                                         bg-night-850/95 p-1 text-center
                                         shadow-[6px_0_12px_-6px_rgba(0,0,0,0.45)] backdrop-blur-sm`}>
                            <button
                              type="button"
                              onClick={() => removeRow(row.id)}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center
                                         rounded-lg text-slate-500 hover:bg-red-500/15 hover:text-red-300
                                         transition"
                              aria-label="删除该行（可撤销）"
                              title="删除（可撤销）"
                            >
                              −
                            </button>
                          </td>

                          {/* 账号名 */}
                          <td className={`sticky ${STICKY_ACCT} z-20 border-r border-white/10
                                         bg-night-850/95 p-2
                                         shadow-[8px_0_14px_-6px_rgba(0,0,0,0.4)] backdrop-blur-sm`}>
                            <label className="sr-only" htmlFor={`acct-${row.id}`}>账号名</label>
                            <input
                              id={`acct-${row.id}`}
                              type="text"
                              value={row.title ?? ""}
                              onChange={(e) => onRowTitleChange(row.id, e.target.value)}
                              onBlur={(e) => onRowTitleBlur(row.id, e.target.value)}
                              className="w-full min-h-11 rounded-xl border border-white/10 bg-night-900/80
                                         px-3 py-2.5 text-[15px] font-medium text-slate-100
                                         placeholder:text-slate-600 focus:border-mint-500/45
                                         focus:outline-none focus:ring-1 focus:ring-mint-500/30 sm:text-sm"
                              placeholder="如：主号…"
                              autoComplete="off"
                            />
                            <p className="mt-1.5 px-0.5 text-[11px] leading-tight text-slate-500">
                              {row.title_updated_at
                                ? `更新于 ${formatUpdated(row.title_updated_at)}`
                                : "名称未保存过"}
                            </p>
                          </td>

                          {/* 数据格子 */}
                          {columns.map((col) => {
                            const cell = row.cells[String(col.id)] || { value: "", updated_at: null };
                            return (
                              <td
                                key={`${row.id}-${col.id}`}
                                className="align-top border-l border-white/5 p-2"
                              >
                                <label className="sr-only" htmlFor={`c-${row.id}-${col.id}`}>
                                  {col.title}
                                </label>
                                <textarea
                                  id={`c-${row.id}-${col.id}`}
                                  rows={2}
                                  value={cell.value}
                                  onChange={(e) => onCellChange(row.id, col.id, e.target.value)}
                                  onBlur={(e) => onCellBlur(row.id, col.id, e.target.value)}
                                  className="w-full min-h-[2.75rem] resize-y rounded-xl border border-white/10
                                             bg-night-900/80 px-3 py-2.5 text-[15px] leading-snug
                                             text-slate-100 placeholder:text-slate-600
                                             focus:border-mint-500/45 focus:outline-none
                                             focus:ring-1 focus:ring-mint-500/30 sm:text-sm"
                                  placeholder="点击填写…"
                                  inputMode="text"
                                />
                                <p className="mt-1.5 px-0.5 text-[11px] leading-tight text-slate-500">
                                  {cell.updated_at
                                    ? `更新于 ${formatUpdated(cell.updated_at)}`
                                    : "尚未保存过"}
                                </p>
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="relative z-10 mx-auto max-w-6xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))]
                         text-center text-xs text-slate-600">
        数据保存在服务器 SQLite（<code className="text-slate-500">delta_ledger.db</code>）· 仅手动编辑 · 删除均可 6 秒内撤销
      </footer>

      {/* 撤销 Toast */}
      <ToastBar toasts={toasts} onUndo={handleUndo} onDismiss={dismissToast} />
    </div>
  );
}
