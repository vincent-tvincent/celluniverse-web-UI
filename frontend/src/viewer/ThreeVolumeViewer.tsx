import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { defaultViewerConfig, type ViewerRuntimeConfig } from "../config";
import type { CellRecord } from "../types";
import { getColorMap, type ColorMapId } from "./colorMaps";
import type { PointCloudPreviewData } from "./pointCloud";
import type { VolumeData } from "./tiff";

type Props = {
  real?: VolumeData;
  synth?: VolumeData;
  realPointCloud?: PointCloudPreviewData;
  synthPointCloud?: PointCloudPreviewData;
  cells: CellRecord[];
  realEnabled: boolean;
  synthEnabled: boolean;
  cellsEnabled: boolean;
  realMap: ColorMapId;
  synthMap: ColorMapId;
  synthOpacity: number;
  maxPixelRatio: number;
  pointCloudConfig?: ViewerRuntimeConfig["pointCloud"];
  onFirstRender?: () => void;
};

type PointCloudData = {
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
};

type InterleaveRole = "real" | "synth" | "none";

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
  realMap,
  synthMap,
  synthOpacity,
  maxPixelRatio,
  pointCloudConfig,
  onFirstRender,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraViewRef = useRef<CameraViewState | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const base = getVolumeDimensions(real, synth, realPointCloud, synthPointCloud);
    if (!mount || !base) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#070a0f");

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    const cloudConfig = pointCloudConfig ?? defaultViewerConfig.pointCloud;
    const worldWidth = 2.4;
    const worldHeight = worldWidth * (base.height / base.width);
    const worldDepth = getRawScaleWorldDepth(base, worldWidth, worldHeight) * cloudConfig.zCompression;
    const aspect = Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight);
    const camera = createCamera(aspect, worldWidth, worldHeight, worldDepth);

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

    const interleavePreviewLayers = Boolean(realEnabled && synthEnabled && realPointCloud && synthPointCloud);
    if (realEnabled && realPointCloud) {
      addPreviewPointCloud(
        group,
        realPointCloud,
        realMap,
        cloudConfig.realOpacity,
        worldWidth,
        worldHeight,
        worldDepth,
        cloudConfig,
        interleavePreviewLayers ? "real" : "none",
      );
    } else if (realEnabled && real) {
      addVolumePointCloud(group, real, realMap, cloudConfig.realOpacity, worldWidth, worldHeight, worldDepth, cloudConfig);
    }
    if (synthEnabled && synthPointCloud) {
      addPreviewPointCloud(
        group,
        synthPointCloud,
        synthMap,
        Math.min(synthOpacity * cloudConfig.synthOpacityScale, 0.45),
        worldWidth,
        worldHeight,
        worldDepth,
        cloudConfig,
        interleavePreviewLayers ? "synth" : "none",
      );
    } else if (synthEnabled && synth) {
      addVolumePointCloud(
        group,
        synth,
        synthMap,
        Math.min(synthOpacity * cloudConfig.synthOpacityScale, 0.45),
        worldWidth,
        worldHeight,
        worldDepth,
        cloudConfig,
      );
    }
    if (cellsEnabled && cells.length) {
      addCells(group, cells, base, worldWidth, worldHeight, worldDepth);
    }

    const box = new THREE.Box3(
      new THREE.Vector3(-worldWidth / 2, -worldHeight / 2, -worldDepth / 2),
      new THREE.Vector3(worldWidth / 2, worldHeight / 2, worldDepth / 2),
    );
    const helper = new THREE.Box3Helper(box, new THREE.Color("#506070"));
    group.add(helper);

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(mount);

    let animationId = 0;
    let reportedFirstRender = false;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
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
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
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
    realMap,
    synthMap,
    synthOpacity,
    maxPixelRatio,
    pointCloudConfig,
    onFirstRender,
  ]);

  return (
    <div className="volume-stage" ref={mountRef}>
      {!real && !synth && !realPointCloud && !synthPointCloud ? (
        <div className="viewer-empty">Waiting for TIFF output</div>
      ) : null}
    </div>
  );
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
  const camera = new THREE.PerspectiveCamera(38, aspect, 0.01, 200);
  const radius = Math.sqrt(worldWidth * worldWidth + worldHeight * worldHeight + worldDepth * worldDepth) / 2;
  const distance = Math.max(3.2, radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.08);
  const viewDirection = new THREE.Vector3(0, -0.48, 0.88).normalize();
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
) {
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
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
) {
  const cloud = getCachedPointCloud(volume, colorMap, worldWidth, worldHeight, worldDepth, config);
  if (!cloud.pointCount) {
    return;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
  geometry.setAttribute("pointColor", new THREE.BufferAttribute(cloud.colors, 3));
  const material = createPointCloudMaterial(config.pointSize, opacity);
  const points = new THREE.Points(geometry, material);
  group.add(points);
}

function addPreviewPointCloud(
  group: THREE.Group,
  preview: PointCloudPreviewData,
  colorMap: ColorMapId,
  opacity: number,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
  interleaveRole: InterleaveRole,
) {
  const cloud = getCachedPreviewPointCloud(preview, colorMap, worldWidth, worldHeight, worldDepth, config, interleaveRole);
  if (!cloud.pointCount) {
    return;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
  geometry.setAttribute("pointColor", new THREE.BufferAttribute(cloud.colors, 3));
  const material = createPointCloudMaterial(config.pointSize, opacity);
  const points = new THREE.Points(geometry, material);
  group.add(points);
}

function getCachedPointCloud(
  volume: VolumeData,
  colorMap: ColorMapId,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
): PointCloudData {
  const key = [
    colorMap,
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
  const cloud = buildPointCloud(volume, colorMap, worldWidth, worldHeight, worldDepth, config);
  perVolume.set(key, cloud);
  return cloud;
}

function getCachedPreviewPointCloud(
  preview: PointCloudPreviewData,
  colorMap: ColorMapId,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
  interleaveRole: InterleaveRole,
): PointCloudData {
  const key = [
    colorMap,
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
  const cloud = buildPreviewPointCloud(preview, colorMap, worldWidth, worldHeight, worldDepth, config, interleaveRole);
  perPreview.set(key, cloud);
  return cloud;
}

function createPointCloudMaterial(pointSize: number, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      pointSize: { value: pointSize },
      opacity: { value: opacity },
    },
    vertexShader: `
      uniform float pointSize;
      attribute vec3 pointColor;
      varying vec3 vColor;

      void main() {
        vColor = pointColor;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = pointSize;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      precision mediump float;
      uniform float opacity;
      varying vec3 vColor;

      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float radius = length(centered);
        if (radius > 0.5) {
          discard;
        }
        float edge = smoothstep(0.5, 0.2, radius);
        gl_FragColor = vec4(vColor, opacity * edge);
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
        const intensity = Math.max(0, Math.min(1, value / Math.max(1, volume.displayMax)));
        const [r, g, b] = map.sample(intensity);
        const target = pointIndex * 3;
        positions[target] = (x / widthDenominator - 0.5) * worldWidth;
        positions[target + 1] = (0.5 - y / heightDenominator) * worldHeight;
        positions[target + 2] = worldZ;
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
    pointCount: pointIndex,
  };
}

function buildPreviewPointCloud(
  preview: PointCloudPreviewData,
  colorMap: ColorMapId,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
  config: ViewerRuntimeConfig["pointCloud"],
  interleaveRole: InterleaveRole,
): PointCloudData {
  const positions = new Float32Array(preview.pointCount * 3);
  const colors = new Float32Array(preview.pointCount * 3);
  const map = getColorMap(colorMap);
  const widthDenominator = Math.max(1, preview.sourceWidth - 1);
  const heightDenominator = Math.max(1, preview.sourceHeight - 1);
  const depthDenominator = Math.max(1, preview.depth - 1);
  const checkerStep = Math.max(1, preview.xyStep || 1);

  for (let pointIndex = 0; pointIndex < preview.pointCount; pointIndex += 1) {
    const target = pointIndex * 3;
    const intensity = Math.max(0, Math.min(1, preview.intensity[pointIndex] ?? 0));
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
    const brightness = Math.max(0.58, Math.sqrt(intensity));
    colors[target] = (r / 255) * brightness;
    colors[target + 1] = (g / 255) * brightness;
    colors[target + 2] = (b / 255) * brightness;
  }

  return { positions, colors, pointCount: preview.pointCount };
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

function addCells(
  group: THREE.Group,
  cells: CellRecord[],
  volume: VolumeDimensions,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
) {
  const maxCellZ = cells.reduce((max, cell) => Math.max(max, Number(cell.z) || 0), 0);
  const zScale = Math.max(volume.depth - 1, maxCellZ, 1);
  const cellSpaceWidth = Math.max(1, volume.sourceWidth);
  const cellSpaceHeight = Math.max(1, volume.sourceHeight);
  for (const cell of cells) {
    const geometry = new THREE.SphereGeometry(1, 18, 12);
    const material = new THREE.MeshBasicMaterial({
      color: cell.isTrash ? "#ff765e" : "#f6e582",
      wireframe: true,
      transparent: true,
      opacity: cell.isTrash ? 0.34 : 0.42,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = ((Number(cell.x) || 0) / cellSpaceWidth - 0.5) * worldWidth;
    mesh.position.y = (0.5 - (Number(cell.y) || 0) / cellSpaceHeight) * worldHeight;
    mesh.position.z = ((Number(cell.z) || 0) / zScale - 0.5) * worldDepth;
    mesh.scale.set(
      Math.max(0.01, ((Number(cell.aRadius) || 1) / cellSpaceWidth) * worldWidth),
      Math.max(0.01, ((Number(cell.bRadius) || 1) / cellSpaceHeight) * worldHeight),
      Math.max(0.01, ((Number(cell.cRadius) || 1) / zScale) * worldDepth),
    );
    group.add(mesh);
  }
}
