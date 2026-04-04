#!/usr/bin/env python3
"""
一次性账号数据导入脚本。
运行方式：cd backend && python seed_accounts.py
警告：会清空当前所有列、行、单元格和历史快照，重新导入。
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import text

from app import Cell, HistorySnapshot, SheetColumn, SheetRow, app, db, take_snapshot

# ── 列定义 ────────────────────────────────────────────────────────────────────
COLUMNS = ["哈币", "仓库", "领取记录", "备注"]

# ── 账号数据 ──────────────────────────────────────────────────────────────────
ACCOUNTS = [
    {
        "name": "小白",
        "哈币": "1100w",
        "仓库": "7个5甲\n3个6甲",
        "领取记录": "茶米\n万金",
        "备注": "【子弹潜力号】\n平板：有券要过期，700w",
    },
    {
        "name": "ddd柯贝贝",
        "哈币": "1500w",
        "仓库": "1件5套\n2个6头\n2个6甲\n咖啡豆",
        "领取记录": "茶米\n藏花",
        "备注": "平板：没有3.3",
    },
    {
        "name": "季度",
        "哈币": "800w",
        "仓库": "全干员\n7件6甲",
        "领取记录": "红皮\n锦绣\n万金\n女医皮肤",
        "备注": "平板：有券要过期，没钱只有100多w",
    },
    {
        "name": "杰哥猫头",
        "哈币": "4000w",
        "仓库": "2个6甲\n3个100耐以上破6甲\n2个红包\n一些破6头\n4个5甲",
        "领取记录": "黑枪皮\n红枪皮\n女医皮肤",
        "备注": "平板：邮件都弄完了，没有红包",
    },
    {
        "name": "大号",
        "哈币": "7000w",
        "仓库": "好多9.19\n10发aw\n60发7.62\n2个6头\n2个6甲\n赛季定制1\n特种4\n精锐6+",
        "领取记录": "黑色枪皮\n锦绣枪皮\n女医\n露娜",
        "备注": "平板：没有红包，邮件里有个精锐要过期",
    },
    {
        "name": "皮肤号",
        "哈币": "4600w",
        "仓库": "体力满级\n许多4级甲修\n3个6甲\n1个135泰坦\n3个5甲\n2张特种\n精锐>5",
        "领取记录": "茶米\n万金捆绑包\n女医",
        "备注": "",
    },
    {
        "name": "臭屁股大号",
        "哈币": "1600w",
        "仓库": "1个6甲\n2个咖啡豆\n2个特种\n4个6套礼包",
        "领取记录": "春节3个枪皮肤全领\n女医",
        "备注": "平板（臭屁股）",
    },
    {
        "name": "臭屁股小号",
        "哈币": "0w",
        "仓库": "2个6头\n1个6甲\n3发aw",
        "领取记录": "枪皮\n女医",
        "备注": "",
    },
    {
        "name": "微信号",
        "哈币": "200w",
        "仓库": "5发aw\n5发7.62×51\n60发6.8×51\n1个特种",
        "领取记录": "万金\n锦绣",
        "备注": "",
    },
    {
        "name": "呆呆",
        "哈币": "1700w",
        "仓库": "1个6甲\n2个6头\n全干员解锁",
        "领取记录": "粉色枪皮",
        "备注": "2025.01.02 统一修改了密码",
    },
    {
        "name": "理包",
        "哈币": "0w",
        "仓库": "好多的金包",
        "领取记录": "新春三个枪皮",
        "备注": "【子弹潜力号】\n2025.01.02 统一修改了密码",
    },
    {
        "name": "芯核",
        "哈币": "1100w",
        "仓库": "3个6甲\n1个6头",
        "领取记录": "蛇皮\n茶米",
        "备注": "2025.01.02 统一修改了密码\n平板：有券要过期",
    },
    {
        "name": "杰哥最小号",
        "哈币": "2200w",
        "仓库": "2个6头\n2个6甲",
        "领取记录": "黑皮\n万金\n女医",
        "备注": "2025.01.02 统一修改了密码",
    },
]


def run():
    now = datetime.now(timezone.utc)
    with app.app_context():
        print("▶ 清空旧数据（历史快照、单元格、行、列）……")
        db.session.execute(text("DELETE FROM history_snapshot"))
        db.session.execute(text("DELETE FROM cell"))
        db.session.execute(text("DELETE FROM sheet_row"))
        db.session.execute(text("DELETE FROM sheet_column"))
        db.session.commit()

        print(f"▶ 创建 {len(COLUMNS)} 个列……")
        col_id: dict[str, int] = {}
        for pos, name in enumerate(COLUMNS):
            col = SheetColumn(title=name, position=pos)
            db.session.add(col)
            db.session.flush()
            col_id[name] = col.id
        db.session.commit()
        print(f"   列 ID 映射：{col_id}")

        print(f"▶ 导入 {len(ACCOUNTS)} 个账号……")
        for pos, acct in enumerate(ACCOUNTS):
            row = SheetRow(title=acct["name"], position=pos)
            db.session.add(row)
            db.session.flush()

            for col_name in COLUMNS:
                val = acct.get(col_name, "").strip()
                if val:
                    cell = Cell(
                        row_id=row.id,
                        column_id=col_id[col_name],
                        value=val,
                        updated_at=now,
                    )
                    db.session.add(cell)

            print(f"   [{pos+1:02d}] {acct['name']}")

        db.session.commit()

        print("▶ 记录初始历史快照……")
        take_snapshot("数据导入", f"批量导入 {len(ACCOUNTS)} 个账号（初始数据）")

        print(f"\n✅ 导入完成！共 {len(ACCOUNTS)} 行，{len(COLUMNS)} 列。")
        print("   列名：" + " · ".join(COLUMNS))


if __name__ == "__main__":
    run()
