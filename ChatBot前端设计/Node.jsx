/* ============================================================
   Node.jsx — a note on the board. Two renderings:
   near = paper card,  far = constellation star.
   Click a card to open the dedicated Markdown editor (modal).
   New branches are made by dragging the bottom + handle.
   A node's optional `label` titles it (and names it in the star view).
   ============================================================ */
function NodeCard(props) {
  const {
    node, far, selected, editing, streaming,
    onDelete, onToggleCollapse, onAskAI,
    onBranchPointerDown, onNodePointerDown, onFocus, registerEl, showStarLabel,
  } = props;

  const prov = node.role === "system" ? "system" : (node.gen ? "gen" : "write");
  const elRef = React.useRef(null);
  const stop = (e) => e.stopPropagation();

  React.useEffect(() => { registerEl && registerEl(node.id, elRef.current); }, []);

  // delete: leaf nodes go straight away; nodes WITH children ask to confirm
  const hasKids = (node.childrenIds || []).length > 0;
  const deg = node._descendants || 0;
  const [confirmDel, setConfirmDel] = React.useState(false);
  const delT = React.useRef(0);
  const armDelete = () => { setConfirmDel(true); clearTimeout(delT.current); delT.current = setTimeout(() => setConfirmDel(false), 2800); };
  React.useEffect(() => () => clearTimeout(delT.current), []);

  /* ---------- far / star view ---------- */
  if (far) {
    const r = 30;
    const fallback = (node.text || "（空）").replace(/[#*`>\-]/g, "").trim().split("\n")[0].slice(0, 14);
    const short = (node.label && node.label.trim()) ? node.label.trim() : fallback;
    return (
      <div ref={elRef} className={"node" + (selected ? " selected" : "") + (node.archived ? " archived" : "") + (node._fresh ? " fresh" : "")} data-prov={prov} data-node-id={node.id}>
        <div className={"node-inner " + (node._anim || "")}>
          <div className="star-wrap" style={{ "--r": r + "px", "--label-op": showStarLabel ? 1 : 0 }}
            onPointerDown={(e) => { e.stopPropagation(); onNodePointerDown(e, node.id); }}
            onDoubleClick={(e) => { e.stopPropagation(); onFocus(node.id); }}>
            <span className={"star " + prov}></span>
            <span className="star-label">{short}</span>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- near / card view ---------- */
  const showHead = prov === "system" || prov === "gen";
  return (
    <div ref={elRef}
      className={"node" + (selected ? " selected" : "") + (node.archived ? " archived" : "") + (editing ? " editing" : "") + (node._fresh ? " fresh" : "")}
      data-prov={prov} data-node-id={node.id}
      onPointerDown={(e) => onNodePointerDown(e, node.id)}>
      <div className="node-center">
        <div className={"node-inner " + (node._anim || "")}>
          <div className="card">
            {showHead && (
              <div className="node-head">
                {prov === "system" && <span className="sys-badge">⟡ 系统提示词</span>}
                {prov === "gen" && <span className="gen-mark" title="由 AI 续写生成">✦</span>}
                <span className="spacer"></span>
              </div>
            )}

            {node.label && node.label.trim() && <div className="card-title">{node.label.trim()}</div>}

            <div className={"node-body" + (!streaming ? " clamp" : "")}
              dangerouslySetInnerHTML={{
                __html: node.text
                  ? window.renderMarkdown(node.text) + (streaming ? '<span class="caret"></span>' : "")
                  : (streaming ? '<span class="thinking"><i></i><i></i><i></i></span>'
                    : '<p style="color:var(--ink-faint)">空白便签 · 点击书写</p>'),
              }} />

            {!streaming && (
              <div className="node-foot">
                <button className="nbtn primary" onPointerDown={stop} onClick={() => onAskAI(node.id)} title="沿这条脉络生成续写">✦ 续写</button>
                {prov !== "system" && (
                  hasKids
                    ? (confirmDel ? (
                        <span className="del-confirm">
                          <button className="nbtn danger-solid" onPointerDown={stop} onClick={() => onDelete(node.id)}>确认删除</button>
                          <button className="nbtn" onPointerDown={stop} onClick={() => setConfirmDel(false)}>取消</button>
                        </span>
                      ) : (
                        <button className="nbtn ghost-danger" onPointerDown={stop} onClick={armDelete} title="含子分支，删除需确认">删除</button>
                      ))
                    : <button className="nbtn ghost-danger" onPointerDown={stop} onClick={() => onDelete(node.id)}>删除</button>
                )}
              </div>
            )}
          </div>

          {hasKids && (
            <div className="collapse-pill" title={node.collapsed ? "展开分支" : "折叠分支"}
              onPointerDown={stop} onClick={() => onToggleCollapse(node.id, "subtree")}>
              {node.collapsed ? (deg > 0 ? deg : "+") : "–"}
            </div>
          )}

          {!node.archived && (
            <div className="branch-handle" title="拖出新分支"
              onPointerDown={(e) => { e.stopPropagation(); onBranchPointerDown(e, node.id); }}>+<span className="hint">拖出分支</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

window.NodeCard = NodeCard;
