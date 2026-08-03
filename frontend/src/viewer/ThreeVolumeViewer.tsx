import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Moon, Sun } from "lucide-react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { defaultViewerConfig, POINT_SIZE_MAX, POINT_SIZE_MIN, type ViewerRuntimeConfig } from "../config";
import { uiPalette } from "../theme/palette";
import type { CellRecord } from "../types";
import { getColorMap, type ColorMapId } from "./colorMaps";
import { applyContrastLimits, type ContrastLimits } from "./contrast";
import type { ViewerHoverSample } from "./hover";
import type { PointCloudPreviewData } from "./pointCloud";
import type { VolumeData } from "./tiff";

export type CellTrajectoryPoint = {
  frame: number;
  cell: CellRecord;
};

export type CellTrajectory = {
  id: string;
  color: string;
  points: CellTrajectoryPoint[];
  highlighted?: boolean;
};

type Props = {
  real?: VolumeData;
  synth?: VolumeData;
  realPointCloud?: PointCloudPreviewData;
  synthPointCloud?: PointCloudPreviewData;
  cells: CellRecord[];
  realEnabled: boolean;
  synthEnabled: boolean;
  cellsEnabled: boolean;
  cellCentersEnabled: boolean;
  cellOutlineColors?: Record<string, string>;
  realMap: ColorMapId;
  synthMap: ColorMapId;
  realOpacity: number;
  synthOpacity: number;
  realContrastLimits: ContrastLimits;
  synthContrastLimits: ContrastLimits;
  pointAlphaByBrightness?: boolean;
  pointSize?: number;
  pointSizeByBrightness?: boolean;
  maxPixelRatio: number;
  pointCloudConfig?: ViewerRuntimeConfig["pointCloud"];
  focusCellIds: string[];
  focusFrame: number | null;
  focusRequestId: number;
  labeledCellIds: string[];
  cellTrajectories?: CellTrajectory[];
  frame: number;
  backgroundMode: ViewerBackgroundMode;
  onBackgroundModeChange: (mode: ViewerBackgroundMode) => void;
  onFirstRender?: () => void;
  onHoverSample?: (sample: ViewerHoverSample | null) => void;
  onCellDoubleClick?: (cellName: string) => void;
};

type PointCloudData = {
  positions: Float32Array;
  colors: Float32Array;
  sourceX: Float32Array;
  sourceY: Float32Array;
  sourceZ: Float32Array;
  brightness: Float32Array;
  alpha: Float32Array;
  pointCount: number;
};

type InterleaveRole = "real" | "synth" | "none";
export type ViewerBackgroundMode = "bright" | "dark";

type CameraViewState = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  zoom: number;
  worldWidth: number;
  worldHeight: number;
  worldDepth: number;
};

const pointCloudCache = new WeakMap<VolumeData, Map<string, PointCloudData>>();
const previewPointCloudCache = new WeakMap<PointCloudPreviewData, Map<string, PointCloudData>>();

