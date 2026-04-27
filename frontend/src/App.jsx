import { useCallback, useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_BASE ?? "";
const TOAST_DURATION = 6000;

// ── 颜色预设 ──────────────────────────────────────────────────────────────────
const COLORS = [
  { key: null,      hex: "#64748b", name: "默认" },
  { key: "sky",     hex: "#38bdf8", name: "蓝"   },
  { key: "mint",    hex: "#2dd4bf", name: "青"   },
  { key: "emerald", hex: "#34d399", name: "绿"   },
  { key: "amber",   hex: "#fbbf24", name: "黄"   },
  { key: "orange",  hex: "#fb923c", name: "橙"   },
  { key: "rose",    hex: "#fb7185", name: "粉"   },
  { key: "violet",  hex: "#a78bfa", name: "紫"   },
  { key: "red",     hex: "#f87171", name: "红"   },
];

function colorHex(key) {
  return COLORS.find((c) => c.key === key)?.hex ?? null;
}

function cardStyle(colorKey, isExpanded) {
  const hex = colorHex(colorKey);
  if (!hex || !colorKey) return {};
  return {
    borderColor:     isExpanded ? `${hex}55` : `${hex}28`,
    borderLeftColor: `${hex}cc`,
    borderLeftWidth: "3px",
    backgroundColor: `${hex}0b`,
  };
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function relativeTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)         return "刚刚";
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(iso);
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

function opStyle(op) {
  if (op === "初始化")                              return "bg-slate-500/20 text-slate-300";
  if (op.startsWith("新增"))                        return "bg-emerald-500/20 text-emerald-400";
  if (op.startsWith("删除"))                        return "bg-red-500/20 text-red-400";
  if (op.startsWith("恢复"))                        return "bg-sky-500/20 text-sky-400";
  if (op.startsWith("修改") || op.startsWith("重命名")) return "bg-violet-500/20 text-violet-400";
  if (op.startsWith("回滚"))                        return "bg-amber-500/20 text-amber-400";
  if (op.startsWith("调整"))                        return "bg-orange-500/20 text-orange-400";
  return "bg-white/10 text-slate-300";
}

// ── Toast ────────────────────────────────────────────────────────────────────

function ToastBar({ toasts, onUndo, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div aria-live="polite"
         className="fixed bottom-0 left-0 right-0 z-50 flex flex-col-reverse items-center gap-2
                    px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id}
             className="toast-enter pointer-events-auto w-full max-w-sm overflow-hidden
                        rounded-2xl border border-white/15 bg-night-800/95 shadow-2xl
                        shadow-black/60 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-sm text-slate-300">{t.label}</span>
            {t.onUndo && (
              <button onClick={() => onUndo(t)}
                      className="shrink-0 rounded-lg bg-mint-500/20 px-3 py-1.5 text-sm
                                 font-semibold text-mint-400 hover:bg-mint-500/35">撤销</button>
            )}
            <button onClick={() => onDismiss(t.id)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:text-slate-300">
              <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 1l12 12M13 1L1 13" />
              </svg>
            </button>
          </div>
          <div className="h-0.5 bg-white/5">
            <div className="toast-bar h-full bg-mint-500/60"
                 style={{ "--toast-duration": `${TOAST_DURATION}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 历史面板 ──────────────────────────────────────────────────────────────────

function HistoryPanel({ open, items, loading, restoring, snapIdBeingRestored,
                        onClose, onRestore, onClear, onRefresh }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-[26rem] flex-col
                        border-l border-white/10 bg-night-900/98 shadow-2xl backdrop-blur-xl
                        pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">历史操作记录</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {loading ? "加载中…" : `共 ${items.length} 条 · 点击「恢复至此」回滚`}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={onRefresh} title="刷新"
                    className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-slate-200">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none"
                   stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M17 10a7 7 0 1 1-1.5-4.33M17 3v4h-4" />
              </svg>
            </button>
            <button onClick={onClose}
                    className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-slate-200">
              <svg viewBox="0 0 14 14" className="h-4 w-4" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 1l12 12M13 1L1 13" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-mint-500/30 border-t-mint-400" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">暂无历史记录</p>
          ) : (
            <ul>
              {items.map((item, idx) => {
                const isCurrent   = idx === 0;
                const isRestoring = restoring && snapIdBeingRestored === item.id;
                return (
                  <li key={item.id}
                      className={`border-b border-white/5 px-5 py-3.5 transition
                                  ${isCurrent ? "bg-mint-500/5" : "hover:bg-white/[0.025]"}`}>
                    <div className="flex items-start gap-3">
                      <div className="mt-1.5 flex flex-col items-center">
                        <div className={`h-2 w-2 rounded-full ${isCurrent
                          ? "bg-mint-400 shadow-[0_0_6px_2px_rgba(45,212,191,0.4)]"
                          : "bg-slate-600"}`} />
                        {idx < items.length - 1 && (
                          <div className="mt-1 h-full min-h-[2rem] w-px bg-white/10" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold
                                           ${opStyle(item.operation)}`}>
                            {item.operation}
                          </span>
                          {isCurrent && (
                            <span className="rounded-md bg-mint-500/15 px-1.5 py-0.5
                                             text-[11px] font-semibold text-mint-400">当前</span>
                          )}
                        </div>
                        <p className="mt-1 break-words text-sm leading-snug text-slate-300">
                          {item.description || "—"}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {relativeTime(item.created_at)}
                          <span className="ml-2 opacity-50">#{item.id}</span>
                        </p>
                      </div>
                      {!isCurrent && (
                        <button
                          onClick={() => onRestore(item.id, item.description || item.operation)}
                          disabled={restoring}
                          className="shrink-0 self-center rounded-xl border border-white/15 px-3
                                     py-1.5 text-xs font-medium text-slate-200 transition
                                     hover:border-mint-500/40 hover:bg-mint-500/10 hover:text-mint-300
                                     disabled:opacity-40 active:scale-95">
                          {isRestoring ? (
                            <span className="flex items-center gap-1.5">
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="6" stroke="currentColor"
                                        strokeWidth="2" strokeDasharray="25 15" />
                              </svg>回滚中
                            </span>
                          ) : "恢复至此"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {items.length > 0 && (
          <div className="border-t border-white/10 px-5 py-3">
            <button onClick={onClear} disabled={restoring}
                    className="w-full rounded-xl border border-red-500/20 py-2.5 text-sm
                               text-red-400/80 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40">
              清空所有历史记录
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-600">清空后无法恢复 · 当前数据不受影响</p>
          </div>
        )}
      </aside>
    </>
  );
}

// ── 颜色选择器 ────────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="shrink-0 text-xs text-slate-500">卡片颜色</span>
      <div className="flex flex-wrap gap-2">
        {COLORS.map((c) => {
          const selected = value === c.key;
          return (
            <button
              key={String(c.key)}
              type="button"
              onClick={() => onChange(c.key)}
              title={c.name}
              aria-label={`颜色：${c.name}`}
              className={`relative h-6 w-6 rounded-full transition-transform
                          hover:scale-110 active:scale-95
                          ${selected ? "ring-2 ring-white/70 ring-offset-2 ring-offset-night-900 scale-110" : ""}`}
              style={{ backgroundColor: c.hex }}
            >
              {selected && (
                <svg viewBox="0 0 10 10" className="absolute inset-0 m-auto h-3 w-3"
                     fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="2" strokeLinecap="round">
                  <path d="M2 5l2.5 2.5 3.5-4" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── 账号卡片 ──────────────────────────────────────────────────────────────────

function AccountCard({
  row, columns, isExpanded, isFirst, isLast,
  isDragging, isDragOver,
  onToggleExpand, onDelete, onMoveUp, onMoveDown,
  onRowTitleChange, onRowTitleBlur,
  onCellChange, onCellBlur, onColorChange,
  onDragStart, onDragEnd, onDragOver, onDrop,
}) {
  const colCount = columns.length;
  const hex      = colorHex(row.color);

  return (
    <div
      draggable={!isExpanded}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(row.id); }}
      onDragOver={(e)  => { e.preventDefault(); onDragOver(row.id); }}
      onDrop={(e)      => { e.preventDefault(); onDrop(row.id); }}
      onDragEnd={onDragEnd}
      className={`overflow-hidden rounded-2xl border transition-all duration-200
                  ${isDragging  ? "opacity-40 scale-[0.98] cursor-grabbing" : ""}
                  ${isDragOver  ? "ring-2 ring-mint-500/60 ring-offset-2 ring-offset-night-950" : ""}
                  ${isExpanded  ? "" : "hover:border-white/20"}`}
      style={{
        ...cardStyle(row.color, isExpanded),
        ...((!row.color) ? { borderColor: isExpanded ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)",
                              backgroundColor: "rgba(15,23,36,0.4)" } : {}),
      }}
    >
      {/* ── 卡片头部 ── */}
      <div className="flex items-center gap-2 px-3 py-3">

        {/* 拖拽手柄（桌面） */}
        <div className="hidden sm:flex shrink-0 cursor-grab active:cursor-grabbing select-none
                        items-center justify-center rounded-lg p-1.5 text-slate-600
                        hover:text-slate-400 transition"
             title="拖拽排序">
          <svg viewBox="0 0 10 16" className="h-4 w-2.5" fill="currentColor">
            <circle cx="2.5" cy="2"  r="1.4" /><circle cx="7.5" cy="2"  r="1.4" />
            <circle cx="2.5" cy="8"  r="1.4" /><circle cx="7.5" cy="8"  r="1.4" />
            <circle cx="2.5" cy="14" r="1.4" /><circle cx="7.5" cy="14" r="1.4" />
          </svg>
        </div>

        {/* 颜色圆点（只读模式，有颜色时显示） */}
        {hex && !isExpanded && (
          <div className="shrink-0 h-2.5 w-2.5 rounded-full shadow-sm"
               style={{ backgroundColor: hex }} />
        )}

        {/* 账号名 */}
        {isExpanded ? (
          <input
            type="text"
            value={row.title ?? ""}
            onChange={(e) => onRowTitleChange(row.id, e.target.value)}
            onBlur={(e)   => onRowTitleBlur(row.id, e.target.value)}
            className="min-h-10 flex-1 rounded-xl border border-white/15 bg-night-900/80 px-3
                       py-2 text-base font-semibold text-white placeholder:text-slate-600
                       focus:border-mint-500/50 focus:outline-none focus:ring-1 focus:ring-mint-500/30"
            placeholder="账号名（如：主号）"
            autoComplete="off"
            autoFocus
          />
        ) : (
          <button onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-base font-semibold"
                  style={hex ? { color: `color-mix(in srgb, ${hex} 55%, white)` } : { color: "white" }}>
              {row.title || <span className="font-normal text-slate-500">未命名账号</span>}
            </span>
            {row.last_updated_at && (
              <span className="block text-[11px] text-slate-500 mt-0.5">
                {relativeTime(row.last_updated_at)}更新
              </span>
            )}
          </button>
        )}

        {/* 手机上下移动（只读模式右侧） */}
        {!isExpanded && (
          <div className="flex sm:hidden items-center gap-0.5 shrink-0">
            <button onClick={onMoveUp} disabled={isFirst}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500
                               hover:bg-white/10 hover:text-slate-200 disabled:opacity-25 transition"
                    aria-label="上移">
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 10l4-4 4 4" />
              </svg>
            </button>
            <button onClick={onMoveDown} disabled={isLast}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500
                               hover:bg-white/10 hover:text-slate-200 disabled:opacity-25 transition"
                    aria-label="下移">
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
          </div>
        )}

        {/* 编辑 / 完成 */}
        <button
          onClick={onToggleExpand}
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition
                      ${isExpanded
                        ? "bg-mint-500 text-night-950 hover:bg-mint-400"
                        : "border border-white/15 bg-white/5 text-slate-300 hover:bg-white/10"}`}>
          {isExpanded ? "完成" : "编辑"}
        </button>

        {/* 删除 */}
        <button
          onClick={() => onDelete(row.id)}
          className="shrink-0 rounded-xl p-2.5 text-slate-500 hover:bg-red-500/15
                     hover:text-red-300 transition"
          aria-label="删除该行（可撤销）">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none"
               stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" />
          </svg>
        </button>
      </div>

      <div className="mx-3 border-t border-white/5" />

      {/* ── 字段区域 ── */}
      {colCount === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">暂无列，请点击「添加列」。</p>

      ) : isExpanded ? (
        /* 编辑模式 */
        <div className="space-y-4 p-4">

          {/* 颜色选择器 */}
          <ColorPicker value={row.color ?? null} onChange={(c) => onColorChange(row.id, c)} />

          {/* 手机端上下移动（编辑模式内） */}
          <div className="flex sm:hidden items-center gap-2">
            <span className="text-xs text-slate-500 shrink-0">位置调整</span>
            <button onClick={onMoveUp} disabled={isFirst}
                    className="flex items-center gap-1.5 rounded-xl border border-white/15 px-3
                               py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30
                               transition">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 10l4-4 4 4" />
              </svg>上移
            </button>
            <button onClick={onMoveDown} disabled={isLast}
                    className="flex items-center gap-1.5 rounded-xl border border-white/15 px-3
                               py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30
                               transition">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 6l4 4 4-4" />
              </svg>下移
            </button>
          </div>

          {/* 各字段输入 */}
          {columns.map((col) => {
            const cell = row.cells[String(col.id)] || { value: "", updated_at: null };
            return (
              <div key={col.id}>
                <label className="mb-1.5 block text-xs font-semibold uppercase
                                  tracking-wide text-slate-400">
                  {col.title}
                </label>
                <textarea
                  rows={2}
                  value={cell.value}
                  onChange={(e) => onCellChange(row.id, col.id, e.target.value)}
                  onBlur={(e)   => onCellBlur(row.id, col.id, e.target.value)}
                  className="w-full resize-y rounded-xl border border-white/10 bg-night-900/80
                             px-3 py-2.5 text-sm leading-relaxed text-slate-100
                             placeholder:text-slate-600 focus:border-mint-500/45
                             focus:outline-none focus:ring-1 focus:ring-mint-500/30"
                  placeholder={`填写${col.title}…`}
                  inputMode="text"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {cell.updated_at ? `更新于 ${formatDate(cell.updated_at)}` : "尚未保存过"}
                </p>
              </div>
            );
          })}
        </div>

      ) : (
        /* 只读模式 */
        <button onClick={onToggleExpand} className="w-full text-left">
          <div className={`grid gap-x-4 gap-y-3 p-4
                          ${colCount === 1 ? "grid-cols-1"
                            : colCount <= 4 ? "grid-cols-2"
                            : "grid-cols-2 sm:grid-cols-3"}`}>
            {columns.map((col) => {
              const cell = row.cells[String(col.id)] || { value: "", updated_at: null };
              return (
                <div key={col.id} className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {col.title}
                  </p>
                  <p className={`mt-0.5 break-words text-sm leading-snug line-clamp-2
                                 ${cell.value ? "text-slate-100" : "text-slate-600"}`}>
                    {cell.value || "—"}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="pb-2.5 text-center text-[11px] text-slate-600">点击任意处编辑</p>
        </button>
      )}
    </div>
  );
}

// ── 主应用 ────────────────────────────────────────────────────────────────────

export default function App() {
  const [columns,      setColumns]      = useState([]);
  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [err,          setErr]          = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [toasts,       setToasts]       = useState([]);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [colMgrOpen,   setColMgrOpen]   = useState(false);

  const [histOpen,    setHistOpen]    = useState(false);
  const [histItems,   setHistItems]   = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [restoring,   setRestoring]   = useState(false);
  const [restoringId, setRestoringId] = useState(null);

  const [draggingId,  setDraggingId]  = useState(null);
  const [dragOverId,  setDragOverId]  = useState(null);

  const pendingCells  = useRef({});  // "rowId-colId" -> { rowId, colId, value }
  const pendingTitles = useRef({});  // rowId -> title
  const toastTimers   = useRef({});

  // ── 加载 ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setErr(null); setLoading(true);
    try {
      const d = await api("/api/state");
      setColumns(d.columns || []); setRows(d.rows || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Toast ──────────────────────────────────────────────────────────────────

  const dismissToast = useCallback((id) => {
    setToasts((p) => p.filter((t) => t.id !== id));
    if (toastTimers.current[id]) { clearTimeout(toastTimers.current[id]); delete toastTimers.current[id]; }
  }, []);

  const showToast = useCallback((label, onUndo = null) => {
    const id = Date.now();
    toastTimers.current[id] = setTimeout(() => dismissToast(id), TOAST_DURATION);
    setToasts((p) => [...p, { id, label, onUndo }]);
  }, [dismissToast]);

  const handleUndo = useCallback(async (t) => {
    dismissToast(t.id);
    try { await t.onUndo(); } catch (e) { setErr(e.message); }
  }, [dismissToast]);

  // ── 历史面板 ───────────────────────────────────────────────────────────────

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try { setHistItems((await api("/api/history")).items || []); }
    catch (e) { setErr(e.message); }
    finally { setHistLoading(false); }
  }, []);

  const openHistory = () => { setHistOpen(true); loadHistory(); };

  const restoreSnapshot = async (snapId, label) => {
    if (restoring) return;
    setRestoring(true); setRestoringId(snapId);
    try {
      const d = await api(`/api/history/${snapId}/restore`, { method: "POST" });
      setColumns(d.state.columns || []); setRows(d.state.rows || []);
      setExpandedRows(new Set()); setHistOpen(false);
      showToast(`已回滚到「${label}」`); loadHistory();
    } catch (e) { setErr(e.message); }
    finally { setRestoring(false); setRestoringId(null); }
  };

  const clearHistory = async () => {
    if (!window.confirm("确定清空所有历史记录？")) return;
    try { await api("/api/history", { method: "DELETE" }); setHistItems([]); showToast("历史记录已清空"); }
    catch (e) { setErr(e.message); }
  };

  // ── 单元格（仅本地更新，点「完成」时统一提交） ──────────────────────────────

  const onCellChange = (rowId, colId, value) => {
    setRows((p) => p.map((r) => r.id !== rowId ? r : {
      ...r, cells: { ...r.cells, [String(colId)]: { ...(r.cells[String(colId)] || {}), value } },
    }));
    pendingCells.current[`${rowId}-${colId}`] = { rowId, colId, value };
  };
  const onCellBlur = () => {};

  // ── 账号名（仅本地更新，点「完成」时统一提交） ──────────────────────────────

  const onRowTitleChange = (rowId, title) => {
    setRows((p) => p.map((r) => r.id === rowId ? { ...r, title } : r));
    pendingTitles.current[rowId] = title;
  };
  const onRowTitleBlur = () => {};

  // ── 点「完成」时统一提交该行所有待保存变更 ────────────────────────────────────

  const flushRowChanges = useCallback(async (rowId) => {
    const cellKeys = Object.keys(pendingCells.current).filter((k) => k.startsWith(`${rowId}-`));
    const pendingTitle = pendingTitles.current[rowId];
    if (cellKeys.length === 0 && pendingTitle === undefined) return;

    setSaving(true);
    try {
      await Promise.all(cellKeys.map((key) => {
        const { colId, value } = pendingCells.current[key];
        delete pendingCells.current[key];
        return api("/api/cells", { method: "PATCH", body: JSON.stringify({ row_id: rowId, column_id: colId, value }) })
          .then((cell) => setRows((p) => p.map((r) => {
            if (r.id !== rowId) return r;
            const cellAt = cell.updated_at ?? null;
            const lastAt = (!r.last_updated_at || (cellAt && cellAt > r.last_updated_at)) ? cellAt : r.last_updated_at;
            return {
              ...r,
              cells: { ...r.cells, [String(colId)]: { value: cell.value, updated_at: cellAt } },
              last_updated_at: lastAt,
            };
          })));
      }));

      if (pendingTitle !== undefined) {
        delete pendingTitles.current[rowId];
        const updated = await api(`/api/rows/${rowId}`, { method: "PATCH", body: JSON.stringify({ title: pendingTitle }) });
        setRows((p) => p.map((r) => r.id === rowId
          ? { ...r, title: updated.title, title_updated_at: updated.title_updated_at ?? null, last_updated_at: updated.last_updated_at ?? null }
          : r));
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }, []);

  // ── 颜色 ───────────────────────────────────────────────────────────────────

  const handleColorChange = useCallback(async (rowId, color) => {
    setRows((p) => p.map((r) => r.id === rowId ? { ...r, color } : r));
    try { await api(`/api/rows/${rowId}`, { method: "PATCH", body: JSON.stringify({ color }) }); }
    catch (e) { setErr(e.message); }
  }, []);

  // ── 拖拽排序 ───────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((id) => setDraggingId(id), []);
  const handleDragOver  = useCallback((id) => { if (id !== draggingId) setDragOverId(id); }, [draggingId]);
  const handleDragEnd   = useCallback(() => { setDraggingId(null); setDragOverId(null); }, []);

  const handleDrop = useCallback(async (targetId) => {
    const fromId = draggingId;
    setDraggingId(null); setDragOverId(null);
    if (!fromId || fromId === targetId) return;
    const next = [...rows];
    const from = next.findIndex((r) => r.id === fromId);
    const to   = next.findIndex((r) => r.id === targetId);
    if (from === -1 || to === -1) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRows(next);
    try {
      await api("/api/rows/reorder", { method: "POST", body: JSON.stringify({ order: next.map((r) => r.id) }) });
    } catch (e) { setErr(e.message); load(); }
  }, [draggingId, rows, load]);

  // ── 上下移动 ───────────────────────────────────────────────────────────────

  const moveRow = useCallback(async (rowId, dir) => {
    const idx = rows.findIndex((r) => r.id === rowId);
    const to  = idx + dir;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[idx], next[to]] = [next[to], next[idx]];
    setRows(next);
    try {
      await api("/api/rows/reorder", { method: "POST", body: JSON.stringify({ order: next.map((r) => r.id) }) });
    } catch (e) { setErr(e.message); load(); }
  }, [rows, load]);

  // ── 列 ─────────────────────────────────────────────────────────────────────

  const addColumn = async () => {
    try { await api("/api/columns", { method: "POST", body: JSON.stringify({ title: "新列" }) }); await load(); }
    catch (e) { setErr(e.message); }
  };
  const renameColumn = async (colId, title) => {
    try {
      await api(`/api/columns/${colId}`, { method: "PATCH", body: JSON.stringify({ title }) });
      setColumns((p) => p.map((c) => c.id === colId ? { ...c, title } : c));
    } catch (e) { setErr(e.message); }
  };
  const removeColumn = async (colId) => {
    const col = columns.find((c) => c.id === colId);
    if (!col) return;
    setColumns((p) => p.filter((c) => c.id !== colId));
    try {
      await api(`/api/columns/${colId}`, { method: "DELETE" });
      showToast(`已删除列「${col.title}」`, async () => {
        await api(`/api/columns/${colId}/restore`, { method: "POST" }); await load();
      });
    } catch (e) {
      setColumns((p) => [...p, col].sort((a, b) => a.position - b.position || a.id - b.id));
      setErr(e.message);
    }
  };

  // ── 行 ─────────────────────────────────────────────────────────────────────

  const addRow = async () => {
    try {
      await api("/api/rows", { method: "POST", body: JSON.stringify({ title: "" }) });
      const d = await api("/api/state");
      setColumns(d.columns || []); setRows(d.rows || []);
      const newRow = (d.rows || []).at(-1);
      if (newRow) setExpandedRows((p) => new Set([...p, newRow.id]));
    } catch (e) { setErr(e.message); }
  };
  const removeRow = async (rowId) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    setRows((p) => p.filter((r) => r.id !== rowId));
    setExpandedRows((p) => { const s = new Set(p); s.delete(rowId); return s; });
    try {
      await api(`/api/rows/${rowId}`, { method: "DELETE" });
      showToast(`已删除「${row.title?.trim() || "未命名账号"}」`, async () => {
        await api(`/api/rows/${rowId}/restore`, { method: "POST" }); await load();
      });
    } catch (e) {
      setRows((p) => [...p, row].sort((a, b) => a.position - b.position || a.id - b.id));
      setErr(e.message);
    }
  };
  const toggleExpand = useCallback(async (rowId) => {
    const wasExpanded = expandedRows.has(rowId);
    if (wasExpanded) await flushRowChanges(rowId);
    setExpandedRows((p) => { const s = new Set(p); s.has(rowId) ? s.delete(rowId) : s.add(rowId); return s; });
  }, [expandedRows, flushRowChanges]);

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-night-950 via-night-900 to-night-850 pb-10">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(45,212,191,0.12),transparent)]" />

      {/* 导航栏 */}
      <header className="relative z-10 border-b border-white/10 bg-night-900/80 px-4 py-4
                         backdrop-blur-xl pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mx-auto max-w-2xl flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-mint-500/90">
              Delta · 台账
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
              三角洲 · 账号管理表
            </h1>
          </div>
          <button onClick={openHistory}
                  className="flex items-center gap-1.5 rounded-xl border border-white/15
                             bg-white/5 px-3 py-2.5 text-xs font-medium text-slate-200
                             hover:bg-white/10 active:scale-95 transition">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none"
                 stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="10" cy="10" r="8" /><path d="M10 6v4l2.5 2.5" />
            </svg>
            历史记录
          </button>
        </div>
        {saving && (
          <p className="mx-auto mt-2 max-w-2xl text-xs text-mint-400/90">正在保存…</p>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-2xl px-4 py-5 space-y-4">

        {/* 错误提示 */}
        {err && (
          <div role="alert"
               className="flex items-start justify-between gap-3 rounded-xl border
                          border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            <span>{err}</span>
            <button onClick={() => setErr(null)} className="text-red-400/70 hover:text-red-200">×</button>
          </div>
        )}

        {/* 操作栏 */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={addRow}
                  className="flex-1 min-w-[8rem] min-h-11 rounded-xl bg-mint-500 px-4 text-sm
                             font-semibold text-night-950 shadow-glow hover:bg-mint-400 active:scale-[0.98]">
            ＋ 添加账号行
          </button>
          <button onClick={() => setColMgrOpen((p) => !p)}
                  className={`min-h-11 rounded-xl border px-4 text-sm font-medium transition
                              ${colMgrOpen
                                ? "border-mint-500/40 bg-mint-500/10 text-mint-300"
                                : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"}`}>
            列管理 {colMgrOpen ? "▲" : "▼"}
          </button>
          <button onClick={load}
                  className="min-h-11 rounded-xl border border-white/10 px-3
                             text-slate-400 hover:bg-white/5 transition">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none"
                 stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M17 10a7 7 0 1 1-1.5-4.33M17 3v4h-4" />
            </svg>
          </button>
        </div>

        {/* 列管理 */}
        {colMgrOpen && (
          <div className="rounded-2xl border border-white/10 bg-night-850/40 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              列管理 · 点名称重命名，× 删除（可撤销）
            </p>
            <div className="flex flex-wrap gap-2">
              {columns.map((col) => (
                <div key={col.id}
                     className="flex items-center gap-1 rounded-xl border border-white/15
                                bg-night-800/80 px-3 py-2">
                  <input
                    defaultValue={col.title}
                    key={`chip-${col.id}-${col.title}`}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== col.title) renameColumn(col.id, v); }}
                    className="w-16 bg-transparent text-sm text-white focus:outline-none
                               focus:w-24 transition-all"
                  />
                  <button onClick={() => removeColumn(col.id)}
                          className="text-slate-500 hover:text-red-300 text-base leading-none">×</button>
                </div>
              ))}
              <button onClick={addColumn}
                      className="flex items-center gap-1 rounded-xl border border-dashed
                                 border-white/20 px-3 py-2 text-sm text-slate-400
                                 hover:border-mint-500/40 hover:text-mint-400 transition">
                ＋ 添加列
              </button>
            </div>
          </div>
        )}

        {/* 提示 */}
        {!loading && rows.length > 0 && (
          <p className="text-center text-[11px] text-slate-600">
            <span className="hidden sm:inline">桌面：拖 ⠿ 手柄排序 · </span>
            <span className="sm:hidden">点「编辑」可排序和换颜色 · </span>
            点卡片进入编辑，可设置颜色
          </p>
        )}

        {/* 账号卡片 */}
        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border
                          border-white/10 bg-night-850/50">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-mint-500/30 border-t-mint-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 px-6 py-12 text-center">
            <p className="text-2xl">📋</p>
            <p className="mt-3 text-sm font-medium text-slate-300">还没有账号</p>
            <p className="mt-1 text-xs text-slate-500">点击「添加账号行」开始录入数据</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row, idx) => (
              <AccountCard
                key={row.id}
                row={row}
                columns={columns}
                isExpanded={expandedRows.has(row.id)}
                isFirst={idx === 0}
                isLast={idx === rows.length - 1}
                isDragging={draggingId === row.id}
                isDragOver={dragOverId === row.id}
                onToggleExpand={() => toggleExpand(row.id)}
                onDelete={removeRow}
                onMoveUp={() => moveRow(row.id, -1)}
                onMoveDown={() => moveRow(row.id, 1)}
                onRowTitleChange={onRowTitleChange}
                onRowTitleBlur={onRowTitleBlur}
                onCellChange={onCellChange}
                onCellBlur={onCellBlur}
                onColorChange={handleColorChange}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="relative z-10 mx-auto max-w-2xl px-4
                         pb-[max(2rem,env(safe-area-inset-bottom))]
                         text-center text-xs text-slate-600">
        数据保存在 SQLite · 仅手动编辑 · 删除 6 秒内可撤销 · 所有操作均有历史快照
      </footer>

      <ToastBar toasts={toasts} onUndo={handleUndo} onDismiss={dismissToast} />

      <HistoryPanel
        open={histOpen} items={histItems} loading={histLoading}
        restoring={restoring} snapIdBeingRestored={restoringId}
        onClose={() => setHistOpen(false)}
        onRestore={restoreSnapshot} onClear={clearHistory} onRefresh={loadHistory}
      />
    </div>
  );
}
