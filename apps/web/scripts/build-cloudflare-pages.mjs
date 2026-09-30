import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

function run(command, args) {
  if (process.platform === "win32" && command === "npm") {
    const shell = process.env.ComSpec || "cmd.exe";
    const commandLine = ["npm", ...args].join(" ");
    console.log(`[cloudflare-pages] ${shell} /d /s /c ${commandLine}`);
    execFileSync(shell, ["/d", "/s", "/c", commandLine], {
      cwd: appRoot,
      stdio: "inherit",
      env: process.env,
    });
    return;
  }

  console.log(`[cloudflare-pages] ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function resolvePythonCommand() {
  const candidates = [
    process.env.PYTHON,
    "python3",
    "python",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], {
        cwd: appRoot,
        stdio: "ignore",
        env: process.env,
      });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    "Python 3 is required to generate the single-file AirQR demo artifacts for Cloudflare Pages.",
  );
}

function assertExists(relativePath) {
  const fullPath = path.resolve(appRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Expected build output missing: ${relativePath}`);
  }
}

function main() {
  const python = resolvePythonCommand();

  run("npm", ["run", "build"]);
  run(python, ["../../build/encoder_linksite.py"]);
  run(python, ["../../build/web_singlefile.py"]);
  run("node", ["scripts/sync-linksite-assets.mjs"]);

  assertExists("dist/index.html");
  assertExists("dist/_headers");
  assertExists("dist/_redirects");
  assertExists("dist/airqr-portable.html");
  assertExists("dist/linksites/airqr-encoder-linksite.html");

  console.log("[cloudflare-pages] dist is ready for Cloudflare Pages publishing");
}

main();
