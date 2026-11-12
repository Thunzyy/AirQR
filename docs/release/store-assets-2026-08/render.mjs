import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const html = path.join(root, "compositor.html");
const outPlay = path.join(root, "play");
const outIos = path.join(root, "appstore");

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.goto(`file://${html.replaceAll("\\", "/")}`, {
  waitUntil: "load",
});
await page.evaluate(async () => {
  await document.fonts.ready;
});

const slides = await page.$$eval(".canvas", (nodes) =>
  nodes.map((node) => ({
    id: node.getAttribute("data-id"),
    width: node.offsetWidth,
    height: node.offsetHeight,
    isPlay: node.classList.contains("play"),
    isStore: node.classList.contains("store"),
    isFeature: node.classList.contains("feature"),
  })),
);

await mkdir(outPlay, { recursive: true });
await mkdir(outIos, { recursive: true });

for (const slide of slides) {
  const handle = await page.$(`[data-id="${slide.id}"]`);
  const destDir = slide.isStore ? outIos : outPlay;
  const dest = path.join(destDir, `${slide.id}.png`);
  await handle.screenshot({
    path: dest,
    type: "png",
    animations: "disabled",
  });
  console.log(`${slide.id} ${slide.width}x${slide.height} -> ${dest}`);
}

await browser.close();
