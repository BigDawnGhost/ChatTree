"""
枝 · 树状对话白板 — 后端服务
=============================
- 静态文件托管（前端页面）
- 白板持久化（JSON 文件）
- AI 续写（OpenAI API，通过环境变量配置 API Key）
- 图片上传
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from openai import OpenAI
from pydantic import BaseModel

# ── 目录 ──────────────────────────────────────────────────────
HERE = Path(__file__).parent
FRONTEND_DIR = HERE.parent / "ChatBot前端设计"
BOARDS_DIR = HERE / "boards"
UPLOADS_DIR = HERE / "uploads"

BOARDS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# ── OpenAI ────────────────────────────────────────────────────
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY")
DEEPSEEK_BASE = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

client = OpenAI(api_key=DEEPSEEK_KEY, base_url=DEEPSEEK_BASE) if DEEPSEEK_KEY else None

# ── FastAPI ───────────────────────────────────────────────────
app = FastAPI(title="枝 · 树状对话白板", version="0.1.0")


# ================================================================
#  模型
# ================================================================
class ContinueRequest(BaseModel):
    system: str
    lineage: list[str]


class BoardData(BaseModel):
    v: int
    app: str
    rootId: str
    nodes: dict
    positions: dict


# ================================================================
#  API: AI 续写
# ================================================================
@app.post("/api/ai/continue")
async def ai_continue(req: ContinueRequest):
    """调用 LLM 沿脉络续写，返回完整文本（非流式，前端自己做打字效果）"""
    chain = "\n\n".join(f"〔节点{i + 1}〕{tx}" for i, tx in enumerate(req.lineage))
    prompt = (
        f"{req.system}\n\n"
        f"下面是一条从根部到当前节点的脉络（按顺序）：\n{chain}\n\n"
        f"请顺着这条脉络写出**下一条**笔记/回答本身（可用 Markdown，简洁），"
        f"不要复述前文，不要加任何前缀或角色标签。"
    )

    try:
        if client is None:
            return JSONResponse(
                status_code=500,
                content={"error": "未配置 DEEPSEEK_API_KEY 环境变量"},
            )

        resp = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=2048,
        )
        text = resp.choices[0].message.content or ""
        return {"text": text.strip()}
    except Exception as e:
        return JSONResponse(
            status_code=502,
            content={"error": f"AI 调用失败: {e}"},
        )


# ================================================================
#  API: 白板持久化
# ================================================================
def _board_path(board_id: str) -> Path:
    return BOARDS_DIR / f"{board_id}.json"


@app.get("/api/boards/{board_id}")
async def get_board(board_id: str):
    path = _board_path(board_id)
    if not path.exists():
        return JSONResponse(status_code=404, content={"error": "not found"})
    return json.loads(path.read_text("utf-8"))


@app.put("/api/boards/{board_id}")
async def put_board(board_id: str, data: BoardData):
    path = _board_path(board_id)
    path.write_text(data.model_dump_json(), "utf-8")
    return {"ok": True, "savedAt": time.time()}


@app.post("/api/boards")
async def create_board(data: BoardData):
    """新建白板，自动生成 ID"""
    board_id = uuid.uuid4().hex[:12]
    path = _board_path(board_id)
    path.write_text(data.model_dump_json(), "utf-8")
    return {"ok": True, "boardId": board_id}


# ================================================================
#  API: 图片上传
# ================================================================
@app.post("/api/upload")
async def upload_file(file: UploadFile):
    ext = Path(file.filename or "file.png").suffix or ".png"
    name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / name
    content = await file.read()
    dest.write_bytes(content)
    url = f"/uploads/{name}"
    return {
        "code": 0,
        "data": {"succMap": {file.filename or name: url}},
    }


# ================================================================
#  API: 提供上傳文件訪問
# ================================================================
@app.get("/uploads/{file_path:path}")
async def serve_upload(file_path: str):
    full_path = UPLOADS_DIR / file_path
    if not full_path.exists() or not full_path.is_file():
        return JSONResponse(status_code=404, content={"error": "not found"})
    return FileResponse(str(full_path))


# ================================================================
#  静态文件（必须放在所有 API 路由之后）
# ================================================================
# 前端文件列表（相对路径 -> MIME 类型）
FRONTEND_FILES: dict[str, str] = {
    "枝 · 树状对话白板.html": "text/html; charset=utf-8",
    "App.jsx": "application/javascript; charset=utf-8",
    "Node.jsx": "application/javascript; charset=utf-8",
    "tweaks-panel.jsx": "application/javascript; charset=utf-8",
    "md.js": "application/javascript; charset=utf-8",
    "force.js": "application/javascript; charset=utf-8",
    "paper.css": "text/css; charset=utf-8",
}


@app.get("/")
async def serve_index():
    return FileResponse(
        str(FRONTEND_DIR / "枝 · 树状对话白板.html"),
        media_type="text/html; charset=utf-8",
    )


@app.get("/{file_name}")
async def serve_static(file_name: str):
    # 只允许前端已知文件
    if file_name not in FRONTEND_FILES:
        return JSONResponse(status_code=404, content={"error": "not found"})
    path = FRONTEND_DIR / file_name
    if not path.exists():
        return JSONResponse(status_code=404, content={"error": "not found"})
    return FileResponse(str(path), media_type=FRONTEND_FILES[file_name])


# ================================================================
#  入口
# ================================================================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8787, reload=True)
