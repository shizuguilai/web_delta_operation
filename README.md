# 三角洲 · 账号台账

一个手机友好的多账号数据管理网站，像在线 Excel 一样手动记录每个三角洲账号的哈币、仓库、邮件等信息，每次修改自动记录更新时间。

## 功能特性

- **多账号管理**：每行对应一个账号，左侧账号名列固定，右侧数据列横向滑动
- **完全手动填写**：不对接任何第三方接口，数据由用户自行录入
- **更新时间追踪**：每个格子（含账号名）修改后独立记录「更新于 年月日 时:分」
- **值不变不刷时间**：内容与库里相同时直接跳过，不误触更新时间戳
- **自动保存**：停止输入 0.55 秒或失焦时自动保存，无需手动点按钮
- **自由扩展列**：可随时添加「哈币、仓库、邮件、段位」等任意列，也可删除或重命名
- **手机端适配**：全面屏安全区、≥44px 点击区域、`touch-pan-x` 横向滑动

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
│   ├── requirements.txt    # Python 依赖
│   └── delta_ledger.db     # SQLite 数据库（运行后自动生成）
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # 主界面组件
│   │   ├── main.jsx        # React 入口
│   │   └── index.css       # Tailwind 基础样式
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
| POST | `/api/columns` | 新增列 |
| PATCH | `/api/columns/:id` | 重命名列 |
| DELETE | `/api/columns/:id` | 删除列（含该列所有格） |
| POST | `/api/rows` | 新增账号行 |
| PATCH | `/api/rows/:id` | 修改账号名（自动更新 `title_updated_at`） |
| DELETE | `/api/rows/:id` | 删除行 |
| PATCH | `/api/cells` | 保存格子内容（仅内容变化时刷新 `updated_at`） |
| GET | `/api/health` | 健康检查 |

## 数据库说明

数据库文件为 `backend/delta_ledger.db`，SQLite 单文件，直接复制即可备份。

三张表：

- `sheet_column`：列定义（id、title、position）
- `sheet_row`：账号行（id、title 账号名、title_updated_at、position）
- `cell`：单元格（row_id、column_id、value、updated_at，联合唯一）

新版本首次启动会自动执行 `ALTER TABLE` 补齐新字段，旧数据库无需手动迁移。

## 默认列

全新空库初始化时会自动创建三列：**哈币、仓库、邮件**。

账号名不占列，固定显示在表格左侧。可在表头输入框中随时重命名列，点击 `×` 删除列。

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
