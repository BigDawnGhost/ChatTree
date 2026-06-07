/* ============================================================
   force.js — lightweight force-directed layout
   center-coordinate model. positions live in `pos`:
     pos[id] = { x, y, vx, vy, pinned }   (x,y = node CENTER)
   exposes: window.stepForces(pos, meta, links, params, alpha)
            window.initialPositions(nodes, rootId, opts)
   ============================================================ */
(function () {
  "use strict";

  // seed roughly tree-shaped positions so the sim starts stable
  function initialPositions(nodes, rootId, opts) {
    opts = opts || {};
    const colW = opts.colW || 380, rowH = opts.rowH || 190;
    const pos = {};
    let cursor = 0;
    const kidsOf = (id) => (nodes[id] ? (nodes[id].childrenIds || []).filter((c) => nodes[c]) : []);
    // top-down tree: depth grows DOWNWARD (y), siblings spread sideways (x)
    function walk(id, depth) {
      const kids = kidsOf(id);
      let x;
      if (!kids.length) { x = cursor * colW; cursor++; }
      else { const xs = kids.map((c) => walk(c, depth + 1)); x = (xs[0] + xs[xs.length - 1]) / 2; }
      pos[id] = { x, y: depth * rowH, vx: 0, vy: 0, pinned: id === rootId };
      return x;
    }
    if (nodes[rootId]) walk(rootId, 0);
    return pos;
  }

  function stepForces(pos, meta, links, params, alpha) {
    const ids = Object.keys(pos);
    const L = params.L, charge = params.charge, linkK = params.linkK,
      damping = params.damping, maxV = params.maxV, gap = params.collideGap;

    const ax = {}, ay = {};
    for (const id of ids) { ax[id] = 0; ay[id] = 0; }

    // pairwise charge repulsion (keeps the constellation airy)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy + 0.01; }
        const d = Math.sqrt(d2);
        const rep = charge / d2;
        const ux = dx / d, uy = dy / d;
        ax[ids[i]] -= ux * rep; ay[ids[i]] -= uy * rep;
        ax[ids[j]] += ux * rep; ay[ids[j]] += uy * rep;
      }
    }

    // link springs — child pulled to a point L BELOW its parent (top-down tree)
    for (const lk of links) {
      const s = pos[lk.s], t = pos[lk.t];
      if (!s || !t) continue;
      const tx = s.x, ty = s.y + L;
      ax[lk.t] += (tx - t.x) * linkK; ay[lk.t] += (ty - t.y) * linkK;
      ax[lk.s] += (t.x - tx) * linkK * 0.2; ay[lk.s] += (t.y - ty) * linkK * 0.2;
    }

    // integrate velocity
    for (const id of ids) {
      const n = pos[id];
      if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
      n.vx = (n.vx + ax[id] * alpha) * damping;
      n.vy = (n.vy + ay[id] * alpha) * damping;
      const sp = Math.hypot(n.vx, n.vy);
      if (sp > maxV) { n.vx *= maxV / sp; n.vy *= maxV / sp; }
      n.x += n.vx; n.y += n.vy;
    }

    // collision pass — hard separation of overlapping AABBs (auto-避让, never overlap)
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos[ids[i]], b = pos[ids[j]];
          const ma = meta[ids[i]] || { w: 300, h: 140 }, mb = meta[ids[j]] || { w: 300, h: 140 };
          const dx = b.x - a.x, dy = b.y - a.y;
          const ox = (ma.w / 2 + mb.w / 2 + gap) - Math.abs(dx);
          const oy = (ma.h / 2 + mb.h / 2 + gap) - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            if (ox < oy) {
              const s = (dx === 0 ? (Math.random() - 0.5) : Math.sign(dx));
              const push = ox * 0.5 * s;
              moveX(a, -push); moveX(b, push);
            } else {
              const s = (dy === 0 ? (Math.random() - 0.5) : Math.sign(dy));
              const push = oy * 0.5 * s;
              moveY(a, -push); moveY(b, push);
            }
          }
        }
      }
    }

    function moveX(n, d) { if (!n.pinned) n.x += d; }
    function moveY(n, d) { if (!n.pinned) n.y += d; }
  }

  window.initialPositions = initialPositions;
  window.stepForces = stepForces;
})();
