"""三角洲账号台账 API：列 / 行 / 单元格（含软删除、更新时间、历史快照回滚）。"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event, text
from sqlalchemy.engine import Engine

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
DB_PATH = BASE_DIR / "delta_ledger.db"

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DB_PATH}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
CORS(app, resources={r"/api/*": {"origins": "*"}})

db = SQLAlchemy(app)

# 每个格子至多每 5 分钟记录一次快照（避免频繁编辑产生大量历史）
CELL_SNAP_COOLDOWN = timedelta(minutes=5)
MAX_HISTORY = 80  # 最多保留的快照数量
_last_cell_snap: dict[tuple[int, int], datetime] = {}


# ── 事件：开启 SQLite 外键 ────────────────────────────────────────────────────

@event.listens_for(Engine, "connect")
def _sqlite_enable_fk(dbapi_connection, connection_record):
    try:
        dbapi_connection.execute("PRAGMA foreign_keys=ON")
    except (AttributeError, OSError, TypeError, ValueError):
        pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── 数据模型 ─────────────────────────────────────────────────────────────────

class SheetColumn(db.Model):
    __tablename__ = "sheet_column"
    id         = db.Column(db.Integer, primary_key=True)
    title      = db.Column(db.String(128), nullable=False)
    position   = db.Column(db.Integer, nullable=False, default=0)
    deleted_at = db.Column(db.DateTime, nullable=True, default=None)


class SheetRow(db.Model):
    __tablename__ = "sheet_row"
    id               = db.Column(db.Integer, primary_key=True)
    title            = db.Column(db.String(256), nullable=False, default="")
    title_updated_at = db.Column(db.DateTime, nullable=True)
    position         = db.Column(db.Integer, nullable=False, default=0)
    color            = db.Column(db.String(32),  nullable=True, default=None)
    deleted_at       = db.Column(db.DateTime, nullable=True, default=None)


class Cell(db.Model):
    __tablename__ = "cell"
    id         = db.Column(db.Integer, primary_key=True)
    row_id     = db.Column(db.Integer, db.ForeignKey("sheet_row.id",    ondelete="CASCADE"), nullable=False)
    column_id  = db.Column(db.Integer, db.ForeignKey("sheet_column.id", ondelete="CASCADE"), nullable=False)
    value      = db.Column(db.Text, nullable=False, default="")
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    __table_args__ = (db.UniqueConstraint("row_id", "column_id", name="uq_cell_row_col"),)


class HistorySnapshot(db.Model):
    __tablename__ = "history_snapshot"
    id            = db.Column(db.Integer, primary_key=True)
    operation     = db.Column(db.String(64),  nullable=False)
    description   = db.Column(db.String(512), nullable=False, default="")
    snapshot_json = db.Column(db.Text, nullable=False)
    created_at    = db.Column(db.DateTime, nullable=False, default=utcnow)


# ── 序列化辅助 ────────────────────────────────────────────────────────────────

def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt.tzinfo is None else dt.isoformat()


def _col_to_dict(c: SheetColumn) -> dict:
    return {"id": c.id, "title": c.title, "position": c.position}


def _row_to_dict(r: SheetRow, cells: list[Cell]) -> dict:
    cell_map: dict[str, dict] = {}
    latest = r.title_updated_at  # 账号名最后修改时间，可能为 None
    for cell in cells:
        cell_map[str(cell.column_id)] = {"value": cell.value, "updated_at": _iso(cell.updated_at)}
        if cell.updated_at and (latest is None or cell.updated_at > latest):
            latest = cell.updated_at
    return {
        "id": r.id,
        "title": r.title,
        "title_updated_at": _iso(r.title_updated_at),
        "last_updated_at": _iso(latest),  # 账号下任意内容最后修改时间
        "position": r.position,
        "color": r.color,
        "cells": cell_map,
    }


def build_state() -> dict:
    cols = (
        SheetColumn.query
        .filter(SheetColumn.deleted_at.is_(None))
        .order_by(SheetColumn.position, SheetColumn.id).all()
    )
    rows = (
        SheetRow.query
        .filter(SheetRow.deleted_at.is_(None))
        .order_by(SheetRow.position, SheetRow.id).all()
    )
    row_ids = [r.id for r in rows]
    col_ids = {c.id for c in cols}
    cells: list[Cell] = []
    if row_ids:
        cells = Cell.query.filter(Cell.row_id.in_(row_ids)).all()
    by_row: dict[int, list[Cell]] = {rid: [] for rid in row_ids}
    for c in cells:
        if c.column_id in col_ids:
            by_row.setdefault(c.row_id, []).append(c)
    return {
        "columns": [_col_to_dict(c) for c in cols],
        "rows": [_row_to_dict(r, by_row.get(r.id, [])) for r in rows],
    }


# ── 历史快照 ──────────────────────────────────────────────────────────────────

def take_snapshot(operation: str, description: str = "") -> None:
    """记录当前完整状态快照，自动裁剪超出上限的旧快照。"""
    try:
        state = build_state()
        snap = HistorySnapshot(
            operation=operation,
            description=description,
            snapshot_json=json.dumps(state, ensure_ascii=False),
            created_at=utcnow(),
        )
        db.session.add(snap)
        # 超出上限时删除最旧的几条
        count = HistorySnapshot.query.count()
        if count >= MAX_HISTORY:
            oldest_ids = (
                db.session.execute(
                    db.select(HistorySnapshot.id)
                    .order_by(HistorySnapshot.id.asc())
                    .limit(count - MAX_HISTORY + 1)
                ).scalars().all()
            )
            if oldest_ids:
                HistorySnapshot.query.filter(HistorySnapshot.id.in_(oldest_ids)).delete(
                    synchronize_session=False
                )
        db.session.commit()
    except Exception:
        db.session.rollback()


def should_snap_cell(row_id: int, col_id: int) -> bool:
    """单元格编辑：同一格 5 分钟内只记录一次快照。"""
    key = (row_id, col_id)
    now = utcnow()
    last = _last_cell_snap.get(key)
    if last is None or (now - last) > CELL_SNAP_COOLDOWN:
        _last_cell_snap[key] = now
        return True
    return False


# ── 初始化 ───────────────────────────────────────────────────────────────────

def seed_if_empty() -> None:
    if SheetColumn.query.filter(SheetColumn.deleted_at.is_(None)).first() is not None:
        return
    defaults = [("哈币", 0), ("仓库", 1), ("邮件", 2)]
    for title, pos in defaults:
        db.session.add(SheetColumn(title=title, position=pos))
    db.session.commit()
    take_snapshot("初始化", "数据库首次初始化，默认创建哈币、仓库、邮件三列")


def ensure_schema() -> None:
    """为旧数据库补齐新字段，幂等安全。"""
    with db.engine.begin() as conn:
        for table, column, typedef in [
            ("sheet_row",    "title_updated_at", "DATETIME"),
            ("sheet_row",    "deleted_at",        "DATETIME"),
            ("sheet_row",    "color",             "VARCHAR(32)"),
            ("sheet_column", "deleted_at",        "DATETIME"),
        ]:
            existing = {r[1] for r in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {typedef}"))


# ── 基础接口 ─────────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    return jsonify({"ok": True})


@app.route("/api/state", methods=["GET"])
def get_state():
    ensure_schema()
    seed_if_empty()
    state = build_state()
    # 首次加载时若还没有任何快照，补一条初始快照
    if HistorySnapshot.query.count() == 0:
        take_snapshot("初始化", "首次加载数据")
    return jsonify(state)


# ── 列操作 ───────────────────────────────────────────────────────────────────

@app.route("/api/columns", methods=["POST"])
def add_column():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "新列").strip()[:128]
    max_pos = db.session.scalar(db.select(db.func.max(SheetColumn.position))) or -1
    col = SheetColumn(title=title, position=max_pos + 1)
    db.session.add(col)
    db.session.commit()
    take_snapshot("新增列", f"新增列「{title}」")
    return jsonify(_col_to_dict(col)), 201


@app.route("/api/columns/<int:col_id>", methods=["PATCH"])
def patch_column(col_id: int):
    col = db.get_or_404(SheetColumn, col_id)
    data = request.get_json(silent=True) or {}
    old_title = col.title
    if "title" in data:
        new_title = (data.get("title") or "").strip()[:128]
        if new_title and new_title != old_title:
            col.title = new_title
            db.session.commit()
            take_snapshot("重命名列", f"列「{old_title}」→「{new_title}」")
            return jsonify(_col_to_dict(col))
    db.session.commit()
    return jsonify(_col_to_dict(col))


@app.route("/api/columns/<int:col_id>", methods=["DELETE"])
def delete_column(col_id: int):
    col = db.get_or_404(SheetColumn, col_id)
    title = col.title
    col.deleted_at = utcnow()
    db.session.commit()
    take_snapshot("删除列", f"删除列「{title}」（可在历史中恢复）")
    return jsonify({"ok": True})


@app.route("/api/columns/<int:col_id>/restore", methods=["POST"])
def restore_column(col_id: int):
    col = db.session.get(SheetColumn, col_id)
    if not col:
        return jsonify({"error": "列不存在"}), 404
    col.deleted_at = None
    db.session.commit()
    take_snapshot("恢复列", f"恢复列「{col.title}」")
    return jsonify(_col_to_dict(col))


# ── 行操作 ───────────────────────────────────────────────────────────────────

@app.route("/api/rows", methods=["POST"])
def add_row():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()[:256]
    max_pos = db.session.scalar(db.select(db.func.max(SheetRow.position))) or -1
    row = SheetRow(title=title, position=max_pos + 1)
    db.session.add(row)
    db.session.commit()
    take_snapshot("新增行", f"新增账号行「{title or '（未命名）'}」")
    return jsonify(_row_to_dict(row, [])), 201


@app.route("/api/rows/<int:row_id>", methods=["PATCH"])
def patch_row(row_id: int):
    row = db.get_or_404(SheetRow, row_id)
    data = request.get_json(silent=True) or {}
    changed = False

    if "title" in data:
        new_title = (data.get("title") or "").strip()[:256]
        if new_title != row.title:
            old_title = row.title
            row.title = new_title
            row.title_updated_at = utcnow()
            changed = ("title", old_title, new_title)

    if "color" in data:
        new_color = data.get("color")
        if new_color not in (None, "mint", "sky", "emerald", "amber", "orange", "rose", "violet", "red"):
            new_color = None
        row.color = new_color

    db.session.commit()

    if changed:
        old_title, new_title = changed[1], changed[2]
        take_snapshot("修改账号名", f"账号名「{old_title or '（空）'}」→「{new_title}」")

    cells = Cell.query.filter_by(row_id=row.id).all()
    return jsonify(_row_to_dict(row, cells))


@app.route("/api/rows/reorder", methods=["POST"])
def reorder_rows():
    """批量更新行顺序，body: {"order": [id, id, ...]}"""
    data = request.get_json(silent=True) or {}
    order = data.get("order", [])
    if not isinstance(order, list) or not order:
        return jsonify({"error": "order 必须是非空数组"}), 400
    for pos, row_id in enumerate(order):
        row = db.session.get(SheetRow, int(row_id))
        if row:
            row.position = pos
    db.session.commit()
    take_snapshot("调整顺序", f"重新排列了 {len(order)} 个账号的顺序")
    return jsonify({"ok": True})


@app.route("/api/rows/<int:row_id>", methods=["DELETE"])
def delete_row(row_id: int):
    row = db.get_or_404(SheetRow, row_id)
    title = row.title
    row.deleted_at = utcnow()
    db.session.commit()
    take_snapshot("删除行", f"删除账号行「{title or '（未命名）'}」（可在历史中恢复）")
    return jsonify({"ok": True})


@app.route("/api/rows/<int:row_id>/restore", methods=["POST"])
def restore_row(row_id: int):
    row = db.session.get(SheetRow, row_id)
    if not row:
        return jsonify({"error": "行不存在"}), 404
    row.deleted_at = None
    db.session.commit()
    cells = Cell.query.filter_by(row_id=row.id).all()
    take_snapshot("恢复行", f"恢复账号行「{row.title or '（未命名）'}」")
    return jsonify(_row_to_dict(row, cells))


# ── 单元格操作 ───────────────────────────────────────────────────────────────

@app.route("/api/cells", methods=["PATCH"])
def patch_cell():
    data = request.get_json(silent=True) or {}
    try:
        row_id    = int(data["row_id"])
        column_id = int(data["column_id"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "需要 row_id 与 column_id"}), 400

    value = data.get("value") or ""
    if not isinstance(value, str):
        value = str(value)
    value = value[:20000]

    row = db.session.get(SheetRow, row_id)
    col = db.session.get(SheetColumn, column_id)
    if not row or not col:
        return jsonify({"error": "行或列不存在"}), 404

    cell = Cell.query.filter_by(row_id=row_id, column_id=column_id).first()
    now  = utcnow()

    if cell is None:
        if value == "":
            return jsonify({"row_id": row_id, "column_id": column_id, "value": "", "updated_at": None})
        old_val = ""
        cell = Cell(row_id=row_id, column_id=column_id, value=value, updated_at=now)
        db.session.add(cell)
    else:
        if cell.value == value:
            return jsonify({"row_id": row_id, "column_id": column_id,
                            "value": cell.value, "updated_at": _iso(cell.updated_at)})
        old_val   = cell.value
        cell.value      = value
        cell.updated_at = now

    db.session.commit()

    if should_snap_cell(row_id, column_id):
        old_s = (old_val[:18] + "…") if len(old_val) > 18 else old_val
        new_s = (value[:18]   + "…") if len(value)   > 18 else value
        row_label = row.title or "（未命名）"
        take_snapshot(
            "修改单元格",
            f"「{row_label}」/「{col.title}」：{old_s!r} → {new_s!r}",
        )

    return jsonify({"row_id": row_id, "column_id": column_id,
                    "value": cell.value, "updated_at": _iso(cell.updated_at)})


# ── 历史快照 API ──────────────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
def list_history():
    snaps = (
        HistorySnapshot.query
        .order_by(HistorySnapshot.id.desc())
        .all()
    )
    items = [
        {
            "id":          s.id,
            "operation":   s.operation,
            "description": s.description,
            "created_at":  _iso(s.created_at),
        }
        for s in snaps
    ]
    return jsonify({"items": items, "total": len(items)})


@app.route("/api/history/<int:snap_id>/restore", methods=["POST"])
def restore_snapshot(snap_id: int):
    """将整个数据库状态回滚到指定快照，并留存当前状态作新快照。"""
    snap = db.session.get(HistorySnapshot, snap_id)
    if not snap:
        return jsonify({"error": "快照不存在"}), 404

    state = json.loads(snap.snapshot_json)

    # ① 先备份当前状态（让用户可以"撤销回滚"）
    take_snapshot("回滚前备份", f"回滚前的状态备份（即将回滚到：{snap.description or snap.operation}）")

    # ② 清空当前活跃数据（保留历史快照表不动）
    db.session.execute(text("DELETE FROM cell"))
    db.session.execute(text("DELETE FROM sheet_row"))
    db.session.execute(text("DELETE FROM sheet_column"))
    db.session.commit()

    # ③ 从快照重建数据（保留原始 ID，以便 cell 外键正确）
    for col in state.get("columns", []):
        db.session.execute(
            text("INSERT INTO sheet_column (id, title, position, deleted_at) "
                 "VALUES (:id, :title, :position, NULL)"),
            {"id": col["id"], "title": col["title"], "position": col["position"]},
        )

    for row in state.get("rows", []):
        db.session.execute(
            text("INSERT INTO sheet_row (id, title, title_updated_at, position, deleted_at) "
                 "VALUES (:id, :title, :tua, :position, NULL)"),
            {"id": row["id"], "title": row["title"],
             "tua": row.get("title_updated_at"), "position": row["position"]},
        )
        for col_id_str, cell in row.get("cells", {}).items():
            db.session.execute(
                text("INSERT INTO cell (row_id, column_id, value, updated_at) "
                     "VALUES (:row_id, :col_id, :value, :updated_at)"),
                {"row_id": row["id"], "col_id": int(col_id_str),
                 "value": cell["value"], "updated_at": cell.get("updated_at")},
            )

    db.session.commit()

    # ④ 记录本次回滚
    snap_time = _iso(snap.created_at) or ""
    take_snapshot("回滚", f"回滚到「{snap.description or snap.operation}」（原记录于 {snap_time[:16].replace('T',' ')} UTC）")

    return jsonify({"ok": True, "state": build_state()})


@app.route("/api/history", methods=["DELETE"])
def clear_history():
    HistorySnapshot.query.delete(synchronize_session=False)
    db.session.commit()
    return jsonify({"ok": True})


# ── 静态文件托管（生产） ────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path: str):
    if not FRONTEND_DIST.is_dir():
        return jsonify({"message": "开发：npm run dev；生产：先 npm run build"}), 503
    if path:
        target = FRONTEND_DIST / path
        try:
            target.resolve().relative_to(FRONTEND_DIST.resolve())
        except ValueError:
            return jsonify({"error": "Invalid path"}), 400
        if target.is_file():
            return send_from_directory(FRONTEND_DIST, path)
    return send_from_directory(FRONTEND_DIST, "index.html")


# ── 启动初始化 ────────────────────────────────────────────────────────────────

with app.app_context():
    db.create_all()
    ensure_schema()
    seed_if_empty()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5003, debug=True)
