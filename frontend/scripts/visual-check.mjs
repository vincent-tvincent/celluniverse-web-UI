import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import UTIF from "utif";

const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const baseUrl = process.env.FRONTEND_URL || "http://127.0.0.1:5173/";

const viewports = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await installMockApi(page);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".viewer-shell", { timeout: 10000 });
    await page
      .waitForFunction(
        () => {
          const text = document.querySelector(".load-badge")?.textContent || "";
          return !text.includes("Loading output") && !text.includes("Caching TIFF");
        },
        { timeout: 45000 },
      )
      .catch(() => undefined);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /2D/i }).click();
    await page.waitForSelector("canvas.slice-canvas", { timeout: 10000 });

    const screenshotPath = `/tmp/celluniverse-viewer-${viewport.name}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 30000 });

    const selectedJob = await page.locator("#job-select").inputValue().catch(() => "");
    const sliceCanvasStats = await page.evaluate(() => {
      const canvas = document.querySelector("canvas.slice-canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        return { present: false, nonBackgroundPixels: 0, width: 0, height: 0 };
      }
      const context = canvas.getContext("2d");
      if (!context) {
        return { present: true, nonBackgroundPixels: 0, width: canvas.width, height: canvas.height };
      }
      const { width, height } = canvas;
      const data = context.getImageData(0, 0, width, height).data;
      let nonBackgroundPixels = 0;
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r > 18 || g > 22 || b > 28) {
          nonBackgroundPixels += 1;
        }
      }
      return { present: true, nonBackgroundPixels, width, height };
    });

    await page.getByRole("button", { name: /3D/i }).click();
    await page.waitForTimeout(1500);
    const webglCanvasCount = await page.locator(".volume-stage canvas").count();
    const volumeScreenshotPath = `/tmp/celluniverse-viewer-${viewport.name}-3d.png`;
    const volumeScreenshot = await page.screenshot({ path: volumeScreenshotPath, fullPage: false, timeout: 30000 });
    const webglStats = countScreenshotPixels(volumeScreenshot);

    if (!selectedJob) {
      throw new Error(`${viewport.name}: no job selected`);
    }
    if (!sliceCanvasStats.present || sliceCanvasStats.nonBackgroundPixels < 50) {
      throw new Error(`${viewport.name}: 2D canvas appears blank`);
    }
    if (webglCanvasCount < 1) {
      throw new Error(`${viewport.name}: 3D canvas was not mounted`);
    }
    if (webglStats.nonBackgroundPixels < 500) {
      throw new Error(`${viewport.name}: 3D canvas appears blank`);
    }

    console.log(
      `${viewport.name}: ok job=${selectedJob} 2d=${sliceCanvasStats.width}x${sliceCanvasStats.height} nonBackground=${sliceCanvasStats.nonBackgroundPixels} 3d=${webglStats.width}x${webglStats.height} webglNonBackground=${webglStats.nonBackgroundPixels} screenshots=${screenshotPath},${volumeScreenshotPath}`,
    );

    await page.close();
  }
} finally {
  await browser.close();
}

function countScreenshotPixels(buffer) {
  const png = PNG.sync.read(buffer);
  let nonBackgroundPixels = 0;
  for (let i = 0; i < png.data.length; i += 64) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (r > 28 || g > 32 || b > 38) {
      nonBackgroundPixels += 1;
    }
  }
  return { nonBackgroundPixels, width: png.width, height: png.height };
}

async function installMockApi(page) {
  const realTiff = createTiff(96, 72, "real");
  const synthTiff = createTiff(96, 72, "synth");
  const realSlice = createSlicePreview(96, 72, 1, 0, "real");
  const synthSlice = createSlicePreview(96, 72, 1, 0, "synth");
  const job = {
    completedFrames: 1,
    createdAt: "2026-05-31T00:00:00Z",
    currentFrame: 0,
    error: null,
    exitCode: null,
    finishedAt: null,
    firstFrame: 0,
    id: "job_visual",
    label: "visual smoke job",
    lastCompletedFrame: 0,
    lastFrame: 0,
    outputReady: {
      cellsCsv: true,
      checkpointFrames: [0],
      pngFrames: [],
      tiffFrames: [0],
    },
    partialOutputsAvailable: true,
    pid: 1,
    progress: 1,
    queuePosition: null,
    startedAt: "2026-05-31T00:00:00Z",
    state: "running",
    totalFrames: 1,
    type: "tracking",
  };
  const manifest = {
    axes: ["t", "z", "y", "x"],
    frames: [
      {
        t: 0,
        layers: {
          realTiff: {
            format: "tiff",
            url: "/api/jobs/job_visual/files/output/tiff/real/0.tif",
          },
          synthTiff: {
            format: "tiff",
            url: "/api/jobs/job_visual/files/output/tiff/synth/0.tif",
          },
          cells: {
            format: "ellipsoid-json",
            url: "/api/jobs/job_visual/frames/0/cells",
          },
        },
      },
    ],
    jobId: "job_visual",
    lineage: "/api/jobs/job_visual/lineage",
  };
  const cells = [
    {
      file: 0,
      name: "cell_0",
      x: 36,
      y: 34,
      z: 0,
      aRadius: 14,
      bRadius: 10,
      cRadius: 2,
      theta_z: 0.2,
      isTrash: false,
    },
  ];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/jobs") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify([job]) });
      return;
    }
    if (path === "/api/jobs/job_visual") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(job) });
      return;
    }
    if (path === "/api/jobs/job_visual/manifest") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(manifest) });
      return;
    }
    if (path === "/api/jobs/job_visual/frames/0/cells") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(cells) });
      return;
    }
    if (path === "/api/jobs/job_visual/logs") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          jobId: "job_visual",
          stream: url.searchParams.get("stream") || "stdout",
          lines: ["[Visual Check] frame 0", "[Visual Check] TIFF and cell overlay ready"],
        }),
      });
      return;
    }
    if (path === "/api/jobs/job_visual/events") {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    }
    if (path === "/api/jobs/job_visual/files/output/tiff/real/0.tif") {
      await route.fulfill({ contentType: "image/tiff", body: Buffer.from(realTiff) });
      return;
    }
    if (path === "/api/jobs/job_visual/files/output/tiff/synth/0.tif") {
      await route.fulfill({ contentType: "image/tiff", body: Buffer.from(synthTiff) });
      return;
    }
    if (/^\/api\/jobs\/job_visual\/slices\/real\/0\/\d+\.cusl$/.test(path)) {
      await route.fulfill({ contentType: "application/octet-stream", body: Buffer.from(realSlice) });
      return;
    }
    if (/^\/api\/jobs\/job_visual\/slices\/synth\/0\/\d+\.cusl$/.test(path)) {
      await route.fulfill({ contentType: "application/octet-stream", body: Buffer.from(synthSlice) });
      return;
    }
    await route.fulfill({ status: 404, body: "mock route not found" });
  });
}

function createTiff(width, height, kind) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - width * 0.5) / width;
      const dy = (y - height * 0.5) / height;
      const radial = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.4);
      const stripe = kind === "synth" ? (x + y) % 17 < 6 : (x - y + 200) % 23 < 8;
      const value = Math.round(Math.max(radial * 220, stripe ? 115 : 0));
      const offset = (y * width + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
  return UTIF.encodeImage(rgba, width, height);
}

function createSlicePreview(width, height, depth, sliceIndex, kind) {
  const headerSize = 36;
  const buffer = Buffer.alloc(headerSize + width * height);
  buffer.write("CUSL", 0, "ascii");
  buffer.writeUInt32LE(1, 4);
  buffer.writeUInt32LE(width, 8);
  buffer.writeUInt32LE(height, 12);
  buffer.writeUInt32LE(width, 16);
  buffer.writeUInt32LE(height, 20);
  buffer.writeUInt32LE(depth, 24);
  buffer.writeUInt32LE(sliceIndex, 28);
  buffer.writeUInt32LE(255, 32);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - width * 0.5) / width;
      const dy = (y - height * 0.5) / height;
      const radial = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.4);
      const stripe = kind === "synth" ? (x + y) % 17 < 6 : (x - y + 200) % 23 < 8;
      buffer[headerSize + y * width + x] = Math.round(Math.max(radial * 220, stripe ? 115 : 0));
    }
  }
  return buffer;
}
