#!/usr/bin/env python3
"""
AirQR Web - Python Portable Bundle Builder.

Builds a fully local static bundle:
- Copies apps/web/dist to dist/web-python
- Verifies no external font/CDN URLs remain in HTML entry pages
- Adds Python/PowerShell runtime server scripts
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path


HTML_FILES_TO_CHECK = ("index.html", "multi-chunk.html", "gif-viewer.html")
EXTERNAL_DEP_PATTERNS = (
    re.compile(r"https://fonts\.googleapis\.com", flags=re.IGNORECASE),
    re.compile(r"https://fonts\.gstatic\.com", flags=re.IGNORECASE),
    re.compile(r"https://cdn\.jsdelivr\.net", flags=re.IGNORECASE),
    re.compile(r"https://unpkg\.com", flags=re.IGNORECASE),
)


class Logger:
    COLORS = {
        "green": "\033[92m",
        "yellow": "\033[93m",
        "red": "\033[91m",
        "blue": "\033[94m",
        "reset": "\033[0m",
    }

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        if sys.platform == "win32":
            try:
                import ctypes

                kernel32 = ctypes.windll.kernel32
                kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
            except Exception:
                self.COLORS = {k: "" for k in self.COLORS}

    def _color(self, color: str, text: str) -> str:
        return f"{self.COLORS.get(color, '')}{text}{self.COLORS['reset']}"

    def info(self, msg: str) -> None:
        print(f"  {self._color('blue', 'INFO')}  {msg}")

    def success(self, msg: str) -> None:
        print(f"  {self._color('green', '  OK')}  {msg}")

    def warn(self, msg: str) -> None:
        print(f"  {self._color('yellow', 'WARN')}  {msg}")

    def error(self, msg: str) -> None:
        print(f"  {self._color('red', ' ERR')}  {msg}")

    def step(self, num: int, total: int, msg: str) -> None:
        print(f"\n[{num}/{total}] {msg}")


def copy_dist(dist_dir: Path, output_dir: Path, log: Logger) -> bool:
    log.step(1, 4, "Copie du build web")

    if not dist_dir.exists():
        log.error(f"Dossier dist introuvable: {dist_dir}")
        log.info("Exécutez d'abord: cd apps/web && npm run build")
        return False

    if output_dir.exists():
        shutil.rmtree(output_dir)

    shutil.copytree(dist_dir, output_dir)
    file_count = sum(1 for p in output_dir.rglob("*") if p.is_file())
    log.success(f"{file_count} fichiers copiés dans {output_dir}")
    return True


def validate_local_dependencies(output_dir: Path, log: Logger) -> bool:
    log.step(2, 4, "Validation offline (aucune dépendance externe)")
    has_issue = False

    for html_name in HTML_FILES_TO_CHECK:
        html_path = output_dir / html_name
        if not html_path.exists():
            continue
        content = html_path.read_text(encoding="utf-8")
        for pattern in EXTERNAL_DEP_PATTERNS:
            if pattern.search(content):
                log.error(f"Dépendance externe détectée dans {html_name}: {pattern.pattern}")
                has_issue = True

    fonts_css = output_dir / "fonts.css"
    if not fonts_css.exists():
        log.error("fonts.css absent")
        has_issue = True
    else:
        log.success("fonts.css présent")

    fonts_dir = output_dir / "assets" / "fonts"
    required_fonts = (
        "manrope-400.woff2",
        "manrope-500.woff2",
        "manrope-700.woff2",
        "material-symbols.woff2",
    )
    missing_fonts = [name for name in required_fonts if not (fonts_dir / name).exists()]
    if missing_fonts:
        log.error(f"Fonts locales manquantes: {', '.join(missing_fonts)}")
        has_issue = True
    else:
        log.success("Fonts locales présentes")

    if has_issue:
        log.error("Validation offline échouée")
        return False

    log.success("Validation offline OK")
    return True


def write_server_scripts(output_dir: Path, web_dir: Path, log: Logger) -> bool:
    log.step(3, 4, "Ajout des scripts serveur")

    serve_src = web_dir / "serve.py"
    if not serve_src.exists():
        log.error(f"serve.py introuvable: {serve_src}")
        return False

    shutil.copy2(serve_src, output_dir / "serve.py")

    serve_ps1 = r"""# AirQR Web - PowerShell HTTP Server (No Python required)
param([int]$Port = 8080, [switch]$NoBrowser)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path "$scriptDir\index.html")) {
    Write-Host "ERROR: index.html not found" -ForegroundColor Red
    exit 1
}

$actualPort = $Port
for ($p = $Port; $p -lt ($Port + 100); $p++) {
    try {
        $t = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
        $t.Start(); $t.Stop(); $actualPort = $p; break
    } catch { continue }
}