export default function ThreeVolumeViewer({
  real,
  synth,
  realPointCloud,
  synthPointCloud,
  cells,
  realEnabled,
  synthEnabled,
  cellsEnabled,
  cellCentersEnabled,
  cellOutlineColors,
  realMap,
  synthMap,
  realOpacity,
  synthOpacity,
  realContrastLimits,
  synthContrastLimits,
  pointAlphaByBrightness = false,
  pointSize,
  pointSizeByBrightness = false,
  maxPixelRatio,
  pointCloudConfig,
  focusCellIds,
  focusFrame,
  focusRequestId,
  labeledCellIds,
  cellTrajectories = [],
  frame,
  backgroundMode,
  onBackgroundModeChange,
  onFirstRender,
  onHoverSample,
  onCellDoubleClick,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraViewRef = useRef<CameraViewState | null>(null);
  const appliedFocusRequestRef = useRef(0);

  useEffect(() => {
    const mount = mountRef.current;
    const base = getVolumeDimensions(real, synth, realPointCloud, synthPointCloud);
    if (!mount || !base) {
      return;
    }

    const scene = new THREE.Scene();
    const darkBackground = backgroundMode === "dark";
    scene.background = new THREE.Color(darkBackground ? uiPalette.viewerBackgroundDark : uiPalette.viewerBackground);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const trajectoryCanvas = document.createElement("canvas");
    trajectoryCanvas.style.position = "absolute";
    trajectoryCanvas.style.inset = "0";
    trajectoryCanvas.style.width = "100%";
    trajectoryCanvas.style.height = "100%";
    trajectoryCanvas.style.pointerEvents = "none";
    trajectoryCanvas.style.zIndex = "2";
    mount.appendChild(trajectoryCanvas);
    const trajectoryContext = trajectoryCanvas.getContext("2d");
    const syncTrajectoryCanvasSize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      trajectoryCanvas.width = Math.round(width * pixelRatio);
      trajectoryCanvas.height = Math.round(height * pixelRatio);
      if (trajectoryContext) {
        trajectoryContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }
    };
    syncTrajectoryCanvasSize();

    const group = new THREE.Group();
    scene.add(group);

    const cloudConfig = pointCloudConfig ?? defaultViewerConfig.pointCloud;
    const effectivePointSize = Math.max(
      POINT_SIZE_MIN,
      Math.min(POINT_SIZE_MAX, pointSize ?? cloudConfig.pointSize),
    );
    const worldWidth = 2.4;
    const worldHeight = worldWidth * (base.height / base.width);
    const worldDepth = getRawScaleWorldDepth(base, worldWidth, worldHeight) * cloudConfig.zCompression;
    const aspect = Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight);
    const camera = createCamera(aspect, worldWidth, worldHeight, worldDepth);
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: Math.max(worldWidth, worldHeight, worldDepth) * 0.012 };
    const pointer = new THREE.Vector2();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.75;
    controls.target.set(0, 0, 0);
    restoreCameraView(camera, controls, cameraViewRef.current, worldWidth, worldHeight, worldDepth);
    controls.update();
    const saveCameraView = () => {
      cameraViewRef.current = captureCameraView(camera, controls, worldWidth, worldHeight, worldDepth);
    };
    controls.addEventListener("change", saveCameraView);

    const realPreviewStaggerRole: InterleaveRole = realPointCloud ? "real" : "none";
    const synthPreviewStaggerRole: InterleaveRole = synthPointCloud ? "synth" : "none";
    const realHoverTargets: THREE.Points[] = [];
    if (realEnabled && realPointCloud) {
      const points = addPreviewPointCloud(
        group,
        realPointCloud,
        realMap,
        realOpacity,
        realContrastLimits,
        worldWidth,
        worldHeight,
        worldDepth,
        cloudConfig,
        realPreviewStaggerRole,
        effectivePointSize,
        pointAlphaByBrightness,
        pointSizeByBrightness,
      );
      if (points) {
        realHoverTargets.push(points);
      }
    } else if (realEnabled && real) {
      const points = addVolumePointCloud(
        group,
        real,
        realMap,
        realOpacity,
        realContrastLimits,
        worldWidth,
        worldHeight,
        worldDepth,
        cloudConfig,
        effectivePointSize,
        pointAlphaByBrightness,
        pointSizeByBrightness,
      );
      if (points) {
        realHoverTargets.push(points);
      }
    }
    if (synthEnabled && synthPointCloud) {
      addPreviewPointCloud(
        group,
        synthPointCloud,
        synthMap,
        synthOpacity,
        synthContrastLimits,
        worldWidth,
        worldHeight,
        worldDepth,
        cloudConfig,
        synthPreviewStaggerRole,
        effectivePointSize,
        pointAlphaByBrightness,
        pointSizeByBrightness,
      );
    } else if (synthEnabled && synth) {
      addVolumePointCloud(
        group,
        synth,
        synthMap,
        synthOpacity,
        synthContrastLimits,
        worldWidth,
        worldHeight,
        worldDepth,
        cloudConfig,
        effectivePointSize,
        pointAlphaByBrightness,
        pointSizeByBrightness,
      );
    }
    if (cellCentersEnabled && cells.length) {
      addCellCenters(group, cells, base, worldWidth, worldHeight, worldDepth, darkBackground);
    }
    if (cellsEnabled && cells.length) {
      addCells(group, cells, base, worldWidth, worldHeight, worldDepth, cellOutlineColors);
    }
    const cellInteractionEnabled = Boolean(onCellDoubleClick);
    const cellHitTargets = cellInteractionEnabled && cells.length ? addCellHitTargets(group, cells, base, worldWidth, worldHeight, worldDepth) : [];
    let hoveredCellName: string | null = null;
    let hoveredCellOutline: THREE.Mesh | null = null;
    let viewerPointerDragging = false;

    const box = new THREE.Box3(
      new THREE.Vector3(-worldWidth / 2, -worldHeight / 2, -worldDepth / 2),
      new THREE.Vector3(worldWidth / 2, worldHeight / 2, worldDepth / 2),
    );
    const helper = new THREE.Box3Helper(box, new THREE.Color(darkBackground ? uiPalette.volumeBoxDark : uiPalette.volumeBox));
    group.add(helper);

    const labeledCells = cells.filter((cell) => labeledCellIds.includes(cell.name));
    if (labeledCells.length) {
      addSelectedCellOutlines(group, labeledCells, cells, base, worldWidth, worldHeight, worldDepth);
    }
    const trajectoryProjector = cellTrajectories.length
      ? createTrajectoryProjector(cellTrajectories, cells, base, worldWidth, worldHeight, worldDepth)
      : null;

    if (focusRequestId && focusFrame === frame && appliedFocusRequestRef.current !== focusRequestId) {
      const focusCells = cells.filter((cell) => focusCellIds.includes(cell.name));
      if (focusCells.length) {
        focusCameraOnCells(camera, controls, focusCells, cells, base, worldWidth, worldHeight, worldDepth);
        controls.update();
        appliedFocusRequestRef.current = focusRequestId;
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      syncTrajectoryCanvasSize();
    });
    resizeObserver.observe(mount);

    const clearHoveredCell = () => {
      hoveredCellName = null;
      renderer.domElement.style.cursor = "";
      if (hoveredCellOutline) {
        group.remove(hoveredCellOutline);
        disposeMeshResources(hoveredCellOutline);
        hoveredCellOutline = null;
      }
    };
    const setHoveredCell = (cell: CellRecord | null) => {
      if (hoveredCellName === (cell?.name ?? null)) {
        return;
      }
      clearHoveredCell();
      if (!cell) {
        return;
      }
      hoveredCellName = cell.name;
      renderer.domElement.style.cursor = "pointer";
      hoveredCellOutline = createCellOutlineMesh(cell, cells, base, worldWidth, worldHeight, worldDepth, {
        color: uiPalette.cellHoverHighlight,
        opacity: 0.98,
        scaleFactor: 1.16,
        widthSegments: 32,
        heightSegments: 20,
        depthTest: false,
        depthWrite: false,
        renderOrder: 42,
      });
      group.add(hoveredCellOutline);
    };
    const updateRaycasterFromEvent = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const pickCellFromEvent = (event: PointerEvent): CellRecord | null => {
      if (!cellHitTargets.length) {
        return null;
      }
      updateRaycasterFromEvent(event);
      const [hit] = raycaster.intersectObjects(cellHitTargets, false);
      return (hit?.object.userData as CellHitTargetData | undefined)?.cell ?? null;
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (viewerPointerDragging) {
        clearHoveredCell();
        onHoverSample?.(null);
        return;
      }
      const hoveredCell = pickCellFromEvent(event);
      setHoveredCell(hoveredCell);
      if (!onHoverSample || !realHoverTargets.length) {
        return;
      }
      const [hit] = raycaster.intersectObjects(realHoverTargets, false);
      if (!hit || hit.index == null) {
        const boxHit = new THREE.Vector3();
        if (raycaster.ray.intersectBox(box, boxHit)) {
          onHoverSample(makeEmptyBoxHoverSample(boxHit, base, worldWidth, worldHeight, worldDepth));
        } else {
          onHoverSample(null);
        }
        return;
      }
      const data = hit.object.userData as PointCloudHoverData;
      onHoverSample({
        x: Math.round(data.sourceX[hit.index] ?? 0),
        y: Math.round(data.sourceY[hit.index] ?? 0),
        z: Math.round(data.sourceZ[hit.index] ?? 0),
        brightness: data.brightness[hit.index] ?? null,
      });
    };
    const handleDoubleClick = (event: MouseEvent) => {
      const cell = pickCellFromEvent(event as PointerEvent);
      if (!cell) {
        return;
      }
      event.preventDefault();
      onCellDoubleClick?.(cell.name);
    };
    const handlePointerDown = (event: PointerEvent) => {
      viewerPointerDragging = event.button === 0 || event.button === 1 || event.button === 2;
      clearHoveredCell();
    };
    const handlePointerUp = () => {
      viewerPointerDragging = false;
    };
    const handlePointerLeave = () => {
      clearHoveredCell();
      onHoverSample?.(null);
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    let animationId = 0;
    let reportedFirstRender = false;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      drawTrajectoryOverlay(trajectoryContext, trajectoryCanvas, trajectoryProjector, camera, mount.clientWidth, mount.clientHeight);
      if (!reportedFirstRender) {
        reportedFirstRender = true;
        onFirstRender?.();
      }
      animationId = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      saveCameraView();
      window.cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      controls.removeEventListener("change", saveCameraView);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
          return;
        }
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            material.forEach((m) => m.dispose());
          } else {
            material.dispose();
          }
        }
      });
      renderer.dispose();
      if (trajectoryCanvas.parentElement === mount) {
        mount.removeChild(trajectoryCanvas);
      }
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [
    real,
    synth,
    realPointCloud,
    synthPointCloud,
    cells,
    realEnabled,
    synthEnabled,
    cellsEnabled,
    cellCentersEnabled,
    cellOutlineColors,
    realMap,
    synthMap,
    realOpacity,
    synthOpacity,
    realContrastLimits,
    synthContrastLimits,
    pointAlphaByBrightness,
    pointSize,
    pointSizeByBrightness,
    maxPixelRatio,
    pointCloudConfig,
    focusCellIds,
    focusFrame,
    focusRequestId,
    labeledCellIds,
    cellTrajectories,
    frame,
    onFirstRender,
    onHoverSample,
    onCellDoubleClick,
    backgroundMode,
  ]);

  return (
    <div className="volume-stage" ref={mountRef} data-background={backgroundMode}>
      <div className="volume-background-switch segmented" aria-label="3D viewer background">
        <button
          type="button"
          className={backgroundMode === "bright" ? "active" : ""}
          aria-pressed={backgroundMode === "bright"}
          title="Bright background"
          onClick={() => onBackgroundModeChange("bright")}
        >
          <Sun size={14} />
          Bright
        </button>
        <button
          type="button"
          className={backgroundMode === "dark" ? "active" : ""}
          aria-pressed={backgroundMode === "dark"}
          title="Dark background"
          onClick={() => onBackgroundModeChange("dark")}
        >
          <Moon size={14} />
          Dark
        </button>
      </div>
      {!real && !synth && !realPointCloud && !synthPointCloud ? (
        <div className="viewer-empty">Waiting for viewer output</div>
      ) : null}
    </div>
  );
}

