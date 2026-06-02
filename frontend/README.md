# CellUniverse Frontend

Vite React frontend for the CellUniverse live job viewer.

## Local Development

Start the backend first:

```bash
cd ../backend
./scripts/run-dev.sh
```

Then start the frontend:

```bash
cd ../frontend
npm install
npm run dev
```

Default frontend URL:

```text
http://127.0.0.1:5173
```

The Vite dev server proxies `/api` to the backend at:

```text
http://127.0.0.1:8765
```

## Viewer

The first page is a live job viewer:

```text
Job selector / direct job id entry
Live job status and frame progress
2D slice preview
3D volume preview
Real TIFF layer
Synthetic TIFF layer with 50% default opacity
Cell ellipsoid overlay from cells JSON
Colormap controls for real and synthetic layers
stdout/stderr log panel
```

The frontend uses the backend manifest instead of reading job folders directly:

```text
GET /api/jobs/{job_id}/manifest
GET /api/jobs/{job_id}/frames/{frame}/cells
GET /api/jobs/{job_id}/logs?stream=stdout|stderr
GET /api/jobs/{job_id}/events
```

TIFF files are loaded from manifest URLs such as:

```text
/api/jobs/{job_id}/files/output/tiff/real/{frame}.tif
/api/jobs/{job_id}/files/output/tiff/synth/{frame}.tif
```

## Runtime Viewer Config

Frontend preview limits are read at runtime from:

```text
frontend/public/viewer-config.json
```

The current default keeps original TIFF exports untouched, but downscales the
browser preview before the data is transferred back from the TIFF worker:

```json
{
  "preview": {
    "maxXY": 384,
    "maxSlices": 48,
    "preloadConcurrency": 1
  },
  "rendering": {
    "maxPixelRatio": 1
  },
  "pointCloud": {
    "maxPoints": 120000,
    "intensityPercentile": 35,
    "pointSize": 3.6,
    "realOpacity": 0.95,
    "synthOpacityScale": 0.55,
    "zCompression": 1
  }
}
```

`maxXY` caps the longest preview image side. `maxSlices` caps the sampled Z
planes per TIFF. `preloadConcurrency` controls how many TIFFs the client
preloads at once. `maxPixelRatio` caps the WebGL canvas device-pixel ratio.
The 3D view renders real and synthetic TIFF previews as capped sparse point
clouds controlled by the `pointCloud` settings. With `zCompression: 1`, the
3D Z span is derived from the raw TIFF voxel scale; lower values intentionally
compress Z, and higher values exaggerate it.
Use a hard browser refresh after changing this file during local development.

## Build

```bash
npm run build
```

## Component Preview With Storybook

Storybook previews frontend components with mock data, without starting the
backend or CellUniverse engine.

Run:

```bash
npm run storybook
```

Open:

```text
http://127.0.0.1:6007
```

Current stories live in:

```text
src/stories/components.stories.tsx
```

Build a static Storybook export:

```bash
npm run build-storybook
```

The static output is written to `storybook-static/`, which is ignored by git.

## Visual Smoke Check

With the backend and frontend dev servers running:

```bash
npm run check:visual
```

This uses the system Chrome at `/usr/bin/google-chrome`, mocks a tiny backend
job with TIFF output, captures desktop and mobile screenshots into `/tmp`,
checks that the 2D canvas has non-background pixels, and confirms that the 3D
canvas mounts.
