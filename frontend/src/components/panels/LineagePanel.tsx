import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { EyeOff, GitBranch, LocateFixed, Minus, Plus, RefreshCw } from "lucide-react";
import type { LineageFrameSnapshot, LineageGraph, LineageLayout, LineageNode } from "../../types";

type LineagePanelProps = {
  graph?: LineageGraph;
  layout?: LineageLayout;
  snapshot?: LineageFrameSnapshot;
  frame: number;
  loading: boolean;
  error?: unknown;
  selectedNodeId: string | null;
  labeledNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onGoToCell: (node: LineageNode) => void;
  onHide: () => void;
};

type PanState = { x: number; y: number };

export default function LineagePanel({
  graph,
  layout,
  snapshot,
  frame,
  loading,
  error,
  selectedNodeId,
  labeledNodeId,
  onSelectNode,
  onGoToCell,
  onHide,
}: LineagePanelProps) {
  const nodesById = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node])),
    [graph?.nodes],
  );
  const visibleNodes = useMemo(() => new Set(snapshot?.visibleNodes ?? []), [snapshot?.visibleNodes]);
  const activeNodes = useMemo(() => new Set(snapshot?.activeNodes ?? []), [snapshot?.activeNodes]);
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;
  const [pan, setPan] = useState<PanState>({ x: 0, y: 0 });
  const [scale, setScale] = useState(0.9);
  const dragRef = useRef<{ id: number; x: number; y: number; pan: PanState } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sampledRings = useMemo(() => sampleRings(layout?.rings ?? []), [layout?.rings]);
  const edgePaths = useMemo(() => buildEdgePaths(layout, snapshot), [layout, snapshot]);
  const extent = useMemo(
    () => Math.max(220, ...(layout?.rings ?? []).map((ring) => ring.radius + 80)),
    [layout?.rings],
  );
  const visibleLayoutNodes = useMemo(() => {
    if (!layout) {
      return [];
    }
    return [...visibleNodes]
      .map((nodeId) => layout.nodes[nodeId])
      .filter(Boolean)
      .sort((a, b) => a.radius - b.radius || a.id.localeCompare(b.id));
  }, [layout, visibleNodes]);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 2 && event.button !== 1) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const worldUnitsPerPixel = (extent * 2) / Math.max(1, Math.min(rect.width, rect.height));
    setPan({
      x: drag.pan.x + ((event.clientX - drag.x) * worldUnitsPerPixel) / scale,
      y: drag.pan.y + ((event.clientY - drag.y) * worldUnitsPerPixel) / scale,
    });
  };

  const stopPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.id === event.pointerId) {
      dragRef.current = null;
    }
  };

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    const nextScale = clamp(scale * factor, 0.18, 5.5);
    const cursor = svgPointFromCursor(svg, event.clientX, event.clientY, extent);
    const worldX = (cursor.x - pan.x) / scale;
    const worldY = (cursor.y - pan.y) / scale;
    setScale(nextScale);
    setPan({
      x: cursor.x - worldX * nextScale,
      y: cursor.y - worldY * nextScale,
    });
  };

  const resetView = () => {
    setPan({ x: 0, y: 0 });
    setScale(0.9);
  };

  return (
    <aside className="lineage-panel">
      <div className="panel-heading lineage-heading">
        <span className="panel-heading-title">
          <GitBranch size={16} />
          Lineage
        </span>
        <div className="panel-heading-actions">
          {loading ? <RefreshCw className="spin-small" size={15} /> : null}
          <button type="button" className="panel-hide-button" onClick={onHide} title="Hide lineage">
            <EyeOff size={15} />
          </button>
        </div>
      </div>

      <div className="lineage-stage">
        <svg
          ref={svgRef}
          className="lineage-svg"
          role="img"
          aria-label="Lineage tree"
          viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}
          preserveAspectRatio="xMidYMid meet"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopPan}
          onPointerCancel={stopPan}
          onWheel={handleWheel}
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            {sampledRings.map((ring) => (
              <g key={ring.frame} className="lineage-ring">
                <circle cx={0} cy={0} r={ring.radius} />
                {ring.label ? (
                  <text x={ring.radius + 7} y={-5}>
                    t{ring.frame}
                  </text>
                ) : null}
              </g>
            ))}
            {edgePaths.map((edge) => (
              <path
                key={edge.id}
                className={`lineage-edge ${edge.active ? "active" : ""}`}
                d={edge.path}
                style={{ "--lineage-color": edge.color } as CSSProperties}
              />
            ))}
            {visibleLayoutNodes.map((node) => {
              const active = activeNodes.has(node.id);
              const selected = selectedNodeId === node.id;
              const graphNode = nodesById.get(node.id);
              return (
                <g
                  key={node.id}
                  className={`lineage-node ${active ? "active" : "past"} ${selected ? "selected" : ""}`}
                  transform={`translate(${node.x} ${node.y})`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectNode(node.id);
                  }}
                >
                  <circle
                    r={active ? 6 : 4.5}
                    style={{ "--lineage-color": node.color } as CSSProperties}
                  />
                  <text x={8} y={4}>
                    {graphNode?.name ?? node.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="lineage-controls">
          <button type="button" onClick={() => setScale((value) => clamp(value * 1.16, 0.18, 5.5))}>
            <Plus size={14} />
          </button>
          <button type="button" onClick={() => setScale((value) => clamp(value / 1.16, 0.18, 5.5))}>
            <Minus size={14} />
          </button>
          <button type="button" onClick={resetView}>
            <LocateFixed size={14} />
          </button>
        </div>
        <div className="interaction-hint lineage-interaction-hint">
          Right-drag to move, wheel to zoom, click a node
        </div>
        {error ? <div className="lineage-empty">Lineage unavailable</div> : null}
        {!error && !visibleLayoutNodes.length ? <div className="lineage-empty">No lineage data at t{frame}</div> : null}
        {selectedNode ? (
          <NodeDetails
            node={selectedNode}
            active={activeNodes.has(selectedNode.id)}
            labeled={selectedNode.id === labeledNodeId}
            selectedFrame={frame}
            onGoToCell={() => onGoToCell(selectedNode)}
            onClose={() => onSelectNode(null)}
          />
        ) : null}
      </div>
    </aside>
  );
}

function NodeDetails({
  node,
  active,
  labeled,
  selectedFrame,
  onGoToCell,
  onClose,
}: {
  node: LineageNode;
  active: boolean;
  labeled: boolean;
  selectedFrame: number;
  onGoToCell: () => void;
  onClose: () => void;
}) {
  return (
    <div className="lineage-node-card">
      <div className="lineage-node-card-heading">
        <strong>{node.name}</strong>
        <button type="button" onClick={onClose} aria-label="Close node details">x</button>
      </div>
      <dl>
        <div>
          <dt>State</dt>
          <dd>{active ? `active at t${selectedFrame}` : "inactive"}</dd>
        </div>
        <div>
          <dt>Frame</dt>
          <dd>{node.firstFrame}-{node.lastFrame}</dd>
        </div>
        <div>
          <dt>Parent</dt>
          <dd>{node.parentId ?? "root"}</dd>
        </div>
        <div>
          <dt>Children</dt>
          <dd>{node.children.length ? node.children.join(", ") : "none"}</dd>
        </div>
      </dl>
      <button type="button" className={`lineage-goto-button ${labeled ? "active" : ""}`} onClick={onGoToCell}>
        <LocateFixed size={15} />
        {labeled ? "Remove label" : "Go to cell"}
      </button>
    </div>
  );
}

function buildEdgePaths(
  layout: LineageLayout | undefined,
  snapshot: LineageFrameSnapshot | undefined,
): { id: string; path: string; color: string; active: boolean }[] {
  if (!layout || !snapshot) {
    return [];
  }
  const activeNodes = new Set(snapshot.activeNodes);
  return snapshot.visibleEdges.flatMap((edge) => {
    const source = layout.nodes[edge.source];
    const target = layout.nodes[edge.target];
    if (!source || !target) {
      return [];
    }
    const radialX = target.radius * Math.cos(source.angle);
    const radialY = target.radius * Math.sin(source.angle);
    const delta = normalizeAngle(target.angle - source.angle);
    const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
    const sweep = delta >= 0 ? 1 : 0;
    const path = [
      `M ${source.x.toFixed(2)} ${source.y.toFixed(2)}`,
      `L ${radialX.toFixed(2)} ${radialY.toFixed(2)}`,
      `A ${target.radius.toFixed(2)} ${target.radius.toFixed(2)} 0 ${largeArc} ${sweep} ${target.x.toFixed(2)} ${target.y.toFixed(2)}`,
    ].join(" ");
    return [{
      id: edge.id,
      path,
      color: target.color,
      active: activeNodes.has(edge.target),
    }];
  });
}

function sampleRings(rings: LineageLayout["rings"]): Array<LineageLayout["rings"][number] & { label: boolean }> {
  if (rings.length <= 80) {
    return rings.map((ring, index) => ({
      ...ring,
      label: index === 0 || index === rings.length - 1 || ring.frame % 10 === 0,
    }));
  }
  const step = Math.max(1, Math.ceil(rings.length / 80));
  return rings
    .filter((ring, index) => index === 0 || index === rings.length - 1 || index % step === 0)
    .map((ring, index, sampled) => ({
      ...ring,
      label: index === 0 || index === sampled.length - 1 || ring.frame % 20 === 0,
    }));
}

function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) {
    value -= Math.PI * 2;
  }
  while (value < -Math.PI) {
    value += Math.PI * 2;
  }
  return value;
}

function svgPointFromCursor(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  extent: number,
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const viewSize = extent * 2;
  const scale = Math.min(rect.width, rect.height) / viewSize;
  const renderedWidth = viewSize * scale;
  const renderedHeight = viewSize * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  return {
    x: (clientX - rect.left - offsetX) / scale - extent,
    y: (clientY - rect.top - offsetY) / scale - extent,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
