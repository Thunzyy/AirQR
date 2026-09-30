import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const distRoot = path.resolve(appRoot, "dist");
const standaloneAssets = [
  {
    filename: "airqr-encoder-linksite.html",
    targetDirs: [
      path.resolve(appRoot, "public", "linksites"),
      path.resolve(distRoot, "linksites"),
    ],
    logPrefix: "linksite",
  },
  {
    filename: "airqr-portable.html",
    targetDirs: [
      path.resolve(appRoot, "public"),
      distRoot,
      path.resolve(appRoot, "..", "flutter", "assets", "web"),
    ],
    logPrefix: "singlefile",
  },
];

async function getStatOrNull(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function filesDiffer(sourceFile, targetFile, sourceStat, targetStat) {
  if (!targetStat || sourceStat.size !== targetStat.size) {
    return true;
  }

  const [sourceBuffer, targetBuffer] = await Promise.all([
    fs.readFile(sourceFile),
    fs.readFile(targetFile),
  ]);

  return !sourceBuffer.equals(targetBuffer);
}

async function syncStandaloneAsset({ filename, targetDirs, logPrefix }) {
  const sourceFile = path.resolve(
    appRoot,
    "..",
    "..",
    "dist",
    "web-singlefile",
    filename,
  );
  const sourceStat = await getStatOrNull(sourceFile);

  if (!sourceStat) {
    let keptExisting = false;
    for (const targetDir of targetDirs) {
      const targetFile = path.resolve(targetDir, filename);
      const targetStat = await getStatOrNull(targetFile);
      if (targetStat) {
        keptExisting = true;
        console.warn(
          `[${logPrefix}] Source missing, keeping existing asset: ${path.relative(appRoot, targetFile)}`,
        );
      }
    }

    if (!keptExisting) {
      console.warn(
        `[${logPrefix}] Source missing and no fallback asset found for ${filename}`,
      );
    }
    return;
  }

  await Promise.all(
    targetDirs.map(async (targetDir) => {
      const targetFile = path.resolve(targetDir, filename);
      const targetStat = await getStatOrNull(targetFile);
      const shouldCopy = await filesDiffer(
        sourceFile,
        targetFile,
        sourceStat,
        targetStat,
      );

      if (!shouldCopy) {
        console.log(
          `[${logPrefix}] Up to date: ${path.relative(appRoot, targetFile)}`,
        );
        return;
      }

      await fs.mkdir(targetDir, { recursive: true });
      await fs.copyFile(sourceFile, targetFile);
      console.log(
        `[${logPrefix}] Synced ${path.relative(appRoot, sourceFile)} -> ${path.relative(appRoot, targetFile)}`,
      );
    }),
  );
}

async function main() {
  await Promise.all(standaloneAssets.map((asset) => syncStandaloneAsset(asset)));
}

main().catch((error) => {
  console.error("[standalone] Failed to sync standalone assets", error);
  process.exitCode = 1;
});
