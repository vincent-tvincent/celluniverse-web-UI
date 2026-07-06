import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EyeOff, GitBranch, LocateFixed, Minus, Plus, RefreshCw, X as XIcon } from "lucide-react";
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
  onCloseNodeDetails: () => void;
  onGoToCell: (node: LineageNode) => void;
  onHide: () => void;
};

type PanState = { x: number; y: number };

const LINEAGE_MIN_ZOOM = 0.18;
const LINEAGE_MAX_ZOOM = 18;
const LINEAGE_MIN_NODE_ARC_SPACING = 24;
const LINEAGE_MIN_RING_GAP = 18;

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
  onCloseNodeDetails,
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
  const displayLayout = useMemo(() => resolveLineageLayout(layout, graph), [layout, graph]);
  const sampledRings = useMemo(
    () => sampleRings(displayLayout?.rings ?? [], displayLayout?.resumeFromFrame ?? null),
    [displayLayout?.resumeFromFrame, displayLayout?.rings],
  );
  const edgePaths = useMemo(() => buildEdgePaths(displayLayout, snapshot), [displayLayout, snapshot]);
  const extent = useMemo(
    () => Math.max(220, ...(displayLayout?.rings ?? []).map((ring) => ring.radius + 80)),
    [displayLayout?.rings],
  );
  const visibleLayoutNodes = useMemo(() => {
    if (!displayLayout) {
      return [];
    }
    return [...visibleNodes]
      .map((nodeId) => displayLayout.nodes[nodeId])
      .filter(Boolean)
      .sort((a, b) => a.radius - b.radius || a.id.localeCompare(b.id));
  }, [displayLayout, visibleNodes]);

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
      x: drag.pan.x + (event.clientX - drag.x) * worldUnitsPerPixel,
      y: drag.pan.y + (event.clientY - drag.y) * worldUnitsPerPixel,
    });
  };

  const stopPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.id === event.pointerId) {
      dragRef.current = null;
    }
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const factor = wheelZoomFactor(event);
      const nextScale = clamp(scale * factor, LINEAGE_MIN_ZOOM, LINEAGE_MAX_ZOOM);
      const cursor = svgPointFromCursor(svg, event.clientX, event.clientY, extent);
      const worldX = (cursor.x - pan.x) / scale;
      const worldY = (cursor.y - pan.y) / scale;
      setScale(nextScale);
      setPan({
        x: cursor.x - worldX * nextScale,
        y: cursor.y - worldY * nextScale,
      });
    };

    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", handleWheel);
    };
  }, [extent, pan.x, pan.y, scale]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return undefined;
    }
    const stopBrowserGesture = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    svg.addEventListener("gesturestart", stopBrowserGesture, { passive: false });
    svg.addEventListener("gesturechange", stopBrowserGesture, { passive: false });
    return () => {
      svg.removeEventListener("gesturestart", stopBrowserGesture);
      svg.removeEventListener("gesturechange", stopBrowserGesture);
    };
  }, []);

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
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            {sampledRings.map((ring) => (
              <g
                key={ring.frame}
                className={`lineage-ring ${ring.frame === displayLayout?.resumeFromFrame ? "resume-ring" : ""}`}
              >
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
          <button type="button" onClick={() => setScale((value) => clamp(value * 1.16, LINEAGE_MIN_ZOOM, LINEAGE_MAX_ZOOM))}>
            <Plus size={14} />
          </button>
          <button type="button" onClick={() => setScale((value) => clamp(value / 1.16, LINEAGE_MIN_ZOOM, LINEAGE_MAX_ZOOM))}>
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
            onClose={onCloseNodeDetails}
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
        <button type="button" className="lineage-close-button" onClick={onClose} aria-label="Close node details">
          <XIcon size={15} />
        </button>
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

function resolveLineageLayout(
  layout: LineageLayout | undefined,
  graph: LineageGraph | undefined,
): LineageLayout | undefined {
  if (!layout || !graph || !graph.nodes.length) {
    return layout;
  }
  const nodes = Object.fromEntries(
    Object.entries(layout.nodes).map(([nodeId, node]) => [nodeId, { ...node }]),
  );
  const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const roots = (graph.roots.length ? graph.roots : graph.nodes.filter((node) => !node.parentId).map((node) => node.id))
    .filter((nodeId) => nodes[nodeId])
    .sort(compareLineageIds);
  if (!roots.length) {
    return layout;
  }
  const sectorWidth = (Math.PI * 2) / roots.length;
  const gap = Math.min((Math.PI / 180) * 18, sectorWidth * 0.24);
  const radiusRequirements = new Map<number, number>();

  for (const [rootIndex, root] of roots.entries()) {
    const start = -Math.PI + rootIndex * sectorWidth + gap / 2;
    const end = -Math.PI + (rootIndex + 1) * sectorWidth - gap / 2;
    const lanes = orderedLineageLanes(root, graphNodes, nodes, new Set()) || [root];
    const width = Math.max(0.001, end - start);
    const countsByRadius = new Map<number, number>();

    lanes.forEach((nodeId, laneIndex) => {
      const node = nodes[nodeId];
      if (!node) {
        return;
      }
      const angle = start + width * ((laneIndex + 0.5) / lanes.length);
      node.angle = angle;
      const key = lineageRadiusKey(node);
      countsByRadius.set(key, (countsByRadius.get(key) ?? 0) + 1);
    });

    countsByRadius.forEach((count, key) => {
      const requiredRadius = (count * LINEAGE_MIN_NODE_ARC_SPACING) / width;
      radiusRequirements.set(key, Math.max(radiusRequirements.get(key) ?? 0, requiredRadius));
    });
  }

  const expandedRings: LineageLayout["rings"] = [];
  const expandedRadiusByKey = new Map<number, number>();
  const sortedRings = [...layout.rings].sort((a, b) => a.frame - b.frame);
  let previousRadius = 0;
  for (const ring of sortedRings) {
    const requiredRadius = radiusRequirements.get(ring.frame) ?? 0;
    const radius = Math.max(
      ring.radius,
      requiredRadius,
      expandedRings.length ? previousRadius + LINEAGE_MIN_RING_GAP : ring.radius,
    );
    expandedRings.push({ ...ring, radius });
    expandedRadiusByKey.set(ring.frame, radius);
    previousRadius = radius;
  }

  Object.values(nodes).forEach((node) => {
    const key = lineageRadiusKey(node);
    const radius = expandedRadiusByKey.get(key) ?? Math.max(node.radius, radiusRequirements.get(key) ?? 0);
    node.radius = radius;
    node.x = radius * Math.cos(node.angle);
    node.y = radius * Math.sin(node.angle);
  });

  return { ...layout, rings: expandedRings.length ? expandedRings : layout.rings, nodes };
}

function lineageRadiusKey(node: LineageLayout["nodes"][string]): number {
  if (Number.isFinite(node.radiusFrame)) {
    return node.radiusFrame;
  }
  return Math.round(node.radius);
}

function orderedLineageLanes(
  nodeId: string,
  graphNodes: Map<string, LineageNode>,
  layoutNodes: Record<string, LineageLayout["nodes"][string]>,
  seen: Set<string>,
): string[] {
  if (seen.has(nodeId) || !layoutNodes[nodeId]) {
    return [];
  }
  seen.add(nodeId);
  const graphNode = graphNodes.get(nodeId);
  const children = (graphNode?.children ?? [])
    .filter((childId) => layoutNodes[childId])
    .sort(compareLineageIds);
  if (!children.length) {
    return [nodeId];
  }
  const lanes: string[] = [];
  const midpoint = Math.floor(children.length / 2);
  children.forEach((childId, index) => {
    if (index === midpoint) {
      lanes.push(nodeId);
    }
    lanes.push(...orderedLineageLanes(childId, graphNodes, layoutNodes, seen));
  });
  if (!lanes.includes(nodeId)) {
    lanes.push(nodeId);
  }
  return lanes;
}

function compareLineageIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
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
    const routeRadius = lineageRouteRadius(edge, layout, source.radius, target.radius);
    const radialX = routeRadius * Math.cos(source.angle);
    const radialY = routeRadius * Math.sin(source.angle);
    const arcX = routeRadius * Math.cos(target.angle);
    const arcY = routeRadius * Math.sin(target.angle);
    const delta = normalizeAngle(target.angle - source.angle);
    const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
    const sweep = delta >= 0 ? 1 : 0;
    const path = [
      `M ${source.x.toFixed(2)} ${source.y.toFixed(2)}`,
      `L ${radialX.toFixed(2)} ${radialY.toFixed(2)}`,
      `A ${routeRadius.toFixed(2)} ${routeRadius.toFixed(2)} 0 ${largeArc} ${sweep} ${arcX.toFixed(2)} ${arcY.toFixed(2)}`,
      `L ${target.x.toFixed(2)} ${target.y.toFixed(2)}`,
    ].join(" ");
    return [{
      id: edge.id,
      path,
      color: target.color,
      active: activeNodes.has(edge.target),
    }];
  });
}