$url = "http://localhost:$actualPort"
Write-Host "Serving AirQR Web on $url"
Write-Host "Press Ctrl+C to stop"

$mimeTypes = @{
    ".html"="text/html; charset=utf-8"; ".css"="text/css; charset=utf-8"; ".js"="application/javascript; charset=utf-8"
    ".mjs"="application/javascript; charset=utf-8"; ".json"="application/json; charset=utf-8"; ".wasm"="application/wasm"
    ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".gif"="image/gif"; ".svg"="image/svg+xml"
    ".ico"="image/x-icon"; ".woff"="font/woff"; ".woff2"="font/woff2"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$actualPort/")
$listener.Start()

if (-not $NoBrowser) {
    Start-Sleep -Milliseconds 500
    Start-Process $url
}

function Send-Response {
    param($response, $bytes, $contentType)
    $response.ContentType = $contentType
    $response.ContentLength64 = $bytes.LongLength
    $response.AddHeader("Cross-Origin-Opener-Policy", "same-origin")
    $response.AddHeader("Cross-Origin-Embedder-Policy", "require-corp")
    $response.AddHeader("Cross-Origin-Resource-Policy", "same-origin")
    $stream = $response.OutputStream
    [void]$stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $res = $ctx.Response
        try {
            $path = $ctx.Request.Url.LocalPath
            if ($path -eq "/") { $path = "/index.html" }
            $relativePath = $path.TrimStart("/").Replace("/", "\")
            $file = Join-Path $scriptDir $relativePath

            if (-not (Test-Path $file) -and -not $path.StartsWith("/assets/") -and -not $path.Contains(".")) {
                $file = Join-Path $scriptDir "index.html"
            }

            if (Test-Path $file -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($file).ToLower()
                $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
                $bytes = [System.IO.File]::ReadAllBytes($file)
                $res.StatusCode = 200
                Send-Response $res $bytes $mime
            } else {
                $res.StatusCode = 404
                $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                Send-Response $res $bytes "text/plain; charset=utf-8"
            }
        } catch {
            try { $res.Abort() } catch {}
        }
    }
} finally {
    $listener.Stop()
}
"""
    (output_dir / "serve.ps1").write_text(serve_ps1, encoding="utf-8")

    start_bat = """@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where powershell >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    powershell -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
    exit /b %ERRORLEVEL%
)

where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    python serve.py %*
    exit /b %ERRORLEVEL%
)

echo ERROR: Neither PowerShell nor Python was found.
exit /b 1
"""
    (output_dir / "start.bat").write_text(start_bat, encoding="utf-8")

    start_sh = """#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
python3 serve.py "$@" || python serve.py "$@"
"""
    start_sh_path = output_dir / "start.sh"
    start_sh_path.write_text(start_sh, encoding="utf-8")
    start_sh_path.chmod(start_sh_path.stat().st_mode | 0o111)

    log.success("Scripts créés: serve.py, serve.ps1, start.bat, start.sh")
    return True


def write_runtime_readme(output_dir: Path, log: Logger) -> None:
    log.step(4, 4, "Génération du README runtime")
    readme = """# AirQR Web - Python Bundle

Version offline servie localement avec un serveur léger.

## Lancer

### Windows
```bat
start.bat
```

### Linux/macOS
```bash
./start.sh
```

### Manuel (Python)
```bash
python serve.py --port 8080
```
"""
    (output_dir / "README.md").write_text(readme, encoding="utf-8")
    log.success("README.md généré")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build AirQR web Python bundle")
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help="Output directory (default: dist/web-python)",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Show verbose logs")
    args = parser.parse_args()

    log = Logger(verbose=args.verbose)
    project_root = Path(__file__).resolve().parents[1]
    web_dir = project_root / "apps" / "web"
    dist_dir = web_dir / "dist"
    if args.output is None:
        output_dir = project_root / "dist" / "web-python"
    elif args.output.is_absolute():
        output_dir = args.output
    else:
        output_dir = (project_root / args.output).resolve()

    print("\n" + "=" * 60)
    print("  AirQR Web - Python Portable Bundle Builder")
    print("=" * 60)
    log.info(f"Source: {dist_dir}")
    log.info(f"Output: {output_dir}")

    if not copy_dist(dist_dir, output_dir, log):
        return 1
    if not validate_local_dependencies(output_dir, log):
        return 1
    if not write_server_scripts(output_dir, web_dir, log):
        return 1
    write_runtime_readme(output_dir, log)

    total_size = sum(p.stat().st_size for p in output_dir.rglob("*") if p.is_file())
    log.success(f"Bundle prêt: {output_dir} ({total_size / 1024 / 1024:.1f}MB)")
    print("\nLancement rapide: dist/web-python/start.bat (Windows) ou ./dist/web-python/start.sh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
