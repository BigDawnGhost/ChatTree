/* ============================================================
   md.js  — tiny markdown renderer + tidy tree layout
   exposes: window.renderMarkdown(text), window.computeLayout(...)
   ============================================================ */
(function () {
  "use strict";

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // inline: code, bold/italic, strikethrough, links (code spans protected from other rules)
  function inline(s) {
    s = esc(s);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img alt="$1" src="$2">');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/(^|[^_])__([^_]+)__/g, "$1<strong>$2</strong>");
    s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => "<code>" + codes[+i] + "</code>");
    return s;
  }

  function renderMarkdown(text) {
    if (text == null) return "";
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");
    let html = "";
    let i = 0;
    let listType = null;

    function closeList() {
      if (listType) { html += "</" + listType + ">"; listType = null; }
    }

    while (i < lines.length) {
      let line = lines[i];

      // fenced code block
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        closeList();
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // skip closing fence
        html += "<pre><code>" + esc(buf.join("\n")) + "</code></pre>";
        continue;
      }

      // horizontal rule
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeList(); html += "<hr>"; i++; continue; }

      // heading (h1–h6)
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); html += "<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"; i++; continue; }

      // blockquote
      if (/^>\s?/.test(line)) {
        closeList();
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
        html += "<blockquote>" + inline(buf.join(" ")) + "</blockquote>";
        continue;
      }

      // unordered list (-, *, +) with optional task checkbox
      if (/^\s*[-*+]\s+/.test(line)) {
        if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
        let item = line.replace(/^\s*[-*+]\s+/, "");
        const task = item.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) html += '<li class="task"><input type="checkbox" disabled' + (task[1] === " " ? "" : " checked") + ">" + inline(task[2]) + "</li>";
        else html += "<li>" + inline(item) + "</li>";
        i++; continue;
      }
      // ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
        html += "<li>" + inline(line.replace(/^\s*\d+\.\s+/, "")) + "</li>";
        i++; continue;
      }

      // blank line
      if (/^\s*$/.test(line)) { closeList(); i++; continue; }

      // paragraph (gather consecutive non-empty, non-special lines)
      closeList();
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,6}\s|>|```|\s*[-*+]\s|\s*\d+\.\s|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      html += "<p>" + inline(buf.join("<br>")) + "</p>";
    }
    closeList();
    return html;
  }

  /* ---------- tidy tree layout (left → right) ----------
     nodes: {id:{id,parentId,collapsed,archived,_h}}  rootId
     returns positions {id:{x,y}} plus bounds.
     x by depth column; y by leaf packing (post-order).
  */
  function computeLayout(nodes, rootId, opts) {
    opts = opts || {};
    const colW = opts.colW || 360;    // horizontal stride per depth
    const rowH = opts.rowH || 150;    // vertical stride per leaf
    const pos = {};
    let cursor = 0;

    function childrenOf(id) {
      const n = nodes[id];
      if (!n) return [];
      const kids = (n.childrenIds || []).filter((c) => nodes[c]);
      return kids;
    }

    function walk(id, depth) {
      const n = nodes[id];
      const kids = n.collapsed ? [] : childrenOf(id);
      let y;
      if (kids.length === 0) {
        y = cursor * rowH;
        cursor += 1;
      } else {
        const ys = kids.map((c) => walk(c, depth + 1));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      pos[id] = { x: depth * colW, y: y, depth: depth };
      return y;
    }

    if (nodes[rootId]) walk(rootId, 0);

    // bounds
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    Object.values(pos).forEach((p) => {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    return { pos, bounds: { minX, minY, maxX, maxY }, colW, rowH };
  }

  window.renderMarkdown = renderMarkdown;
  window.computeLayout = computeLayout;
})();