function lineageRouteRadius(
  edge: LineageLayout["edges"][number],
  layout: LineageLayout,
  sourceRadius: number,
  targetRadius: number,
): number {
  const splitRadius = radiusForLineageFrame(edge.frame, layout);
  if (splitRadius != null) {
    return clamp(splitRadius, sourceRadius, targetRadius);
  }
  if (typeof edge.routeRadius === "number" && Number.isFinite(edge.routeRadius)) {
    return clamp(edge.routeRadius, sourceRadius, targetRadius);
  }
  return targetRadius;
}

function radiusForLineageFrame(frame: number | undefined, layout: LineageLayout): number | null {
  if (typeof frame !== "number" || !Number.isFinite(frame)) {
    return null;
  }
  const directRing = layout.rings.find((ring) => ring.frame === frame);
  if (directRing) {
    return directRing.radius;
  }
  if (layout.firstFrame == null || !Number.isFinite(layout.firstFrame)) {
    return null;
  }
  const innerRadius = layout.innerRadius ?? 42;
  return innerRadius + Math.max(0, frame - layout.firstFrame) * layout.ringSpacing;
}

function sampleRings(
  rings: LineageLayout["rings"],
  resumeFromFrame: number | null,
): Array<LineageLayout["rings"][number] & { label: boolean }> {
  if (rings.length <= 80) {
    return rings.map((ring, index) => ({
      ...ring,
      label: ring.frame === resumeFromFrame || index === 0 || index === rings.length - 1 || ring.frame % 10 === 0,
    }));
  }
  const step = Math.max(1, Math.ceil(rings.length / 80));
  return rings
    .filter((ring, index) => (
      ring.frame === resumeFromFrame || index === 0 || index === rings.length - 1 || index % step === 0
    ))
    .map((ring, index, sampled) => ({
      ...ring,
      label: ring.frame === resumeFromFrame || index === 0 || index === sampled.length - 1 || ring.frame % 20 === 0,
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

function wheelZoomFactor(event: WheelEvent): number {
  const deltaPixels = clamp(wheelDeltaPixels(event), -180, 180);
  return Math.exp(-deltaPixels * 0.0012);
}

function wheelDeltaPixels(event: WheelEvent): number {
  if (event.deltaMode === 1) {
    return event.deltaY * 32;
  }
  if (event.deltaMode === 2) {
    return event.deltaY * window.innerHeight;
  }
  return event.deltaY;
}
