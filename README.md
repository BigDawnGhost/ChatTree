# ChatTree

一个树状 AI + 人类协作创作平台。项目以「白板」为核心，把对话、笔记、灵感分支组织成树状结构，支持手动编辑、AI 续写、Markdown 渲染、白板持久化和图片上传。

## 功能特性

- 树状对话白板：从根节点出发，按分支组织想法和对话。
- AI 续写：根据当前节点到根节点的脉络生成下一条内容。
- Markdown 内容：节点正文支持 Markdown 渲染。
- 本地/服务端持久化：后端按白板 ID 保存 JSON 快照。
- 图片上传：提供 `/api/upload` 接口，上传文件保存到本地运行时目录。
- 静态前端托管：FastAPI 直接托管前端页面和资源。

## 项目结构

```text
ChatTree/
├── backend/
│   └── main.py                  # FastAPI 后端服务
├── ChatBot前端设计/
│   ├── 枝 · 树状对话白板.html    # 前端入口页面
│   ├── App.jsx                  # 主应用逻辑
│   ├── Node.jsx                 # 节点卡片组件
│   ├── force.js                 # 力导向布局逻辑
│   ├── md.js                    # Markdown 渲染辅助
│   ├── paper.css                # 样式
│   └── tweaks-panel.jsx         # 参数调节面板
├── shots/                       # 项目展示图片
├── pyproject.toml               # Python 项目配置
├── README.md
└── LICENSE
```

运行时会自动创建以下目录，这些目录不会提交到 Git：

```text
backend/boards/   # 白板 JSON 快照
backend/uploads/  # 上传文件
```

## 环境要求

- Python 3.11+
- [uv](https://github.com/astral-sh/uv)
- 可选：DeepSeek API Key，用于 AI 续写

## 安装依赖

在项目根目录执行：

```bash
uv sync
```

如果当前没有 `uv.lock`，也可以直接运行服务，`uv` 会根据 `pyproject.toml` 创建环境并安装依赖。

## 配置 AI Key

AI 续写使用 OpenAI 兼容接口，默认指向 DeepSeek：

```bash
export DEEPSEEK_API_KEY="你的 DeepSeek API Key"
```

可选配置：

```bash
export DEEPSEEK_BASE_URL="https://api.deepseek.com"
export DEEPSEEK_MODEL="deepseek-chat"
```

> 注意：不要把真实 API Key 写进代码或提交到仓库。项目已通过 `.gitignore` 忽略 `.env` 和 `.env.*`。

如果未配置 `DEEPSEEK_API_KEY`，白板仍可打开和编辑，但调用 AI 续写接口时会返回未配置提示。

## 启动服务

在项目根目录执行：

```bash
uv run python backend/main.py
```

服务默认启动在：

```text
http://127.0.0.1:8787
```

浏览器打开上面的地址即可使用。

## 基本使用

1. 打开页面后，会显示树状白板。
2. 点击节点可以查看当前节点和上下文脉络。
3. 编辑节点内容后保存，白板会更新对应节点。
4. 使用 AI 续写时，后端会把「系统提示词 + 当前路径脉络」发送给模型，生成新的子节点内容。
5. 支持导入/导出 JSON，用于备份和迁移白板数据。

## 后端接口

### AI 续写

```http
POST /api/ai/continue
Content-Type: application/json
```

请求体：

```json
{
  "system": "你是一个乐于助人的助手。",
  "lineage": ["根节点内容", "上一个节点内容"]
}
```

响应：

```json
{
  "text": "模型生成的下一条内容"
}
```

### 读取白板

```http
GET /api/boards/{board_id}
```

### 保存白板

```http
PUT /api/boards/{board_id}
Content-Type: application/json
```

请求体为完整白板快照：

```json
{
  "v": 1,
  "app": "枝",
  "rootId": "n_root",
  "nodes": {},
  "positions": {}
}
```

### 新建白板

```http
POST /api/boards
Content-Type: application/json
```

响应：

```json
{
  "ok": true,
  "boardId": "生成的白板 ID"
}
```

### 上传文件

```http
POST /api/upload
Content-Type: multipart/form-data
```

字段名：

```text
file
```

响应格式兼容 Vditor 上传约定：

```json
{
  "code": 0,
  "data": {
    "succMap": {
      "原文件名.png": "/uploads/xxx.png"
    }
  }
}
```

## 数据与隐私

- API Key 只通过环境变量读取，不应写入源码。
- `backend/boards/` 中可能包含白板正文内容，默认不提交。
- `backend/uploads/` 中可能包含用户上传文件，默认不提交。
- `.env` / `.env.*` 默认不提交。

## 开发说明

常用命令：

```bash
# 安装/同步依赖
uv sync

# 启动服务
uv run python backend/main.py

# Python 语法检查
uv run python -m py_compile backend/main.py
```

## 许可证

本项目使用 GPL-3.0 许可证，详见 [LICENSE](./LICENSE)。
