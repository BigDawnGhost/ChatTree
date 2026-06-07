/* ============================================================
   App.jsx — tree-chat constellation whiteboard (force layout)
   ============================================================ */
const { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } =
  React;
const uid = () => "n" + Math.random().toString(36).slice(2, 9);
const HW = 152; // half card width for edge anchoring
const FAR = 0.55; // below this zoom => star view
const SAVE_KEY = "zhi.tree.v1"; // localStorage autosave slot

/* ---------- seed conversation ---------- */
function seedTree() {
  const sys = uid(),
    q1 = uid(),
    a1 = uid(),
    q2 = uid(),
    a2 = uid(),
    q3 = uid(),
    a3 = uid();
  const nodes = {};
  const mk = (id, role, text, parentId, kids = [], extra = {}) =>
    (nodes[id] = {
      id,
      role,
      text,
      parentId,
      childrenIds: kids,
      archivedIds: [],
      collapsed: false,
      archived: false,
      ...extra,
    });
  mk(
    sys,
    "system",
    "你是一位**博学而风趣**的向导，擅长把复杂概念讲得通俗。回答简洁，善用类比与小标题。",
    null,
    [q1],
    { label: "系统提示词" },
  );
  mk(q1, "note", "用一句话解释什么是「树状对话」？", sys, [a1], {
    label: "什么是树状对话",
  });
  mk(
    a1,
    "note",
    "**树状对话** = 让聊天不再是一条直线，而是一棵会分叉的树：每个回答都能长出新分支，并行探索多种走向，而不必推倒重来。",
    q1,
    [q2, q3],
    { gen: true, label: "定义" },
  );
  mk(q2, "note", "那它比普通聊天好在哪？", a1, [a2], { label: "好处？" });
  mk(
    a2,
    "note",
    "三点好处：\n\n1. **不丢上下文** —— 想换思路就分叉，原对话原封不动。\n2. **可对比** —— 同一问题试不同问法，并排看。\n3. **可回溯** —— 编辑任意节点，从那里重新生长。",
    q2,
    [],
    { gen: true, label: "三点好处" },
  );
  mk(q3, "note", "给我一个适合它的场景。", a1, [a3], { label: "场景？" });
  mk(
    a3,
    "note",
    "写作就很合适：\n\n- 同一段开头，分叉出 `严肃版` 和 `俏皮版`\n- 哪条更顺，就在哪条上继续\n- 不满意随时回到岔路口换条路走",
    a1,
    [],
    { gen: true, label: "写作场景" },
  );
  return { nodes, rootId: sys };
}

/* ---------- AI: generate along a lineage ---------- */
async function callAI(systemText, lineage) {
  // 优先调后端 API
  try {
    const r = await fetch("/api/ai/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: systemText, lineage }),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.text && data.text.trim()) return data.text.trim();
    }
  } catch (e) {
    /* fall through to mock */
  }
  // 降级：本地 mock
  const last = lineage[lineage.length - 1] || "";
  return `顺着「${last.slice(0, 16)}…」我会这样接下去：\n\n- 先抓住**核心**，别被细节淹没\n- 用一个类比把它讲清楚\n- 给一个能马上动手的小步骤\n\n> （服务端 AI 不可用，这是本地演示占位）`;
}

