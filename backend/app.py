"""三角洲账号台账 API：列 / 行 / 单元格（含更新时间 & 软删除撤销）。"""

from __future__ import annotations

from datetime import datetime, timezone
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


@event.listens_for(Engine, "connect")
def _sqlite_enable_fk(dbapi_connection, connection_record):
    try:
        dbapi_connection.execute("PRAGMA foreign_keys=ON")
    except (AttributeError, OSError, TypeError, ValueError):
        pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SheetColumn(db.Model):
    __tablename__ = "sheet_column"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(128), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    deleted_at = db.Column(db.DateTime, nullable=True, default=None)


class SheetRow(db.Model):
    __tablename__ = "sheet_row"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(256), nullable=False, default="")
    title_updated_at = db.Column(db.DateTime, nullable=True)
    position = db.Column(db.Integer, nullable=False, default=0)
    deleted_at = db.Column(db.DateTime, nullable=True, default=None)


class Cell(db.Model):
    __tablename__ = "cell"
    id = db.Column(db.Integer, primary_key=True)
    row_id = db.Column(db.Integer, db.ForeignKey("sheet_row.id", ondelete="CASCADE"), nullable=False)
    column_id = db.Column(
        db.Integer, db.ForeignKey("sheet_column.id", ondelete="CASCADE"), nullable=False
    )
    value = db.Column(db.Text, nullable=False, default="")
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    __table_args__ = (db.UniqueConstraint("row_id", "column_id", name="uq_cell_row_col"),)


def _col_to_dict(c: SheetColumn) -> dict:
    return {"id": c.id, "title": c.title, "position": c.position}


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).isoformat()
    return dt.isoformat()


def _row_to_dict(r: SheetRow, cells: list[Cell]) -> dict:
    cell_map: dict[str, dict] = {}
    for cell in cells:
        cell_map[str(cell.column_id)] = {
            "value": cell.value,
            "updated_at": _iso(cell.updated_at),
        }
    return {
        "id": r.id,
        "title": r.title,
        "title_updated_at": _iso(r.title_updated_at),
        "position": r.position,
        "cells": cell_map,
    }


def build_state() -> dict:
    cols = (
        SheetColumn.query
        .filter(SheetColumn.deleted_at.is_(None))
        .order_by(SheetColumn.position, SheetColumn.id)
        .all()
    )
    rows = (
        SheetRow.query
        .filter(SheetRow.deleted_at.is_(None))
        .order_by(SheetRow.position, SheetRow.id)
        .all()
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


def seed_if_empty() -> None:
    if SheetColumn.query.filter(SheetColumn.deleted_at.is_(None)).first() is not None:
        return
    defaults = [("哈币", 0), ("仓库", 1), ("邮件", 2)]
    for title, pos in defaults:
        db.session.add(SheetColumn(title=title, position=pos))
    db.session.commit()


def ensure_schema() -> None:
    """SQLite：为已有库补齐新字段，幂等安全。"""
    with db.engine.begin() as conn:
        for table, column, typedef in [
            ("sheet_row", "title_updated_at", "DATETIME"),
            ("sheet_row", "deleted_at", "DATETIME"),
            ("sheet_column", "deleted_at", "DATETIME"),
        ]:
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            existing = {r[1] for r in rows}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {typedef}"))


@app.route("/api/health")
def health():
    return jsonify({"ok": True})


@app.route("/api/state", methods=["GET"])
def get_state():
    ensure_schema()
    seed_if_empty()
    return jsonify(build_state())


# ── 列操作 ──────────────────────────────────────────────────────────────────

@app.route("/api/columns", methods=["POST"])
def add_column():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "新列").strip()[:128]
    max_pos = db.session.scalar(db.select(db.func.max(SheetColumn.position))) or -1
    col = SheetColumn(title=title, position=max_pos + 1)
    db.session.add(col)
    db.session.commit()
    return jsonify(_col_to_dict(col)), 201


@app.route("/api/columns/<int:col_id>", methods=["PATCH"])
def patch_column(col_id: int):
    col = db.get_or_404(SheetColumn, col_id)
    data = request.get_json(silent=True) or {}
    if "title" in data:
        col.title = (data.get("title") or "").strip()[:128] or col.title
    db.session.commit()
    return jsonify(_col_to_dict(col))


