# 三角洲 · 账号台账

一个手机友好的多账号数据管理网站，用卡片折叠形式记录每个三角洲账号的哈币、仓库、领取记录等信息，每次修改自动记录更新时间，支持历史快照随时回滚。

## 功能特性

- **卡片折叠视图**：默认展示全部账号信息，点击「编辑」展开输入框，无需横向滑动
- **多账号管理**：每张卡片对应一个账号，所有字段一屏纵向展示
- **完全手动填写**：不对接任何第三方接口，数据由用户自行录入
- **更新时间追踪**：每个格子修改后独立记录「更新于 年月日 时:分」
- **值不变不刷时间**：内容与库里相同时跳过，不误触更新时间戳
- **自动保存**：停止输入 0.55 秒或失焦时自动保存，无需手动点按钮
- **软删除 + 撤销**：删除行/列后底部 Toast 6 秒内可撤销
- **历史快照回滚**：每次操作自动保存完整快照，可在「历史记录」面板一键回滚到任意时间点
- **自由扩展列**：可随时添加、重命名、删除列
- **手机端适配**：全面屏安全区、≥44px 点击区域，一屏纵览所有账号

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 18 + Vite 6 + Tailwind CSS 3 |
| 后端 | Python / Flask 3 + Flask-SQLAlchemy |
| 数据库 | SQLite（本地单文件，零配置） |

## 目录结构

```
web_delta_operation/
├── backend/
│   ├── app.py              # Flask API 服务
│   ├── seed_accounts.py    # 一次性账号数据导入脚本
│   ├── requirements.txt    # Python 依赖
│   └── delta_ledger.db     # SQLite 数据库（运行后自动生成）
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # 主界面组件（卡片折叠 + 历史面板）
│   │   ├── main.jsx        # React 入口
│   │   └── index.css       # Tailwind 基础样式 + Toast 动画
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
└── README.md
```

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+

### 开发模式（前后端分离热更新）

**第一步：启动后端**

```bash
cd backend
pip install -r requirements.txt
python app.py
# 监听 http://127.0.0.1:5000
```

**第二步：启动前端**

```bash
cd frontend
npm install
npm run dev
# 浏览器打开 http://localhost:5173
```

Vite 已配置 `/api` 代理到后端 5000 端口，开发时无需跨域处理。

### 生产模式（Flask 托管静态文件）

```bash
# 构建前端
cd frontend
npm install
npm run build   # 输出到 frontend/dist/

# 启动后端（同时托管前端）
cd ../backend
python app.py
# 访问 http://服务器IP:5000
```

如需修改端口，编辑 `backend/app.py` 最后一行：

```python
app.run(host="0.0.0.0", port=5000, debug=False)
```

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 获取全部列与行（含单元格） |
| GET | `/api/health` | 健康检查 |
| POST | `/api/columns` | 新增列 |
| PATCH | `/api/columns/:id` | 重命名列 |
| DELETE | `/api/columns/:id` | 软删除列 |
| POST | `/api/columns/:id/restore` | 恢复已删除的列 |
| POST | `/api/rows` | 新增账号行 |
| PATCH | `/api/rows/:id` | 修改账号名（自动更新 `title_updated_at`） |
| DELETE | `/api/rows/:id` | 软删除行（数据保留，可恢复） |
| POST | `/api/rows/:id/restore` | 恢复已删除的行 |
| PATCH | `/api/cells` | 保存格子内容（仅内容变化时刷新 `updated_at`） |
| GET | `/api/history` | 获取历史快照列表 |
| POST | `/api/history/:id/restore` | 回滚到指定快照 |
| DELETE | `/api/history` | 清空所有历史快照 |

## 数据库说明

数据库文件为 `backend/delta_ledger.db`，SQLite 单文件，直接复制即可备份。

四张表：

| 表名 | 说明 | 关键字段 |
|---|---|---|
| `sheet_column` | 列定义 | id、title、position、deleted_at |
| `sheet_row` | 账号行 | id、title（账号名）、title_updated_at、position、deleted_at |
| `cell` | 单元格 | row_id、column_id、value、updated_at |
| `history_snapshot` | 历史快照 | id、operation、description、snapshot_json、created_at |

`deleted_at` 非空表示已软删除（可通过「撤销」或历史面板恢复）。

新版本首次启动会自动执行 `ALTER TABLE` 补齐新字段，旧数据库无需手动迁移。

---

## 数据库直接查询（SQLite CLI）

> 数据库文件路径：`backend/delta_ledger.db`

### 进入交互式命令行

```bash
cd backend
sqlite3 delta_ledger.db
```

进入后可输入 `.help` 查看帮助，`.quit` 退出。

### 常用查询

**列出所有账号名及哈币**

```sql
SELECT sr.title AS 账号,
       MAX(CASE WHEN sc.title='哈币' THEN c.value END) AS 哈币
FROM sheet_row sr
LEFT JOIN cell c ON c.row_id = sr.id
LEFT JOIN sheet_column sc ON sc.id = c.column_id
WHERE sr.deleted_at IS NULL
GROUP BY sr.id, sr.title
ORDER BY sr.position;
```