/* ---------- helpers ---------- */
function estimateH(n) {
  if (!n.text) return 116;
  let lines = 0;
  n.text.split("\n").forEach((p) => {
    lines += Math.max(1, Math.ceil(p.length / 16));
  });
  return 86 + Math.min(6, lines) * 24;
}
function cardEdge(s, t, hs, ht, wob) {
  const x1 = s.x,
    y1 = s.y + hs / 2,
    x2 = t.x,
    y2 = t.y - ht / 2;
  const dy = Math.max(28, (y2 - y1) * 0.5);
  if (wob) {
    const mx = (x1 + x2) / 2 + (((s.y + t.x) % 13) - 6),
      my = (y1 + y2) / 2;
    return `M ${x1} ${y1} Q ${x1} ${y1 + dy * 0.6}, ${mx} ${my} T ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}
function starEdge(s, t) {
  const dy = (t.y - s.y) * 0.4;
  return `M ${s.x} ${s.y} C ${s.x} ${s.y + dy}, ${t.x} ${t.y - dy}, ${t.x} ${t.y}`;
}

/* full linear thread through a node: root → … → node → … → leaf */
function buildThread(nodes, id) {
  if (!nodes[id]) return [];
  const up = [];
  let c = nodes[id];
  while (c) {
    up.unshift(c);
    c = c.parentId ? nodes[c.parentId] : null;
  }
  const down = [];
  let d = nodes[id];
  while (d) {
    const kid = (d.childrenIds || []).find((x) => nodes[x]);
    if (!kid) break;
    d = nodes[kid];
    down.push(d);
  }
  return [...up, ...down];
}

/* the displayed 链路: a single fixed root → … → leaf line (anchored on a leaf) */
function buildThreadFromLeaf(nodes, leafId) {
  if (!nodes[leafId]) return [];
  const up = [];
  let c = nodes[leafId];
  while (c) {
    up.unshift(c);
    c = c.parentId ? nodes[c.parentId] : null;
  }
  return up;
}

/* ============================================================ */
function App() {
  const boot = useMemo(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.nodes && d.rootId && d.nodes[d.rootId])
          return {
            nodes: d.nodes,
            rootId: d.rootId,
            positions: d.positions || null,
          };
      }
    } catch (e) {
      /* ignore */
    }
    const s = seedTree();
    return { nodes: s.nodes, rootId: s.rootId, positions: null };
  }, []);
  const [nodes, setNodes] = useState(boot.nodes);
  const [rootId, setRootId] = useState(boot.rootId);
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [streamingId, setStreamingId] = useState(null);
  const [view, setView] = useState({ x: 200, y: 360, scale: 0.9 });
  const [drag, setDrag] = useState(null); // branch-drag draft {fromId,x,y}
  const [toast, setToast] = useState("");
  const [threadOpen, setThreadOpen] = useState(false);
  const [threadLeaf, setThreadLeaf] = useState(null);
  const [, force] = useState(0); // for minimap refresh

  const density = { colW: 336, rowH: 232 }; // colW = sibling spread (x), rowH = depth gap (y, top-down)

  // refs
  const vpRef = useRef(null),
    worldRef = useRef(null),
    edgeLayerRef = useRef(null);
  const elMap = useRef({});
  const posRef = useRef(null);
  const metaRef = useRef({});
  const edgeMetaRef = useRef({});
  const alphaRef = useRef(1);
  const gestureRef = useRef(null);
  const farRef = useRef(false),
    wobbleRef = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const far = view.scale < FAR;
  farRef.current = far;

  // init positions once. restore saved positions, else pre-settle a fresh layout
  if (!posRef.current) {
    if (boot.positions) {
      posRef.current = {};
      for (const id in boot.nodes) {
        const p = boot.positions[id];
        posRef.current[id] = p
          ? { x: p.x, y: p.y, vx: 0, vy: 0, pinned: !!p.pinned }
          : { x: 0, y: 0, vx: 0, vy: 0, pinned: false };
      }
      alphaRef.current = 0.08;
    } else {
      posRef.current = window.initialPositions(boot.nodes, rootId, density);
      const meta0 = {},
        links0 = [];
      for (const id in boot.nodes) {
        meta0[id] = { w: 300, h: 160 };
        (boot.nodes[id].childrenIds || []).forEach((c) =>
          links0.push({ s: id, t: c }),
        );
      }
      let a = 1;
      for (let i = 0; i < 170; i++) {
        window.stepForces(
          posRef.current,
          meta0,
          links0,
          {
            L: density.rowH,
            charge: 52000,
            linkK: 0.05,
            damping: 0.86,
            maxV: 60,
            collideGap: 26,
          },
          Math.max(0.12, a),
        );
        a *= 0.965;
      }
      alphaRef.current = 0.1;
    }
  }

  /* ---- node map mutation ---- */
  const update = useCallback((mutator) => {
    setNodes((prev) => {
      const next = {};
      for (const k in prev) next[k] = prev[k];
      mutator(next, (id) => {
        next[id] = { ...next[id] };
        return next[id];
      });
      return next;
    });
  }, []);
  const showToast = useCallback((m) => {
    setToast(m);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast(""), 1700);
  }, []);
  const reheat = useCallback((a) => {
    alphaRef.current = Math.max(alphaRef.current, a || 0.9);
  }, []);

  /* ---- persistence: autosave + JSON export / import ---- */
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const fileRef = useRef(null);
  const snapshot = useCallback(() => {
    const ns = nodesRef.current;
    const positions = {},
      clean = {};
    for (const id in ns) {
      const n = ns[id];
      const p = posRef.current[id];
      if (p)
        positions[id] = {
          x: Math.round(p.x),
          y: Math.round(p.y),
          pinned: !!p.pinned,
        };
      clean[id] = {
        id: n.id,
        role: n.role,
        text: n.text,
        parentId: n.parentId,
        childrenIds: n.childrenIds || [],
        gen: !!n.gen,
        label: n.label || "",
        collapsed: !!n.collapsed,
      };
    }
    return { v: 1, app: "枝", rootId, nodes: clean, positions };
  }, [rootId]);
  const saveLocal = useCallback(() => {
    clearTimeout(saveLocal._t);
    saveLocal._t = setTimeout(() => {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot()));
      } catch (e) {
        /* quota */
      }
    }, 400);
  }, [snapshot]);
  useEffect(() => {
    saveLocal();
  }, [nodes, saveLocal]);
  function exportJSON() {
    const data = { ...snapshot(), exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `枝-对话白板-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出 JSON 文件");
  }
  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || !d.nodes || !d.rootId || !d.nodes[d.rootId]) {
          showToast("无法识别的文件");
          return;
        }
        const newPos = {};
        for (const id in d.nodes) {
          const p = d.positions && d.positions[id];
          newPos[id] = p
            ? { x: p.x, y: p.y, vx: 0, vy: 0, pinned: !!p.pinned }
            : { x: 0, y: 0, vx: 0, vy: 0, pinned: false };
        }
        posRef.current = newPos;
        elMap.current = {};
        setSelectedId(null);
        setEditingId(null);
        setStreamingId(null);
        setRootId(d.rootId);
        setNodes(d.nodes);
        alphaRef.current = 0.32;
        setTimeout(() => fitView(), 90);
        showToast("已导入 · " + Object.keys(d.nodes).length + " 个节点");
      } catch (e) {
        showToast("导入失败：文件已损坏");
      }
    };
    reader.readAsText(file);
  }

  /* ---- meta (sizes) + visible structure ---- */
  const visible = useMemo(() => {
    // which children render (collapse + archived gating)
    const childMap = {};
    for (const id in nodes) {
      const n = nodes[id];
      const kids = (n.childrenIds || []).filter((c) => {
        const cn = nodes[c];
        if (!cn) return false;
        if (cn.archived && !n.archived) return !!n._showArchived;
        return true;
      });
      childMap[id] = n.collapsed ? [] : kids;
    }
    // reachable set from root through visible children
    const seen = {};
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      if (seen[id] || !nodes[id]) continue;
      seen[id] = true;
      (childMap[id] || []).forEach((c) => stack.push(c));
    }
    return { childMap, seen };
  }, [nodes]);

  // meta for physics
  metaRef.current = useMemo(() => {
    const m = {};
    for (const id in nodes)
      if (visible.seen[id]) m[id] = { w: 300, h: estimateH(nodes[id]) };
    return m;
  }, [nodes, visible]);

  // descendant counts
  const descCount = useMemo(() => {
    const c = {};
    const f = (id) => {
      let s = 0;
      (visible.childMap[id] || []).forEach((k) => {
        s += 1 + f(k);
      });
      c[id] = s;
      return s;
    };
    f(rootId);
    return c;
  }, [visible]);

  // ---- stable 链路: anchor on a leaf so clicking an UPSTREAM node never reshuffles the path ----
  const threadAnchor =
    threadLeaf && nodes[threadLeaf]
      ? threadLeaf
      : selectedId && nodes[selectedId]
        ? selectedId
        : rootId;
  const threadChain = useMemo(
    () => buildThreadFromLeaf(nodes, threadAnchor),
    [nodes, threadAnchor],
  );
  useEffect(() => {
    const sel = selectedId || rootId;
    if (!nodes[sel]) return;
    // keep the current path while you click nodes that already sit on it
    let onPath = false;
    if (threadLeaf && nodes[threadLeaf]) {
      let c = nodes[threadLeaf];
      while (c) {
        if (c.id === sel) {
          onPath = true;
          break;
        }
        c = c.parentId ? nodes[c.parentId] : null;
      }
    }
    if (onPath) return;
    // else re-anchor: descend first children from the selection down to a leaf
    let d = nodes[sel],
      leaf = sel;
    while (d) {
      const kid = (d.childrenIds || []).find(
        (x) => nodes[x] && !nodes[x].archived,
      );
      if (!kid) break;
      d = nodes[kid];
      leaf = kid;
    }
    setThreadLeaf(leaf);
  }, [selectedId, nodes, rootId, threadLeaf]);

  // links + edges
  const links = [];
  const edges = [];
  for (const id in visible.childMap) {
    if (!visible.seen[id]) continue;
    visible.childMap[id].forEach((cid) => {
      if (!visible.seen[cid]) return;
      links.push({ s: id, t: cid });
      const key = id + ">" + cid;
      const leaving =
        (nodes[id] && nodes[id]._anim === "leaving") ||
        (nodes[cid] && nodes[cid]._anim === "leaving");
      edges.push({ key, archived: nodes[cid] && nodes[cid].archived, leaving });
    });
  }
  edgeMetaRef.current = {};
  edges.forEach((e) => {
    const [s, x] = e.key.split(">");
    edgeMetaRef.current[e.key] = { s, t: x };
  });
  const linksRef = useRef(links);
  linksRef.current = links;

  // ensure every visible node has a position; drop stale
  for (const id in visible.seen) {
    if (!posRef.current[id]) {
      const p = nodes[id].parentId && posRef.current[nodes[id].parentId];
      posRef.current[id] = {
        x: p ? p.x + density.colW : 0,
        y: p ? p.y + (Math.random() * 120 - 60) : 0,
        vx: 0,
        vy: 0,
        pinned: false,
      };
    }
  }

  /* ---- the simulation + render loop ---- */
  useEffect(() => {
    let raf;
    const loop = () => {
      const pos = posRef.current;
      const dragging = gestureRef.current && gestureRef.current.type === "node";
      if (alphaRef.current > 0.02 || dragging) {
        window.stepForces(
          pos,
          metaRef.current,
          linksRef.current,
          {
            L: density.rowH,
            charge: 52000,
            linkK: 0.05,
            damping: 0.9,
            maxV: 30,
            collideGap: 28,
          },
          Math.max(0.12, alphaRef.current),
        );
        if (!dragging) alphaRef.current *= 0.97;
      }
      // write transforms + measure live card heights (feeds edge anchors AND collision)
      const hCache = {};
      for (const id in pos) {
        const el = elMap.current[id];
        if (el) {
          const p = pos[id];
          el.style.transform = `translate(${p.x}px, ${p.y}px)`;
          if (!farRef.current) {
            const c = el.querySelector(".card");
            const h =
              (c && c.offsetHeight) ||
              (metaRef.current[id] && metaRef.current[id].h) ||
              140;
            hCache[id] = h;
            if (metaRef.current[id]) metaRef.current[id].h = h; // real size -> firm 避让, no overlap
          }
        }
      }
      // write edges (vertical: parent bottom -> child top)
      const layer = edgeLayerRef.current;
      if (layer) {
        const paths = layer.querySelectorAll("path[data-ek]");
        for (const pa of paths) {
          const m = edgeMetaRef.current[pa.getAttribute("data-ek")];
          if (!m) continue;
          const s = pos[m.s],
            tt = pos[m.t];
          if (!s || !tt) continue;
          const hs = hCache[m.s] || 140,
            ht = hCache[m.t] || 140;
          pa.setAttribute(
            "d",
            farRef.current
              ? starEdge(s, tt)
              : cardEdge(s, tt, hs, ht, wobbleRef.current),
          );
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [density.colW]);

  // refresh minimap a few times/sec while warm
  useEffect(() => {
    const iv = setInterval(() => {
      if (alphaRef.current > 0.02 || gestureRef.current) force((n) => n + 1);
    }, 140);
    return () => clearInterval(iv);
  }, []);

  /* ---- screen<->world ---- */
  const toWorld = (cx, cy) => ({
    x: (cx - viewRef.current.x) / viewRef.current.scale,
    y: (cy - viewRef.current.y) / viewRef.current.scale,
  });
  const animateWorld = () => {
    const w = worldRef.current;
    if (w) {
      w.classList.add("animated");
      clearTimeout(animateWorld._t);
      animateWorld._t = setTimeout(() => w.classList.remove("animated"), 520);
    }
  };

  /* ---- gestures ---- */
  const capture = (e) => {
    try {
      vpRef.current.setPointerCapture(e.pointerId);
    } catch (_) {}
  };
  function onVpPointerDown(e) {
    if (gestureRef.current) return; // a node/branch gesture already began
    if (e.target.closest(".node") || e.target.closest(".hud")) return;
    setSelectedId(null);
    setEditingId(null);
    gestureRef.current = {
      type: "pan",
      sx: e.clientX,
      sy: e.clientY,
      vx: view.x,
      vy: view.y,
    };
    vpRef.current.classList.add("panning");
    capture(e);
  }
  function onVpPointerMove(e) {
    const g = gestureRef.current;
    if (!g) return;
    if (g.type === "pan") {
      setView((v) => ({
        ...v,
        x: g.vx + (e.clientX - g.sx),
        y: g.vy + (e.clientY - g.sy),
      }));
    } else if (g.type === "branch") {
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ fromId: g.fromId, x: w.x, y: w.y });
    } else if (g.type === "node") {
      const w = toWorld(e.clientX, e.clientY);
      const p = posRef.current[g.id];
      if (Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) > 4)
        g.moved = true;
      if (p) {
        p.x = w.x - g.offX;
        p.y = w.y - g.offY;
      }
      reheat(0.5);
    }
  }
  function onVpPointerUp(e) {
    const g = gestureRef.current;
    if (g && g.type === "branch")
      finishBranch(g, toWorld(e.clientX, e.clientY));
    if (g && g.type === "node") {
      const p = posRef.current[g.id];
      if (p) {
        if (g.moved) {
          p.pinned = true;
          p.vx = p.vy = 0;
          saveLocal();
        } else {
          p.pinned = g.wasPinned;
          openEditor(g.id);
        } // a plain click opens the editor
        reheat(0.5);
      }
    }
    gestureRef.current = null;
    vpRef.current && vpRef.current.classList.remove("panning");
  }
  function onWheel(e) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0014);
    setView((v) => {
      const ns = Math.min(2.2, Math.max(0.18, v.scale * factor));
      const wx = (e.clientX - v.x) / v.scale,
        wy = (e.clientY - v.y) / v.scale;
      return { scale: ns, x: e.clientX - wx * ns, y: e.clientY - wy * ns };
    });
  }
  function zoomBy(f) {
    animateWorld();
    setView((v) => {
      const ns = Math.min(2.2, Math.max(0.18, v.scale * f));
      const cx = innerWidth / 2,
        cy = innerHeight / 2;
      const wx = (cx - v.x) / v.scale,
        wy = (cy - v.y) / v.scale;
      return { scale: ns, x: cx - wx * ns, y: cy - wy * ns };
    });
  }
  const bounds = useCallback(() => {
    let a = 1e9,
      b = 1e9,
      c = -1e9,
      d = -1e9;
    for (const id in visible.seen) {
      const p = posRef.current[id];
      if (!p) continue;
      a = Math.min(a, p.x);
      b = Math.min(b, p.y);
      c = Math.max(c, p.x);
      d = Math.max(d, p.y);
    }
    return { minX: a, minY: b, maxX: c, maxY: d };
  }, [visible]);
  const fitView = useCallback(() => {
    const bb = bounds();
    if (!isFinite(bb.minX)) return;
    const w = bb.maxX - bb.minX + 340 + 160,
      h = bb.maxY - bb.minY + 280;
    const s = Math.min(1.1, Math.min(innerWidth / w, innerHeight / h));
    animateWorld();
    setView({
      scale: s,
      x: innerWidth / 2 - ((bb.minX + bb.maxX) / 2) * s,
      y: innerHeight / 2 - ((bb.minY + bb.maxY) / 2) * s,
    });
  }, [bounds]);
  const focusNode = useCallback((id) => {
    const p = posRef.current[id];
    if (!p) return;
    animateWorld();
    setView({ scale: 1, x: innerWidth / 2 - p.x, y: innerHeight / 2 - p.y });
  }, []);
  // one click into card view (always crosses the FAR threshold)
  function enterCards() {
    animateWorld();
    setView((v) => {
      const ns = 1.0;
      const cx = innerWidth / 2,
        cy = innerHeight / 2;
      const wx = (cx - v.x) / v.scale,
        wy = (cy - v.y) / v.scale;
      return { scale: ns, x: cx - wx * ns, y: cy - wy * ns };
    });
  }
  // star overview: zoom out far enough to see EVERY node, in constellation mode
  function starOverview() {
    const bb = bounds();
    if (!isFinite(bb.minX)) return;
    const w = bb.maxX - bb.minX + 340 + 160,
      h = bb.maxY - bb.minY + 280;
    const ns = Math.min(Math.min(innerWidth / w, innerHeight / h), 0.5); // <= 0.5 keeps it below FAR
    animateWorld();
    setView({
      scale: ns,
      x: innerWidth / 2 - ((bb.minX + bb.maxX) / 2) * ns,
      y: innerHeight / 2 - ((bb.minY + bb.maxY) / 2) * ns,
    });
  }
  const fitOnce = useRef(false);
  useLayoutEffect(() => {
    fitOnce.current = true;
    fitView();
  }, []);

  /* ---- node ops: a single click opens the dedicated Markdown editor (modal) ---- */
  function openEditor(id) {
    setSelectedId(id);
    setEditingId(id);
    if (nodes[id] && nodes[id]._fresh)
      update((m, edit) => {
        if (m[id]) edit(id)._fresh = false;
      });
  }
  function cancelEdit() {
    setEditingId(null);
  }
  function commitEdit(id, text, label) {
    update((m, edit) => {
      const n = edit(id);
      n.text = text;
      if (label !== undefined) n.label = label;
    });
    setEditingId(null);
    reheat(0.4);
    saveLocal();
    showToast("已保存");
  }
  function addChild(parentId, opts = {}) {
    const id = uid();
    const pp = posRef.current[parentId] || { x: 0, y: 0 };
    posRef.current[id] = {
      x: opts.x != null ? opts.x : pp.x + (Math.random() * 90 - 45),
      y: opts.y != null ? opts.y : pp.y + density.rowH,
      vx: 0,
      vy: 0,
      pinned: !!opts.pin,
    };
    update((m, edit) => {
      const p = edit(parentId);
      m[id] = {
        id,
        role: "note",
        gen: !!opts.gen,
        text: opts.text || "",
        parentId,
        childrenIds: [],
        archivedIds: [],
        collapsed: false,
        archived: false,
        _anim: "entering",
      };
      if (opts.model) m[id].model = opts.model;
      p.childrenIds = [...(p.childrenIds || []), id];
      p.collapsed = false;
    });
    setTimeout(
      () =>
        update((m, edit) => {
          if (m[id]) edit(id)._anim = "";
        }),
      460,
    );
    setSelectedId(id);
    if (!opts.noEdit) setEditingId(id);
    reheat(0.6);
    return id;
  }
  function deleteNode(id) {
    if (id === rootId || !nodes[id]) return;
    const rm = [];
    const g = (x) => {
      rm.push(x);
      (nodes[x].childrenIds || []).forEach(g);
    };
    g(id);
    // edges to the doomed subtree fade out at once (see .edge-path.exiting)
    update((m, edit) => {
      rm.forEach((x) => {
        if (m[x]) edit(x)._anim = "leaving";
      });
    });
    setTimeout(() => {
      update((m, edit) => {
        const n = m[id];
        if (!n) return;
        if (m[n.parentId]) {
          const pe = edit(n.parentId);
          pe.childrenIds = pe.childrenIds.filter((c) => c !== id);
          pe.archivedIds = (pe.archivedIds || []).filter((c) => c !== id);
        }
        rm.forEach((x) => {
          delete m[x];
          delete posRef.current[x];
          delete elMap.current[x];
        });
      });
      reheat(0.5);
    }, 200);
    if (editingId === id) setEditingId(null);
    if (selectedId === id) setSelectedId(null);
  }
  function toggleCollapse(id, kind) {
    update((m, edit) => {
      const n = edit(id);
      if (kind === "subtree") n.collapsed = !n.collapsed;
      else n._expanded = !n._expanded;
    });
    reheat(0.6);
  }
  function toggleArchived(id) {
    update((m, edit) => {
      const n = edit(id);
      n._showArchived = !n._showArchived;
    });
    reheat(0.6);
  }

  // double-click blank board => unpin everything & re-settle into a tidy tree
  function tidy() {
    const fresh = window.initialPositions(nodes, rootId, density);
    for (const id in fresh) {
      const p = posRef.current[id];
      if (p) {
        p.x = fresh[id].x;
        p.y = fresh[id].y;
        p.vx = 0;
        p.vy = 0;
        p.pinned = id === rootId;
      } else posRef.current[id] = fresh[id];
    }
    reheat(1);
    setTimeout(fitView, 440);
    saveLocal();
    showToast("已整理");
  }

  async function askAI(fromId) {
    const path = [];
    let cur = nodes[fromId];
    while (cur) {
      path.unshift(cur);
      cur = cur.parentId ? nodes[cur.parentId] : null;
    }
    const sysText =
      path[0] && path[0].role === "system"
        ? path[0].text
        : "你是一个乐于助人的助手。";
    const lineage = path.filter((n) => n.role !== "system").map((n) => n.text);
    // pin the source so its 续写 button never drifts out from under the cursor
    const p0 = posRef.current[fromId];
    if (p0) {
      p0.pinned = true;
      p0.vx = p0.vy = 0;
    }
    const aiId = addChild(fromId, { noEdit: true, text: "", gen: true });
    setStreamingId(aiId);
    setSelectedId(aiId);
    const full = await callAI(
      sysText,
      lineage.length ? lineage : [path[path.length - 1].text],
    );
    const step = Math.max(1, Math.round(full.length / 90));
    let i = 0;
    const tick = () => {
      i = Math.min(full.length, i + step);
      update((m, edit) => {
        if (m[aiId]) edit(aiId).text = full.slice(0, i);
      });
      reheat(0.1);
      if (i < full.length) setTimeout(tick, 18);
      else {
        setStreamingId(null);
        setSelectedId(null);
        update((m, edit) => {
          if (m[aiId]) edit(aiId)._fresh = true;
        });
        saveLocal();
      }
    };
    setTimeout(tick, 240);
  }

  /* ---- node drag + branch drag entry points (called from NodeCard) ---- */
  function beginNodeDrag(e, id) {
    setSelectedId(id);
    if (nodes[id] && nodes[id]._fresh)
      update((m, edit) => {
        if (m[id]) edit(id)._fresh = false;
      });
    const w = toWorld(e.clientX, e.clientY);
    const p = posRef.current[id];
    if (!p) return;
    gestureRef.current = {
      type: "node",
      id,
      offX: w.x - p.x,
      offY: w.y - p.y,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      wasPinned: !!p.pinned,
    };
    p.pinned = true; // pin to cursor immediately so the sim doesn't fight the drag
    reheat(0.6);
    capture(e);
  }
  function beginBranch(e, id) {
    const w = toWorld(e.clientX, e.clientY);
    gestureRef.current = { type: "branch", fromId: id };
    setDrag({ fromId: id, x: w.x, y: w.y });
    capture(e);
  }
  function finishBranch(g, drop) {
    setDrag(null);
    const from = nodes[g.fromId];
    if (!from) return;
    addChild(g.fromId, { x: drop.x, y: drop.y, pin: true });
    showToast("新分支 · 写点什么");
  }

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")
        return;
      if (e.key === "0" || e.key.toLowerCase() === "f") {
        fitView();
        return;
      }
      if (!selectedId || !nodes[selectedId]) return;
      const n = nodes[selectedId];
      if (e.key === "Enter") {
        e.preventDefault();
        askAI(selectedId);
      } else if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        openEditor(selectedId);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteNode(selectedId);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [selectedId, nodes]);

  /* ---- minimap ---- */
  const mm = (() => {
    const bb = bounds();
    if (!isFinite(bb.minX)) return null;
    const pad = 200;
    const W = bb.maxX - bb.minX + pad * 2,
      H = bb.maxY - bb.minY + pad * 2;
    const ox = bb.minX - pad,
      oy = bb.minY - pad;
    const provOf = (n) =>
      n && n.role === "system" ? "system" : n && n.gen ? "gen" : "write";
    const items = Object.keys(visible.seen)
      .map((id) => {
        const p = posRef.current[id];
        return p && { id, prov: provOf(nodes[id]), x: p.x - ox, y: p.y - oy };
      })
      .filter(Boolean);
    const segs = links
      .map((lk) => {
        const a = posRef.current[lk.s],
          b = posRef.current[lk.t];
        return (
          a &&
          b && {
            k: lk.s + lk.t,
            s: lk.s,
            t: lk.t,
            x1: a.x - ox,
            y1: a.y - oy,
            x2: b.x - ox,
            y2: b.y - oy,
          }
        );
      })
      .filter(Boolean);
    const threadIds = {};
    threadChain.forEach((n) => (threadIds[n.id] = 1));
    const vx = -view.x / view.scale - ox,
      vy = -view.y / view.scale - oy;
    return {
      W,
      H,
      items,
      segs,
      threadIds,
      vx,
      vy,
      vw: innerWidth / view.scale,
      vh: innerHeight / view.scale,
    };
  })();

  return (
    <div
      className="app"
      style={{
        "--node-w": "300px",
        "--accent": "#b8472f",
        "--grain": 1,
        fontFamily: "var(--font-hand)",
      }}
    >
      <div
        ref={vpRef}
        className={"board-viewport" + (far ? " far" : "")}
        onPointerDown={onVpPointerDown}
        onPointerMove={onVpPointerMove}
        onPointerUp={onVpPointerUp}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          if (!e.target.closest(".node") && !e.target.closest(".hud")) tidy();
        }}
      >
        <div
          ref={worldRef}
          className="board-world"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <div
            className="grid-layer"
            style={{
              left: -4000,
              top: -4000,
              width: 9000,
              height: 9000,
              backgroundSize: "26px 26px",
            }}
          ></div>

          <svg
            ref={edgeLayerRef}
            className={"edge-layer" + (far ? " far" : "")}
            style={{ left: 0, top: 0, width: 1, height: 1 }}
          >
            {edges.map((e) => (
              <path
                key={e.key}
                data-ek={e.key}
                className={
                  "edge-path" +
                  (e.archived ? " archived" : "") +
                  (e.leaving ? " exiting" : "")
                }
                d=""
              />
            ))}
            {drag &&
              (() => {
                const p = posRef.current[drag.fromId];
                if (!p) return null;
                const hs =
                  (metaRef.current[drag.fromId] &&
                    metaRef.current[drag.fromId].h) ||
                  140;
                return (
                  <path
                    className="edge-path draft"
                    d={`M ${p.x} ${p.y + hs / 2} C ${p.x} ${p.y + hs / 2 + 60}, ${drag.x} ${drag.y - 60}, ${drag.x} ${drag.y}`}
                  />
                );
              })()}
          </svg>

          {Object.keys(visible.seen).map((id) => {
            const n = nodes[id];
            if (!n) return null;
            return (
              <NodeCard
                key={id}
                node={{ ...n, _descendants: descCount[id] }}
                far={far}
                showStarLabel={view.scale > 0.3}
                selected={selectedId === id}
                editing={editingId === id}
                streaming={streamingId === id}
                onDelete={deleteNode}
                onToggleCollapse={toggleCollapse}
                onAskAI={askAI}
                onBranchPointerDown={beginBranch}
                onNodePointerDown={beginNodeDrag}
                onFocus={focusNode}
                registerEl={(nid, el) => (elMap.current[nid] = el)}
              />
            );
          })}
        </div>
      </div>

      <div className="hud topbar">
        <div className="brand">
          <span className="mark">❦</span>枝<small>· 树状对话白板</small>
        </div>
        <div className="divider"></div>
        <button
          className="tbtn"
          onClick={far ? enterCards : starOverview}
          title={far ? "回到卡片视图" : "缩放到能看见所有节点的星图"}
        >
          {far ? "↗ 进入卡片" : "✦ 星图总览"}
        </button>
        <div className="divider"></div>
        <button
          className={"tbtn" + (threadOpen ? " on" : "")}
          onClick={() => setThreadOpen((o) => !o)}
          title="阅读 / 编辑当前节点与整条脉络"
        >
          ☰ 节点·链路
        </button>
        <div className="divider"></div>
        <button
          className="tbtn"
          onClick={exportJSON}
          title="导出为 JSON 文件（备份 / 迁移）"
        >
          ⭳ 导出
        </button>
        <button
          className="tbtn"
          onClick={() => fileRef.current && fileRef.current.click()}
          title="从 JSON 文件导入"
        >
          ⭱ 导入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) importJSON(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="hud zoombar">
        <button className="zbtn" onClick={() => zoomBy(1.2)}>
          ＋
        </button>
        <span className="zlabel">{Math.round(view.scale * 100)}%</span>
        <button className="zbtn" onClick={() => zoomBy(1 / 1.2)}>
          －
        </button>
      </div>

      {mm && (
        <div className="hud minimap">
          <svg
            viewBox={`0 0 ${mm.W} ${mm.H}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {mm.segs.map((s) => {
              const main = mm.threadIds[s.s] && mm.threadIds[s.t];
              return (
                <line
                  key={s.k}
                  className={"mm-edge" + (main ? " main" : "")}
                  x1={s.x1}
                  y1={s.y1}
                  x2={s.x2}
                  y2={s.y2}
                />
              );
            })}
            {mm.items.map((it) => {
              const main = mm.threadIds[it.id];
              return (
                <circle
                  key={it.id}
                  className={"mm-node " + it.prov + (main ? " main" : "")}
                  cx={it.x}
                  cy={it.y}
                  r={it.id === rootId ? 34 : main ? 24 : 15}
                />
              );
            })}
            <rect
              className="mm-view"
              x={mm.vx}
              y={mm.vy}
              width={mm.vw}
              height={mm.vh}
              rx={10}
            />
          </svg>
        </div>
      )}

      <div className="hud hint-bar">
        <span>
          点击节点<kbd>打开编辑</kbd>
        </span>
        <span>
          拖动节点<kbd>移动 · 其余避让</kbd>
        </span>
        <span>
          悬停底部<kbd>＋ 拖出分支</kbd>
        </span>
        <span>
          拖空白<kbd>平移</kbd>
        </span>
        <span>
          滚轮<kbd>缩放</kbd>
        </span>
        <span>
          双击空白<kbd>自动整理</kbd>
        </span>
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
      <DetailPanel
        open={threadOpen}
        chain={threadOpen ? threadChain : []}
        currentId={selectedId}
        onClose={() => setThreadOpen(false)}
        onPick={(id) => {
          setSelectedId(id);
          focusNode(id);
        }}
        onEdit={openEditor}
      />
      {editingId && nodes[editingId] && (
        <NodeEditor
          node={nodes[editingId]}
          prov={
            nodes[editingId].role === "system"
              ? "system"
              : nodes[editingId].gen
                ? "gen"
                : "write"
          }
          onCommit={commitEdit}
          onClose={cancelEdit}
          onAskAI={askAI}
          onDelete={deleteNode}
        />
      )}
      <div className="grain"></div>
    </div>
  );
}

/* 链路: a READ-ONLY reader of the current root→leaf path. Editing lives in NodeEditor. */
function DetailPanel({ open, chain, currentId, onClose, onPick, onEdit }) {
  const COLOR = {
    system: "var(--sys)",
    gen: "var(--ai)",
    write: "var(--ink-soft)",
  };
  const bodyRef = React.useRef(null);
  React.useEffect(() => {
    const b = bodyRef.current;
    if (!open || !b) return;
    b.scrollTo
      ? b.scrollTo({ top: b.scrollHeight, behavior: "smooth" })
      : (b.scrollTop = b.scrollHeight);
  }, [currentId, open, chain.length]);
  return (
    <div className={"thread" + (open ? " open" : "")}>
      <div className="thread-head">
        <h3>☰ 链路</h3>
        <span className="spacer"></span>
        <span className="thread-num">{chain.length} 步</span>
        <button className="thread-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="thread-body" ref={bodyRef}>
        {chain.length === 0 && (
          <p className="thread-empty">
            选中一个节点，这里会把它所在的整条脉络从根到叶按顺序排好，像读一段连续的对话。点任意一步可跳到该节点。
          </p>
        )}
        {chain.map((n, i) => {
          const prov = n.role === "system" ? "system" : n.gen ? "gen" : "write";
          const isCur = n.id === currentId;
          return (
            <div
              className="thread-step"
              key={n.id}
              style={{ "--role": COLOR[prov] }}
            >
              <span className="thread-dot"></span>
              <div
                className={"thread-card" + (isCur ? " cur" : "")}
                onClick={() => onPick(n.id)}
              >
                <div className="tc-head">
                  <span className="tc-num">
                    {prov === "system" ? "系统提示词" : "第 " + i + " 步"}
                    {n.label ? " · " + n.label : ""}
                    {prov === "gen" ? " · ✦ AI" : ""}
                  </span>
                  {isCur && (
                    <button
                      className="tc-btn ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(n.id);
                      }}
                    >
                      编辑
                    </button>
                  )}
                </div>
                <div
                  className={"tc-body" + (isCur ? " full" : "")}
                  dangerouslySetInnerHTML={{
                    __html: window.renderMarkdown(n.text || "（空）"),
                  }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* dedicated single-node Markdown editor — opens on card click */
function NodeEditor({ node, prov, onCommit, onClose, onAskAI, onDelete }) {
  const [draft, setDraft] = useState(node.text);
  const [label, setLabel] = useState(node.label || "");
  const [tab, setTab] = useState("write"); // write | preview
  const [confirmDel, setConfirmDel] = useState(false);
  const ta = useRef(null);
  useEffect(() => {
    setDraft(node.text);
    setLabel(node.label || "");
    setConfirmDel(false);
    setTab("write");
  }, [node.id]);
  useEffect(() => {
    if (tab === "write" && ta.current) {
      const t = ta.current;
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
      auto();
    }
  }, [tab, node.id]);
  function auto() {
    const t = ta.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.max(220, t.scrollHeight) + "px";
  }
  const dirty = () => draft !== node.text || label !== (node.label || "");
  function close() {
    if (dirty()) onCommit(node.id, draft, label);
    else onClose();
  }
  function key(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      close();
    }
  }
  const hasKids = (node.childrenIds || []).length > 0;
  const chip =
    prov === "system"
      ? "⟡ 系统提示词"
      : prov === "gen"
        ? "✦ AI 生成"
        : "✎ 笔记";
  return (
    <div
      className="editor-overlay"
      onPointerDown={(e) => {
        if (e.target.classList.contains("editor-overlay")) close();
      }}
    >
      <div className="editor-modal" data-prov={prov}>
        <div className="editor-head">
          <span className={"prov-chip " + prov}>{chip}</span>
          <input
            className="editor-label"
            value={label}
            placeholder="标签（可选，作星图标题）…"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={key}
            maxLength={24}
          />
          <div className="editor-tabs">
            <button
              className={"etab" + (tab === "write" ? " on" : "")}
              onClick={() => setTab("write")}
            >
              编辑
            </button>
            <button
              className={"etab" + (tab === "preview" ? " on" : "")}
              onClick={() => setTab("preview")}
            >
              预览
            </button>
          </div>
          <button className="editor-close" onClick={close} title="完成 (Esc)">
            ✕
          </button>
        </div>
        <div className="editor-body">
          {tab === "write" ? (
            <textarea
              ref={ta}
              className="editor-text"
              value={draft}
              placeholder={
                prov === "system"
                  ? "设定整棵树的前提与口吻…"
                  : "写点什么…（支持 Markdown，⌘↵ 保存并关闭）"
              }
              onChange={(e) => {
                setDraft(e.target.value);
                auto();
              }}
              onKeyDown={key}
            />
          ) : (
            <div
              className="editor-preview node-body"
              dangerouslySetInnerHTML={{
                __html: window.renderMarkdown(draft || "（空）"),
              }}
            ></div>
          )}
        </div>
        <div className="editor-foot">
          <button
            className="ebtn solid"
            onClick={() => {
              onCommit(node.id, draft, label);
              onAskAI(node.id);
            }}
            title="沿脉络生成续写（新分支）"
          >
            ✦ 续写
          </button>
          <span className="spacer"></span>
          {prov !== "system" &&
            (confirmDel ? (
              <span className="del-confirm">
                <button
                  className="ebtn danger-solid"
                  onClick={() => onDelete(node.id)}
                >
                  确认删除
                </button>
                <button className="ebtn" onClick={() => setConfirmDel(false)}>
                  取消
                </button>
              </span>
            ) : hasKids ? (
              <button
                className="ebtn ghost-danger"
                onClick={() => setConfirmDel(true)}
                title="含子分支，删除需确认"
              >
                删除
              </button>
            ) : (
              <button
                className="ebtn ghost-danger"
                onClick={() => onDelete(node.id)}
              >
                删除
              </button>
            ))}
          <button className="ebtn" onClick={close}>
            完成 <span className="k">⌘↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