@app.route("/api/columns/<int:col_id>", methods=["DELETE"])
def delete_column(col_id: int):
    """软删除列，保留数据以支持撤销。"""
    col = db.get_or_404(SheetColumn, col_id)
    col.deleted_at = utcnow()
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/columns/<int:col_id>/restore", methods=["POST"])
def restore_column(col_id: int):
    col = db.session.get(SheetColumn, col_id)
    if not col:
        return jsonify({"error": "列不存在"}), 404
    col.deleted_at = None
    db.session.commit()
    return jsonify(_col_to_dict(col))


# ── 行操作 ──────────────────────────────────────────────────────────────────

@app.route("/api/rows", methods=["POST"])
def add_row():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()[:256]
    max_pos = db.session.scalar(db.select(db.func.max(SheetRow.position))) or -1
    row = SheetRow(title=title, position=max_pos + 1)
    db.session.add(row)
    db.session.commit()
    return jsonify(_row_to_dict(row, [])), 201


@app.route("/api/rows/<int:row_id>", methods=["PATCH"])
def patch_row(row_id: int):
    row = db.get_or_404(SheetRow, row_id)
    data = request.get_json(silent=True) or {}
    if "title" in data:
        new_title = (data.get("title") or "").strip()[:256]
        if new_title != row.title:
            row.title = new_title
            row.title_updated_at = utcnow()
    db.session.commit()
    cells = Cell.query.filter_by(row_id=row.id).all()
    return jsonify(_row_to_dict(row, cells))


@app.route("/api/rows/<int:row_id>", methods=["DELETE"])
def delete_row(row_id: int):
    """软删除行，保留单元格数据以支持撤销。"""
    row = db.get_or_404(SheetRow, row_id)
    row.deleted_at = utcnow()
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/rows/<int:row_id>/restore", methods=["POST"])
def restore_row(row_id: int):
    row = db.session.get(SheetRow, row_id)
    if not row:
        return jsonify({"error": "行不存在"}), 404
    row.deleted_at = None
    db.session.commit()
    cells = Cell.query.filter_by(row_id=row.id).all()
    return jsonify(_row_to_dict(row, cells))


# ── 单元格操作 ───────────────────────────────────────────────────────────────

@app.route("/api/cells", methods=["PATCH"])
def patch_cell():
    data = request.get_json(silent=True) or {}
    try:
        row_id = int(data["row_id"])
        column_id = int(data["column_id"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "需要 row_id 与 column_id"}), 400
    value = data.get("value")
    if value is None:
        value = ""
    if not isinstance(value, str):
        value = str(value)
    value = value[:20000]

    row = db.session.get(SheetRow, row_id)
    col = db.session.get(SheetColumn, column_id)
    if not row or not col:
        return jsonify({"error": "行或列不存在"}), 404

    cell = Cell.query.filter_by(row_id=row_id, column_id=column_id).first()
    now = utcnow()
    if cell is None:
        if value == "":
            return jsonify({"row_id": row_id, "column_id": column_id, "value": "", "updated_at": None})
        cell = Cell(row_id=row_id, column_id=column_id, value=value, updated_at=now)
        db.session.add(cell)
    else:
        if cell.value == value:
            return jsonify(
                {"row_id": row_id, "column_id": column_id, "value": cell.value, "updated_at": _iso(cell.updated_at)}
            )
        cell.value = value
        cell.updated_at = now
    db.session.commit()
    return jsonify(
        {"row_id": row_id, "column_id": column_id, "value": cell.value, "updated_at": _iso(cell.updated_at)}
    )


# ── 静态文件托管（生产） ────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path: str):
    if not FRONTEND_DIST.is_dir():
        return jsonify({"message": "开发请运行前端 npm run dev，或先构建 frontend/dist"}), 503
    if path:
        target = FRONTEND_DIST / path
        try:
            target.resolve().relative_to(FRONTEND_DIST.resolve())
        except ValueError:
            return jsonify({"error": "Invalid path"}), 400
        if target.is_file():
            return send_from_directory(FRONTEND_DIST, path)
    return send_from_directory(FRONTEND_DIST, "index.html")


def init_db():
    with app.app_context():
        db.create_all()
        ensure_schema()
        seed_if_empty()


with app.app_context():
    db.create_all()
    ensure_schema()
    seed_if_empty()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5003, debug=True)