**查看某个账号的全部数据**

```sql
SELECT sc.title AS 字段, c.value AS 内容, c.updated_at AS 更新时间
FROM cell c
JOIN sheet_row    sr ON sr.id = c.row_id
JOIN sheet_column sc ON sc.id = c.column_id
WHERE sr.title = '大号'
  AND sr.deleted_at IS NULL
ORDER BY sc.position;
```

**搜索仓库中含有某件物品的账号**

```sql
SELECT sr.title AS 账号, c.value AS 仓库内容
FROM cell c
JOIN sheet_row    sr ON sr.id = c.row_id
JOIN sheet_column sc ON sc.id = c.column_id
WHERE sc.title = '仓库'
  AND c.value LIKE '%6甲%'
  AND sr.deleted_at IS NULL;
```

**搜索已领取某皮肤的账号**

```sql
SELECT sr.title AS 账号, c.value AS 领取记录
FROM cell c
JOIN sheet_row    sr ON sr.id = c.row_id
JOIN sheet_column sc ON sc.id = c.column_id
WHERE sc.title = '领取记录'
  AND c.value LIKE '%女医%'
  AND sr.deleted_at IS NULL;
```

**查看最近 20 条历史快照**

```sql
SELECT id, operation, description,
       datetime(created_at, 'localtime') AS 时间
FROM history_snapshot
ORDER BY id DESC
LIMIT 20;
```

**统计各账号数据量（格子数）**

```sql
SELECT sr.title AS 账号, COUNT(c.id) AS 填写格数
FROM sheet_row sr
LEFT JOIN cell c ON c.row_id = sr.id
WHERE sr.deleted_at IS NULL
GROUP BY sr.id
ORDER BY 填写格数 DESC;
```

### 常用 SQLite 元命令

| 命令 | 说明 |
|---|---|
| `.tables` | 列出所有表 |
| `.schema sheet_row` | 查看某张表的建表语句 |
| `.headers on` | 查询时显示列名 |
| `.mode column` | 对齐列宽展示 |
| `.mode csv` | 以 CSV 格式输出 |
| `.output data.csv` | 将后续查询输出到文件 |
| `.output stdout` | 恢复输出到终端 |
| `.quit` | 退出 |

### 导出全部数据为 CSV

```bash
sqlite3 -header -csv backend/delta_ledger.db \
  "SELECT sr.title AS 账号,
          MAX(CASE WHEN sc.title='哈币'   THEN c.value END) AS 哈币,
          MAX(CASE WHEN sc.title='仓库'   THEN c.value END) AS 仓库,
          MAX(CASE WHEN sc.title='领取记录' THEN c.value END) AS 领取记录,
          MAX(CASE WHEN sc.title='备注'   THEN c.value END) AS 备注
   FROM sheet_row sr
   LEFT JOIN cell c ON c.row_id = sr.id
   LEFT JOIN sheet_column sc ON sc.id = c.column_id
   WHERE sr.deleted_at IS NULL
   GROUP BY sr.id ORDER BY sr.position;" \
> accounts_export.csv
echo "已导出到 accounts_export.csv"
```

### 重新导入初始数据

如需重置数据库并重新导入所有账号：

```bash
cd backend
python seed_accounts.py
```

> ⚠️ 此操作会**清空所有现有数据和历史快照**，慎用。

---

## 默认列

当前数据库列：**哈币、仓库、领取记录、备注**。

账号名不占列，固定显示在卡片顶部。可在「列管理」中随时添加、重命名或删除列。

## 备份与迁移

```bash
# 备份
cp backend/delta_ledger.db delta_ledger.db.bak

# 迁移到新机器：复制 delta_ledger.db 到目标机器同路径即可
```

## 后台运行（screen）

使用 `screen` 可将前后端进程挂到后台，断开 SSH 后服务继续运行。

### 安装

```bash
apt install screen
```

### 启动后端

```bash
screen -S backend
cd /root/clone_github/web_delta_operation/backend
python app.py
# 按 Ctrl+A 然后 D 分离，程序继续后台运行
```

### 启动前端（开发模式）

```bash
screen -S frontend
cd /root/clone_github/web_delta_operation/frontend
npm run dev
# 按 Ctrl+A 然后 D 分离
```

### 常用 screen 指令

| 指令 | 说明 |
|------|------|
| `screen -ls` | 列出所有会话 |
| `screen -r backend` | 重新连接到 backend 会话 |
| `screen -D -r backend` | 强制重新连接（会话被占用时）|
| `screen -S backend -X quit` | 从外部终止指定会话 |

### 会话内快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+A` `D` | 分离会话（程序继续运行）|
| `Ctrl+A` `K` | 杀死当前窗口 |
| `Ctrl+A` `[` | 进入滚动模式（`Q` 退出）|
| `exit` | 退出并终止当前会话 |
