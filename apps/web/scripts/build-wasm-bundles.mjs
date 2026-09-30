import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const crateRoot = path.resolve(repoRoot, "packages", "airqr-core");
const webPkgDir = path.resolve(webRoot, "src", "pkg");
const webThreadedPkgDir = path.resolve(webRoot, "src", "pkg-threaded");
const runtimePkgDir = path.resolve(
  repoRoot,
  "services",
  "sync-server",
  "sync_server",
  "runtime",
  "packet_assembler",
);
const threadedToolchains = process.env.AIRQR_WASM_THREADS_TOOLCHAIN
  ? [process.env.AIRQR_WASM_THREADS_TOOLCHAIN]
  : ["nightly", "nightly-2024-08-02"];
const generatedEntries = [
  "airqr_core.js",
  "airqr_core.d.ts",
  "airqr_core_bg.wasm",
  "airqr_core_bg.wasm.d.ts",
  "airqrCoreTyped.ts",
  "airqrCoreThreaded.ts",
  "package.json",
  "snippets",
];

function ensureGeneratedDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
  const gitignorePath = path.join(dirPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, "*\n");
  }
}

function removeGeneratedEntries(dirPath) {
  for (const entry of generatedEntries) {
    rmSync(path.join(dirPath, entry), {
      force: true,
      recursive: true,
    });
  }
}

function syncGeneratedEntries(sourceDir, targetDir) {
  ensureGeneratedDir(targetDir);
  removeGeneratedEntries(targetDir);

  for (const entry of generatedEntries) {
    const sourcePath = path.join(sourceDir, entry);
    if (!existsSync(sourcePath)) {
      continue;
    }

    cpSync(sourcePath, path.join(targetDir, entry), {
      force: true,
      recursive: true,
    });
  }
}

function toWasmPackOutDir(targetDir) {
  const relative = path.relative(crateRoot, targetDir).replaceAll("\\", "/");
  if (!relative || relative === ".") {
    return ".";
  }
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    shell: false,
    stdio: "inherit",
  });

  return {
    error: result.error ?? null,
    status: result.status ?? (result.error ? 1 : 0),
  };
}

function withTemporaryThreadedCargoConfig(runBuild) {
  const cargoDir = path.join(crateRoot, ".cargo");
  const configPath = path.join(cargoDir, "config.toml");
  const hadExistingConfig = existsSync(configPath);
  const previousConfig = hadExistingConfig ? readFileSync(configPath, "utf8") : null;

  mkdirSync(cargoDir, { recursive: true });
  writeFileSync(
    configPath,
    [
      "[target.wasm32-unknown-unknown]",
      'rustflags = ["-C", "target-feature=+atomics,+bulk-memory"]',
      "",
      "[unstable]",
      'build-std = ["panic_abort", "std"]',
      "",
    ].join("\n"),
  );

  try {
    return runBuild();
  } finally {
    if (hadExistingConfig && previousConfig !== null) {
      writeFileSync(configPath, previousConfig);
    } else {
      rmSync(configPath, { force: true });
    }
  }
}

function buildNonThreadedWebPkg() {
  ensureGeneratedDir(webPkgDir);
  removeGeneratedEntries(webPkgDir);

  const result = runCommand(
    "wasm-pack",
    [
      "build",
      "--target",
      "web",
      "--out-dir",
      toWasmPackOutDir(webPkgDir),
      "--no-default-features",
      "--features",
      "wasm",
    ],
    { cwd: crateRoot },
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      `Non-threaded wasm build failed with status ${result.status}`,
    );
  }

  syncGeneratedEntries(webPkgDir, runtimePkgDir);
}

function buildThreadedWebPkg() {
  ensureGeneratedDir(webThreadedPkgDir);
  removeGeneratedEntries(webThreadedPkgDir);

  for (const threadedToolchain of threadedToolchains) {
    const threadedResult = withTemporaryThreadedCargoConfig(() =>
      runCommand(
        "rustup",
        [
          "run",
          threadedToolchain,
          "wasm-pack",
          "build",
          "--target",
          "web",
          "--out-dir",
          toWasmPackOutDir(webThreadedPkgDir),
          "--no-default-features",
          "--features",
          "wasm-threads",
        ],
        {
          cwd: crateRoot,
        },
      ),
    );

    if (!threadedResult.error && threadedResult.status === 0) {
      return {
        enabled: true,
        toolchain: threadedToolchain,
      };
    }
  }

  console.warn(
    [
      "",
      "⚠️ Threaded WASM build unavailable, falling back to the non-threaded web bundle.",
      `   Tried toolchains: ${threadedToolchains.join(", ")}`,
      "   Install nightly + rust-src + wasm32-unknown-unknown to enable wasm threads.",
      "",
    ].join("\n"),
  );
  syncGeneratedEntries(webPkgDir, webThreadedPkgDir);
  return {
    enabled: false,
    toolchain: null,
  };
}

function syncRuntimeOnly() {
  const wasmPath = path.join(webPkgDir, "airqr_core_bg.wasm");
  if (!existsSync(wasmPath)) {
    throw new Error(
      "Non-threaded web WASM bundle missing. Run `npm run build:wasm` first.",
    );
  }
  syncGeneratedEntries(webPkgDir, runtimePkgDir);
}

const syncRuntimeOnlyFlag = process.argv.includes("--sync-runtime-only");

if (syncRuntimeOnlyFlag) {
  syncRuntimeOnly();
  console.log("✅ Synced non-threaded WASM runtime assets");
  process.exit(0);
}

buildNonThreadedWebPkg();
const threadedBuild = buildThreadedWebPkg();

console.log(
  threadedBuild.enabled
    ? `✅ Built non-threaded runtime bundle and threaded web bundle (${threadedBuild.toolchain})`
    : "✅ Built non-threaded runtime bundle and non-threaded web fallback bundle",
);