type PointCloudHoverData = {
  sourceX: Float32Array;
  sourceY: Float32Array;
  sourceZ: Float32Array;
  brightness: Float32Array;
};

type CellHitTargetData = {
  cell: CellRecord;
};

function makeEmptyBoxHoverSample(
  point: THREE.Vector3,
  base: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
): ViewerHoverSample {
  const x = Math.round(((point.x / worldWidth) + 0.5) * Math.max(0, base.sourceWidth - 1));
  const y = Math.round((0.5 - point.y / worldHeight) * Math.max(0, base.sourceHeight - 1));
  const z = Math.round(((point.z / worldDepth) + 0.5) * Math.max(0, base.depth - 1));
  return {
    x: clampInteger(x, 0, Math.max(0, base.sourceWidth - 1)),
    y: clampInteger(y, 0, Math.max(0, base.sourceHeight - 1)),
    z: clampInteger(z, 0, Math.max(0, base.depth - 1)),
    brightness: 0,
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

type VolumeDimensions = {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  depth: number;
};

function getVolumeDimensions(
  real?: VolumeData,
  synth?: VolumeData,
  realPointCloud?: PointCloudPreviewData,
  synthPointCloud?: PointCloudPreviewData,
): VolumeDimensions | undefined {
  const volume = real ?? synth;
  if (volume) {
    return volume;
  }
  const pointCloud = realPointCloud ?? synthPointCloud;
  if (!pointCloud) {
    return undefined;
  }
  return {
    width: pointCloud.sourceWidth,
    height: pointCloud.sourceHeight,
    sourceWidth: pointCloud.sourceWidth,
    sourceHeight: pointCloud.sourceHeight,
    depth: pointCloud.depth,
  };
}

function getRawScaleWorldDepth(volume: VolumeDimensions, worldWidth: number, worldHeight: number): number {
  if (volume.depth <= 1) {
    return 0.04;
  }
  const xScale = worldWidth / Math.max(1, volume.sourceWidth);
  const yScale = worldHeight / Math.max(1, volume.sourceHeight);
  const xyScale = (xScale + yScale) / 2;
  return Math.max(0.04, (volume.depth - 1) * xyScale);
}

function createCamera(
  aspect: number,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.01, 200);
  const radius = Math.sqrt(worldWidth * worldWidth + worldHeight * worldHeight + worldDepth * worldDepth) / 2;
  const distance = Math.max(1.65, radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 0.54);
  const viewDirection = new THREE.Vector3(0.02, -0.62, 0.78).normalize();
  camera.position.copy(viewDirection.multiplyScalar(distance));
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  return camera;
}

function captureCameraView(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
): CameraViewState {
  return {
    position: camera.position.toArray() as [number, number, number],
    target: controls.target.toArray() as [number, number, number],
    up: camera.up.toArray() as [number, number, number],
    zoom: camera.zoom,
    worldWidth,
    worldHeight,
    worldDepth,
  };
}

function restoreCameraView(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  state: CameraViewState | null,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
): void {
  if (!state || !isCompatibleCameraView(state, worldWidth, worldHeight, worldDepth)) {
    return;
  }
  camera.position.fromArray(state.position);
  camera.up.fromArray(state.up);
  camera.zoom = state.zoom;
  camera.updateProjectionMatrix();
  controls.target.fromArray(state.target);
}

function isCompatibleCameraView(
  state: CameraViewState,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
): boolean {
  return (
    relativeDifference(state.worldWidth, worldWidth) < 0.2 &&
    relativeDifference(state.worldHeight, worldHeight) < 0.2 &&
    relativeDifference(state.worldDepth, worldDepth) < 0.2
  );
}

function relativeDifference(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 0.001);
}

function addVolumePointCloud(
  group: THREE.Group,
  volume: VolumeData,
  colorMap: ColorMapId,
  opacity: number,
  contrastLimits: ContrastLimits,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
  pointSize: number,
  pointAlphaByBrightness: boolean,
  pointSizeByBrightness: boolean,
): THREE.Points | undefined {
  const cloud = getCachedPointCloud(volume, colorMap, contrastLimits, worldWidth, worldHeight, worldDepth, config);
  if (!cloud.pointCount) {
    return undefined;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
  geometry.setAttribute("pointColor", new THREE.BufferAttribute(cloud.colors, 3));
  geometry.setAttribute("pointAlpha", new THREE.BufferAttribute(cloud.alpha, 1));
  const material = createPointCloudMaterial(pointSize, opacity, pointAlphaByBrightness, pointSizeByBrightness);
  const points = new THREE.Points(geometry, material);
  points.userData = getPointCloudHoverData(cloud);
  group.add(points);
  return points;
}

function addPreviewPointCloud(
  group: THREE.Group,
  preview: PointCloudPreviewData,
  colorMap: ColorMapId,
  opacity: number,
  contrastLimits: ContrastLimits,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
  interleaveRole: InterleaveRole,
  pointSize: number,
  pointAlphaByBrightness: boolean,
  pointSizeByBrightness: boolean,
): THREE.Points | undefined {
  const cloud = getCachedPreviewPointCloud(preview, colorMap, contrastLimits, worldWidth, worldHeight, worldDepth, config, interleaveRole);
  if (!cloud.pointCount) {
    return undefined;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
  geometry.setAttribute("pointColor", new THREE.BufferAttribute(cloud.colors, 3));
  geometry.setAttribute("pointAlpha", new THREE.BufferAttribute(cloud.alpha, 1));
  const material = createPointCloudMaterial(pointSize, opacity, pointAlphaByBrightness, pointSizeByBrightness);
  const points = new THREE.Points(geometry, material);
  points.userData = getPointCloudHoverData(cloud);
  group.add(points);
  return points;
}

function getPointCloudHoverData(cloud: PointCloudData): PointCloudHoverData {
  return {
    sourceX: cloud.sourceX,
    sourceY: cloud.sourceY,
    sourceZ: cloud.sourceZ,
    brightness: cloud.brightness,
  };
}

function getCachedPointCloud(
  volume: VolumeData,
  colorMap: ColorMapId,
  contrastLimits: ContrastLimits,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
): PointCloudData {
  const key = [
    colorMap,
    contrastLimits[0].toFixed(3),
    contrastLimits[1].toFixed(3),
    config.maxPoints,
    config.intensityPercentile,
    worldWidth.toFixed(4),
    worldHeight.toFixed(4),
    worldDepth.toFixed(4),
  ].join("|");
  let perVolume = pointCloudCache.get(volume);
  if (!perVolume) {
    perVolume = new Map();
    pointCloudCache.set(volume, perVolume);
  }
  const cached = perVolume.get(key);
  if (cached) {
    return cached;
  }
  const cloud = buildPointCloud(volume, colorMap, contrastLimits, worldWidth, worldHeight, worldDepth, config);
  perVolume.set(key, cloud);
  return cloud;
}

function getCachedPreviewPointCloud(
  preview: PointCloudPreviewData,
  colorMap: ColorMapId,
  contrastLimits: ContrastLimits,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
  interleaveRole: InterleaveRole,
): PointCloudData {
  const key = [
    colorMap,
    contrastLimits[0].toFixed(3),
    contrastLimits[1].toFixed(3),
    config.pointSize,
    config.overlayStaggerFraction,
    interleaveRole,
    worldWidth.toFixed(4),
    worldHeight.toFixed(4),
    worldDepth.toFixed(4),
  ].join("|");
  let perPreview = previewPointCloudCache.get(preview);
  if (!perPreview) {
    perPreview = new Map();
    previewPointCloudCache.set(preview, perPreview);
  }
  const cached = perPreview.get(key);
  if (cached) {
    return cached;
  }
  const cloud = buildPreviewPointCloud(preview, colorMap, contrastLimits, worldWidth, worldHeight, worldDepth, config, interleaveRole);
  perPreview.set(key, cloud);
  return cloud;
}

function createPointCloudMaterial(
  pointSize: number,
  opacity: number,
  pointAlphaByBrightness: boolean,
  pointSizeByBrightness: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      pointSize: { value: pointSize },
      opacity: { value: opacity },
      alphaByBrightness: { value: pointAlphaByBrightness ? 1.0 : 0.0 },
      sizeByBrightness: { value: pointSizeByBrightness ? 1.0 : 0.0 },
    },
    vertexShader: `
      uniform float pointSize;
      uniform float alphaByBrightness;
      uniform float sizeByBrightness;
      attribute vec3 pointColor;
      attribute float pointAlpha;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = pointColor;
        vAlpha = mix(1.0, pointAlpha, alphaByBrightness);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float brightnessPointSize = max(0.25, pointSize * pointAlpha);
        gl_PointSize = mix(pointSize, brightnessPointSize, sizeByBrightness);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      precision mediump float;
      uniform float opacity;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float radius = length(centered);
        if (radius > 0.5) {
          discard;
        }
        float edge = smoothstep(0.5, 0.2, radius);
        gl_FragColor = vec4(vColor, opacity * vAlpha * edge);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

function buildPointCloud(
  volume: VolumeData,
  colorMap: ColorMapId,
  contrastLimits: ContrastLimits,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
): PointCloudData {
  const maxPoints = Math.max(1, Math.round(config.maxPoints));
  const voxelCount = Math.max(1, volume.width * volume.height * volume.slices.length);
  const xyStep = Math.max(1, Math.ceil(Math.sqrt(voxelCount / (maxPoints * 7))));
  const threshold = computeIntensityThreshold(volume, config.intensityPercentile, Math.max(1, xyStep * 2));
  const positions = new Float32Array(maxPoints * 3);
  const colors = new Float32Array(maxPoints * 3);
  const sourceX = new Float32Array(maxPoints);
  const sourceY = new Float32Array(maxPoints);
  const sourceZ = new Float32Array(maxPoints);
  const brightnessValues = new Float32Array(maxPoints);
  const alphaValues = new Float32Array(maxPoints);
  const map = getColorMap(colorMap);
  const widthDenominator = Math.max(1, volume.width - 1);
  const heightDenominator = Math.max(1, volume.height - 1);
  const maxIndex = Math.max(1, volume.depth - 1);

  let pointIndex = 0;
  sliceLoop:
  for (let sliceIndex = 0; sliceIndex < volume.slices.length; sliceIndex += 1) {
    const slice = volume.slices[sliceIndex];
    const z = volume.sliceIndices[sliceIndex] ?? 0;
    const worldZ = volume.depth <= 1 ? 0 : (z / maxIndex - 0.5) * worldDepth;
    for (let y = 0; y < volume.height; y += xyStep) {
      for (let x = 0; x < volume.width; x += xyStep) {
        const value = slice[y * volume.width + x];
        if (value < threshold) {
          continue;
        }
        if (pointIndex >= maxPoints) {
          break sliceLoop;
        }
        const intensity = applyContrastLimits(Math.max(0, Math.min(1, value / Math.max(1, volume.displayMax))), contrastLimits);
        if (intensity <= 0.001) {
          continue;
        }
        const [r, g, b] = map.sample(intensity);
        const target = pointIndex * 3;
        positions[target] = (x / widthDenominator - 0.5) * worldWidth;
        positions[target + 1] = (0.5 - y / heightDenominator) * worldHeight;
        positions[target + 2] = worldZ;
        sourceX[pointIndex] = (x / widthDenominator) * Math.max(0, volume.sourceWidth - 1);
        sourceY[pointIndex] = (y / heightDenominator) * Math.max(0, volume.sourceHeight - 1);
        sourceZ[pointIndex] = z;
        brightnessValues[pointIndex] = value;
        alphaValues[pointIndex] = intensity;
        const brightness = Math.max(0.58, Math.sqrt(intensity));
        colors[target] = (r / 255) * brightness;
        colors[target + 1] = (g / 255) * brightness;
        colors[target + 2] = (b / 255) * brightness;
        pointIndex += 1;
      }
    }
  }

  return {
    positions: positions.slice(0, pointIndex * 3),
    colors: colors.slice(0, pointIndex * 3),
    sourceX: sourceX.slice(0, pointIndex),
    sourceY: sourceY.slice(0, pointIndex),
    sourceZ: sourceZ.slice(0, pointIndex),
    brightness: brightnessValues.slice(0, pointIndex),
    alpha: alphaValues.slice(0, pointIndex),
    pointCount: pointIndex,
  };
}

function buildPreviewPointCloud(
  preview: PointCloudPreviewData,
  colorMap: ColorMapId,
  contrastLimits: ContrastLimits,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
  interleaveRole: InterleaveRole,
): PointCloudData {
  const positions = new Float32Array(preview.pointCount * 3);
  const colors = new Float32Array(preview.pointCount * 3);
  const sourceX = new Float32Array(preview.pointCount);
  const sourceY = new Float32Array(preview.pointCount);
  const sourceZ = new Float32Array(preview.pointCount);
  const brightnessValues = new Float32Array(preview.pointCount);
  const alphaValues = new Float32Array(preview.pointCount);
  const map = getColorMap(colorMap);
  const widthDenominator = Math.max(1, preview.sourceWidth - 1);
  const heightDenominator = Math.max(1, preview.sourceHeight - 1);
  const depthDenominator = Math.max(1, preview.depth - 1);
  const checkerStep = Math.max(1, preview.xyStep || 1);
  const intensityScale = computePointCloudIntensityScale(preview.intensity);

  let outputPointIndex = 0;
  for (let pointIndex = 0; pointIndex < preview.pointCount; pointIndex += 1) {
    const displayIntensity = normalizePreviewPointIntensity(preview.intensity[pointIndex] ?? 0, intensityScale);
    const intensity = applyContrastLimits(displayIntensity, contrastLimits);
    if (intensity <= 0.001) {
      continue;
    }
    const target = outputPointIndex * 3;
    const [r, g, b] = map.sample(intensity);
    const stagger = getInterleavedPointOffset(
      preview,
      pointIndex,
      checkerStep,
      interleaveRole,
      config.overlayStaggerFraction,
    );
    const x = Math.max(0, Math.min(widthDenominator, (preview.x[pointIndex] ?? 0) + stagger.x));
    const y = Math.max(0, Math.min(heightDenominator, (preview.y[pointIndex] ?? 0) + stagger.y));
    positions[target] = (x / widthDenominator - 0.5) * worldWidth;
    positions[target + 1] = (0.5 - y / heightDenominator) * worldHeight;
    positions[target + 2] = preview.depth <= 1 ? 0 : (preview.z[pointIndex] / depthDenominator - 0.5) * worldDepth;
    sourceX[outputPointIndex] = preview.x[pointIndex] ?? 0;
    sourceY[outputPointIndex] = preview.y[pointIndex] ?? 0;
    sourceZ[outputPointIndex] = preview.z[pointIndex] ?? 0;
    brightnessValues[outputPointIndex] = Math.max(0, Math.min(255, displayIntensity * 255));
    alphaValues[outputPointIndex] = intensity;
    const brightness = Math.max(0.58, Math.sqrt(intensity));
    colors[target] = (r / 255) * brightness;
    colors[target + 1] = (g / 255) * brightness;
    colors[target + 2] = (b / 255) * brightness;
    outputPointIndex += 1;
  }

  return {
    positions: positions.slice(0, outputPointIndex * 3),
    colors: colors.slice(0, outputPointIndex * 3),
    sourceX: sourceX.slice(0, outputPointIndex),
    sourceY: sourceY.slice(0, outputPointIndex),
    sourceZ: sourceZ.slice(0, outputPointIndex),
    brightness: brightnessValues.slice(0, outputPointIndex),
    alpha: alphaValues.slice(0, outputPointIndex),
    pointCount: outputPointIndex,
  };
}

function computePointCloudIntensityScale(values: Float32Array): { low: number; high: number } {
  const finiteValues: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (Number.isFinite(value) && value > 0) {
      finiteValues.push(value);
    }
  }
  if (!finiteValues.length) {
    return { low: 0, high: 1 };
  }
  finiteValues.sort((a, b) => a - b);
  const low = percentileFromSorted(finiteValues, 2);
  const high = Math.max(low + 1e-6, percentileFromSorted(finiteValues, 99.5));
  return { low, high };
}

function normalizePreviewPointIntensity(value: number, scale: { low: number; high: number }): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, (value - scale.low) / (scale.high - scale.low)));
}

function percentileFromSorted(values: number[], percentile: number): number {
  if (values.length === 1) {
    return values[0];
  }
  const clamped = Math.max(0, Math.min(100, percentile));
  const position = (clamped / 100) * (values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return values[lower];
  }
  const weight = position - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
}

function getInterleavedPointOffset(
  preview: PointCloudPreviewData,
  pointIndex: number,
  checkerStep: number,
  interleaveRole: InterleaveRole,
  overlayStaggerFraction: number,
): { x: number; y: number } {
  if (interleaveRole === "none") {
    return { x: 0, y: 0 };
  }
  const xCell = Math.floor((preview.x[pointIndex] ?? 0) / checkerStep);
  const yCell = Math.floor((preview.y[pointIndex] ?? 0) / checkerStep);
  const zCell = Math.floor(preview.z[pointIndex] ?? 0);
  const xyPhase = (xCell + yCell + zCell) & 1;
  const zPhase = zCell & 1;
  const layerSign = interleaveRole === "synth" ? 1 : -1;
  const diagonalSign = xyPhase === 0 ? 1 : -1;
  const zLayerSign = zPhase === 0 ? 1 : -1;
  const offset = checkerStep * overlayStaggerFraction;

  return {
    x: layerSign * diagonalSign * offset,
    y: -layerSign * diagonalSign * zLayerSign * offset,
  };
}

function computeIntensityThreshold(volume: VolumeData, percentile: number, sampleStep: number): number {
  const histogram = new Uint32Array(256);
  let nonZero = 0;
  for (const slice of volume.slices) {
    for (let y = 0; y < volume.height; y += sampleStep) {
      for (let x = 0; x < volume.width; x += sampleStep) {
        const value = slice[y * volume.width + x];
        if (value <= 0) {
          continue;
        }
        histogram[value] += 1;
        nonZero += 1;
      }
    }
  }
  if (nonZero === 0) {
    return 1;
  }

  const target = Math.max(1, Math.floor(nonZero * Math.max(0, Math.min(100, percentile)) / 100));
  let seen = 0;
  for (let value = 1; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen >= target) {
      return value;
    }
  }
  return 1;
}

function addCellCenters(
  group: THREE.Group,
  cells: CellRecord[],
  volume: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  darkBackground: boolean,
) {
  const maxCellZ = cells.reduce((max, cell) => Math.max(max, Number(cell.z) || 0), 0);
  const zScale = Math.max(volume.depth - 1, maxCellZ, 1);
  const markerRadius = Math.max(worldWidth, worldHeight, worldDepth) * 0.0065;
  const labelHeight = Math.max(worldWidth, worldHeight, worldDepth) * 0.014;
  const labelOffset = markerRadius * 2.8;
  for (const cell of cells) {
    const isTrash = Boolean(cell.isTrash);
    const markerGeometry = new THREE.SphereGeometry(markerRadius, 14, 10);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: isTrash ? uiPalette.cellTrash : uiPalette.cellSelected,
      transparent: true,
      opacity: isTrash ? 0.76 : 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    const center = cellToWorldPosition(cell, volume, worldWidth, worldHeight, worldDepth, zScale);
    marker.position.copy(center);
    marker.renderOrder = 36;
    group.add(marker);

    const label = createCellLabelSprite(cell.name, isTrash, darkBackground, labelHeight);
    label.position.set(center.x + labelOffset, center.y + labelOffset * 0.36, center.z);
    label.renderOrder = 38;
    group.add(label);
  }
}

function createCellLabelSprite(name: string, isTrash: boolean, darkBackground: boolean, worldHeight: number): THREE.Sprite {
  const fontSize = 13;
  const paddingX = 5;
  const paddingY = 3;
  const canvas = document.createElement("canvas");
  const measureContext = canvas.getContext("2d");
  const text = name || "cell";
  const font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  if (measureContext) {
    measureContext.font = font;
  }
  const measuredWidth = Math.ceil((measureContext?.measureText(text).width ?? text.length * fontSize * 0.58) + paddingX * 2);
  const measuredHeight = Math.ceil(fontSize + paddingY * 2);
  const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.ceil(measuredWidth * scale);
  canvas.height = Math.ceil(measuredHeight * scale);

  const context = canvas.getContext("2d");
  if (context) {
    context.scale(scale, scale);
    context.font = font;
    context.textBaseline = "middle";
    context.lineJoin = "round";
    const fill = darkBackground ? "rgba(9, 13, 19, 0.58)" : "rgba(255, 254, 250, 0.68)";
    const stroke = isTrash ? uiPalette.cellTrash : uiPalette.cellSelected;
    const textColor = darkBackground ? uiPalette.volumeBoxDark : uiPalette.viewerBackgroundDark;
    drawRoundedRect(context, 0.5, 0.5, measuredWidth - 1, measuredHeight - 1, 4);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = 0.8;
    context.stroke();
    context.fillStyle = textColor;
    context.fillText(text, paddingX, measuredHeight / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldHeight * (measuredWidth / measuredHeight), worldHeight, 1);
  return sprite;
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

type TrajectoryProjectedPath = {
  color: string;
  highlighted: boolean;
  points: THREE.Vector3[];
};

function createTrajectoryProjector(
  trajectories: CellTrajectory[],
  frameCells: CellRecord[],
  volume: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
): TrajectoryProjectedPath[] {
  const allCells = trajectories.flatMap((trajectory) => trajectory.points.map((point) => point.cell));
  const zScaleCells = frameCells.length ? frameCells.concat(allCells) : allCells;
  const maxCellZ = zScaleCells.reduce((max, cell) => Math.max(max, Number(cell.z) || 0), 0);
  const zScale = Math.max(volume.depth - 1, maxCellZ, 1);

  return trajectories
    .map((trajectory) => {
      const points = [...trajectory.points]
        .sort((a, b) => a.frame - b.frame)
        .map((point) => cellToWorldPosition(point.cell, volume, worldWidth, worldHeight, worldDepth, zScale));
      return { color: trajectory.color, highlighted: Boolean(trajectory.highlighted), points };
    })
    .filter((trajectory) => trajectory.points.length >= 2);
}

function drawTrajectoryOverlay(
  context: CanvasRenderingContext2D | null,
  canvas: HTMLCanvasElement,
  trajectories: TrajectoryProjectedPath[] | null,
  camera: THREE.Camera,
  width: number,
  height: number,
) {
  if (!context) {
    return;
  }
  context.clearRect(0, 0, width, height);
  if (!trajectories?.length) {
    return;
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const trajectory of trajectories) {
    const projected = trajectory.points
      .map((point) => point.clone().project(camera))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.z > -1 && point.z < 1)
      .map((point) => ({
        x: (point.x * 0.5 + 0.5) * width,
        y: (-point.y * 0.5 + 0.5) * height,
      }));
    if (projected.length < 2) {
      continue;
    }
    context.save();
    context.globalAlpha = trajectory.highlighted ? 0.34 : 0.22;
    context.strokeStyle = uiPalette.viewerBackgroundDark;
    context.lineWidth = trajectory.highlighted ? 8 : 5;
    strokeProjectedPath(context, projected);
    context.globalAlpha = trajectory.highlighted ? 1 : 0.86;
    context.strokeStyle = trajectory.color;
    context.lineWidth = trajectory.highlighted ? 4 : 2.4;
    strokeProjectedPath(context, projected);
    context.restore();
  }
  void canvas.offsetWidth;
}

function strokeProjectedPath(context: CanvasRenderingContext2D, points: { x: number; y: number }[]) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.stroke();
}

function addCells(
  group: THREE.Group,
  cells: CellRecord[],
  volume: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  cellOutlineColors?: Record<string, string>,
) {
  const lineageColorMode = cellOutlineColors !== undefined;
  const trashColor = lineageColorMode ? uiPalette.cellTrashLineage : uiPalette.cellTrash;
  for (const cell of cells) {
    const mesh = createCellOutlineMesh(cell, cells, volume, worldWidth, worldHeight, worldDepth, {
      color: cellOutlineColors?.[cell.name] ?? (cell.isTrash ? trashColor : uiPalette.cellNormal),
      opacity: cell.isTrash ? 0.34 : 0.42,
      scaleFactor: 1,
      widthSegments: 18,
      heightSegments: 12,
      depthTest: true,
      depthWrite: true,
    });
    group.add(mesh);
  }
}

function addCellHitTargets(
  group: THREE.Group,
  cells: CellRecord[],
  volume: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
): THREE.Mesh[] {
  return cells.map((cell) => {
    const mesh = createCellOutlineMesh(cell, cells, volume, worldWidth, worldHeight, worldDepth, {
      color: uiPalette.cellHoverHighlight,
      opacity: 0,
      scaleFactor: 1.12,
      widthSegments: 12,
      heightSegments: 8,
      depthTest: false,
      depthWrite: false,
      colorWrite: false,
    });
    mesh.userData = { cell } satisfies CellHitTargetData;
    mesh.renderOrder = -1;
    group.add(mesh);
    return mesh;
  });
}

function addSelectedCellOutlines(
  group: THREE.Group,
  cells: CellRecord[],
  frameCells: CellRecord[],
  volume: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
) {
  for (const cell of cells) {
    const mesh = createCellOutlineMesh(cell, frameCells, volume, worldWidth, worldHeight, worldDepth, {
      color: uiPalette.cellSelected,
      opacity: 0.96,
      scaleFactor: 1.08,
      widthSegments: 28,
      heightSegments: 18,
      depthTest: false,
      depthWrite: false,
      renderOrder: 30,
    });
    group.add(mesh);
  }
}

type CellOutlineOptions = {
  color: string;
  opacity: number;
  scaleFactor: number;
  widthSegments: number;
  heightSegments: number;
  depthTest: boolean;
  depthWrite: boolean;
  colorWrite?: boolean;
  renderOrder?: number;
};

function createCellOutlineMesh(
  cell: CellRecord,
  frameCells: CellRecord[],
  volume: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  options: CellOutlineOptions,
): THREE.Mesh {
  const maxCellZ = frameCells.reduce((max, frameCell) => Math.max(max, Number(frameCell.z) || 0), 0);
  const zScale = Math.max(volume.depth - 1, maxCellZ, 1);
  const geometry = new THREE.SphereGeometry(1, options.widthSegments, options.heightSegments);
  const material = new THREE.MeshBasicMaterial({
    color: options.color,
    wireframe: true,
    transparent: true,
    opacity: options.opacity,
    depthTest: options.depthTest,
    depthWrite: options.depthWrite,
    colorWrite: options.colorWrite ?? true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(cellToWorldPosition(cell, volume, worldWidth, worldHeight, worldDepth, zScale));
  mesh.scale.set(
    Math.max(0.012, ((Number(cell.aRadius) || 1) / Math.max(1, volume.sourceWidth)) * worldWidth * options.scaleFactor),
    Math.max(0.012, ((Number(cell.bRadius) || 1) / Math.max(1, volume.sourceHeight)) * worldHeight * options.scaleFactor),
    Math.max(0.012, ((Number(cell.cRadius) || 1) / zScale) * worldDepth * options.scaleFactor),
  );
  mesh.quaternion.copy(getCellWorldRotation(cell));
  if (options.renderOrder !== undefined) {
    mesh.renderOrder = options.renderOrder;
  }
  return mesh;
}

function disposeMeshResources(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
  } else {
    material.dispose();
  }
}

function focusCameraOnCells(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  cells: CellRecord[],
  frameCells: CellRecord[],
  volume: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
) {
  const maxCellZ = frameCells.reduce((max, cell) => Math.max(max, Number(cell.z) || 0), 0);
  const zScale = Math.max(volume.depth - 1, maxCellZ, 1);
  const center = new THREE.Vector3();
  const positions = cells.map((cell) => cellToWorldPosition(cell, volume, worldWidth, worldHeight, worldDepth, zScale));
  positions.forEach((position) => center.add(position));
  center.divideScalar(Math.max(1, positions.length));

  let radius = 0.08;
  for (let index = 0; index < positions.length; index += 1) {
    const cell = cells[index];
    const cellRadius = Math.max(
      ((Number(cell.aRadius) || 1) / Math.max(1, volume.sourceWidth)) * worldWidth,
      ((Number(cell.bRadius) || 1) / Math.max(1, volume.sourceHeight)) * worldHeight,
      ((Number(cell.cRadius) || 1) / zScale) * worldDepth,
    );
    radius = Math.max(radius, positions[index].distanceTo(center) + cellRadius * 2.2);
  }

  const distance = Math.max(0.32, radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.15);
  const direction = new THREE.Vector3(0.26, -0.48, 0.84).normalize();
  controls.target.copy(center);
  camera.position.copy(center.clone().add(direction.multiplyScalar(distance)));
  camera.near = Math.max(0.005, distance / 80);
  camera.far = Math.max(20, distance * 120);
  camera.updateProjectionMatrix();
}

function cellToWorldPosition(
  cell: CellRecord,
  volume: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  zScale: number,
): THREE.Vector3 {
  return new THREE.Vector3(
    ((Number(cell.x) || 0) / Math.max(1, volume.sourceWidth) - 0.5) * worldWidth,
    (0.5 - (Number(cell.y) || 0) / Math.max(1, volume.sourceHeight)) * worldHeight,
    ((Number(cell.z) || 0) / zScale - 0.5) * worldDepth,
  );
}

function getCellWorldRotation(cell: CellRecord): THREE.Quaternion {
  const thetaX = getCellAngle(cell.thetaX, cell.theta_x);
  const thetaY = getCellAngle(cell.thetaY, cell.theta_y);
  const thetaZ = getCellAngle(cell.thetaZ, cell.theta_z);
  const cx = Math.cos(thetaX);
  const sx = Math.sin(thetaX);
  const cy = Math.cos(thetaY);
  const sy = Math.sin(thetaY);
  const cz = Math.cos(thetaZ);
  const sz = Math.sin(thetaZ);

  // CellUniverse exports R = Rz * Ry * Rx in image coordinates. The viewer
  // maps image Y-down to world Y-up, so convert with S * R * S where S flips Y.
  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;

  const matrix = new THREE.Matrix4().set(
    r00, -r01, r02, 0,
    -r10, r11, -r12, 0,
    r20, -r21, r22, 0,
    0, 0, 0, 1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function getCellAngle(camelCaseValue: number | undefined, snakeCaseValue: number | undefined): number {
  const value = Number(camelCaseValue ?? snakeCaseValue ?? 0);
  return Number.isFinite(value) ? value : 0;
}
