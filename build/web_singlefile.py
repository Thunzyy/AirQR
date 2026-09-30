#!/usr/bin/env python3
"""
Build a single-file offline AirQR web app from apps/web/dist.

The generated HTML has no external dependencies and is meant to run directly
from file:// in a browser.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import posixpath
import re
import sys
from dataclasses import dataclass
from pathlib import Path


mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("font/woff2", ".woff2")

EXCLUDED_DIST_ASSETS = {
    "airqr-portable.html",
    "linksites/airqr-encoder-linksite.html",
}


@dataclass
class Asset:
    path: str
    mime: str
    data: bytes


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def data_uri(mime: str, data: bytes) -> str:
    return f"data:{mime};base64,{b64(data)}"


def guess_mime(path: Path) -> str:
    mime, _ = mimetypes.guess_type(path.name)
    if mime:
        return mime
    if path.suffix == ".js":
        return "application/javascript"
    if path.suffix == ".wasm":
        return "application/wasm"
    return "application/octet-stream"


def collect_dist_assets(dist_dir: Path) -> dict[str, Asset]:
    assets: dict[str, Asset] = {}
    for file in dist_dir.rglob("*"):
        if not file.is_file():
            continue
        rel = file.relative_to(dist_dir).as_posix()
        if rel in EXCLUDED_DIST_ASSETS:
            continue
        web_path = "/" + rel
        assets[web_path] = Asset(path=web_path, mime=guess_mime(file), data=file.read_bytes())
    return assets


def add_zxing_wasm_assets(project_root: Path, assets: dict[str, Asset]) -> None:
    zxing_dir = project_root / "apps" / "web" / "node_modules" / "zxing-wasm" / "dist"
    candidates = {
        "/assets/zxing_reader.wasm": zxing_dir / "reader" / "zxing_reader.wasm",
        "/assets/zxing_full.wasm": zxing_dir / "full" / "zxing_full.wasm",
        "/assets/zxing_writer.wasm": zxing_dir / "writer" / "zxing_writer.wasm",
    }
    for web_path, file_path in candidates.items():
        if file_path.exists() and web_path not in assets:
            assets[web_path] = Asset(path=web_path, mime="application/wasm", data=file_path.read_bytes())


def find_font_dir(project_root: Path) -> Path | None:
    candidates = [
        project_root / "dist" / "web-python" / "assets" / "fonts",
        project_root / "dist" / "web-portable" / "assets" / "fonts",
        project_root / "apps" / "web" / "dist" / "assets" / "fonts",
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def build_inline_font_css(project_root: Path) -> str:
    font_dir = find_font_dir(project_root)
    if not font_dir:
        return ""

    required = {
        "manrope-400.woff2": 400,
        "manrope-500.woff2": 500,
        "manrope-700.woff2": 700,
    }

    parts: list[str] = []

    for filename, weight in required.items():
        path = font_dir / filename
        if not path.exists():
            continue
        uri = data_uri("font/woff2", path.read_bytes())
        parts.append(
            "\n".join(
                [
                    "@font-face {",
                    "  font-family: 'Manrope';",
                    "  font-style: normal;",
                    f"  font-weight: {weight};",
                    "  font-display: swap;",
                    f"  src: url({uri}) format('woff2');",
                    "}",
                ]
            )
        )

    material = font_dir / "material-symbols.woff2"
    if material.exists():
        uri = data_uri("font/woff2", material.read_bytes())
        parts.append(
            "\n".join(
                [
                    "@font-face {",
                    "  font-family: 'Material Symbols Outlined';",
                    "  font-style: normal;",
                    "  font-weight: 400;",
                    "  font-display: block;",
                    f"  src: url({uri}) format('woff2');",
                    "}",
                    ".material-symbols-outlined {",
                    "  font-family: 'Material Symbols Outlined';",
                    "  font-weight: normal;",
                    "  font-style: normal;",
                    "  font-size: 24px;",
                    "  line-height: 1;",
                    "  letter-spacing: normal;",
                    "  text-transform: none;",
                    "  display: inline-block;",
                    "  white-space: nowrap;",
                    "  word-wrap: normal;",
                    "  direction: ltr;",
                    "  -webkit-font-feature-settings: 'liga';",
                    "  font-feature-settings: 'liga';",
                    "  -webkit-font-smoothing: antialiased;",
                    "}",
                ]
            )
        )

    return "\n\n".join(parts)


def patch_aux_html(html: str, inline_font_css: str) -> str:
    html = re.sub(r"\s*<link[^>]+fonts\.googleapis\.com[^>]*>\s*", "\n", html, flags=re.IGNORECASE)
    html = re.sub(r"\s*<link[^>]+fonts\.gstatic\.com[^>]*>\s*", "\n", html, flags=re.IGNORECASE)
    html = re.sub(r"\s*<link[^>]+rel=\"preconnect\"[^>]*>\s*", "\n", html, flags=re.IGNORECASE)

    if inline_font_css:
        if "<style>" in html:
            html = html.replace("<style>", f"<style>\n{inline_font_css}\n\n", 1)
        else:
            html = html.replace("</head>", f"<style>\n{inline_font_css}\n</style>\n</head>")
    return html


def resolve_specifier(module_path: str, specifier: str) -> str:
    specifier = specifier.replace("\\", "/")
    if specifier.startswith("http://") or specifier.startswith("https://") or specifier.startswith("data:") or specifier.startswith("blob:"):
        return specifier
    if specifier.startswith("/"):
        return specifier
    if specifier.startswith("assets/"):
        return "/" + specifier
    if specifier.startswith("./") or specifier.startswith("../"):
        base_dir = posixpath.dirname(module_path)
        resolved = posixpath.normpath(posixpath.join(base_dir, specifier))
        if not resolved.startswith("/"):
            resolved = "/" + resolved
        return resolved
    return specifier


def module_id_from_path(path: str) -> str:
    return f"airqr{path}"


def patch_js_module(
    code: str,
    module_path: str,
    root_asset_paths: list[str],
    module_id_by_path: dict[str, str],
) -> str:
    def repl_from(match: re.Match[str]) -> str:
        prefix = match.group("prefix")
        quote = match.group("quote")
        spec = match.group("spec")
        resolved = resolve_specifier(module_path, spec)
        target = module_id_by_path.get(resolved, resolved)
        return f"{prefix}{quote}{target}{quote}"

    code = re.sub(
        r"(?P<prefix>\bfrom\s*)(?P<quote>[\"\'])(?P<spec>(?:\.{1,2}/|/assets/|assets/)[^\"\']+)(?P=quote)",
        repl_from,
        code,
    )

    def repl_import_side_effect(match: re.Match[str]) -> str:
        prefix = match.group("prefix")
        quote = match.group("quote")
        spec = match.group("spec")
        resolved = resolve_specifier(module_path, spec)
        target = module_id_by_path.get(resolved, resolved)
        return f"{prefix}{quote}{target}{quote}"

    code = re.sub(
        r"(?P<prefix>\bimport(?!\s*\()\s*)(?P<quote>[\"\'])(?P<spec>(?:\.{1,2}/|/assets/|assets/)[^\"\']+)(?P=quote)",
        repl_import_side_effect,
        code,
    )

    def repl_dynamic(match: re.Match[str]) -> str:
        quote = match.group("quote")
        spec = match.group("spec")
        resolved = resolve_specifier(module_path, spec)
        target = module_id_by_path.get(resolved, resolved)
        return f"import({quote}{target}{quote})"

    code = re.sub(
        r"import\(\s*(?P<quote>[\"\'])(?P<spec>(?:\.{1,2}/|/assets/|assets/)[^\"\']+)(?P=quote)\s*\)",
        repl_dynamic,
        code,
    )

    # Worker modules cannot rely on document-level import maps.
    code = re.sub(r"\bnew\s+Worker\s*\(", "globalThis.__airqr_create_worker(", code)

    def repl_new_url(match: re.Match[str]) -> str:
        spec = match.group("spec")
        resolved = resolve_specifier(module_path, spec)
        return f'globalThis.__airqr_asset_url("{resolved}")'

    code = re.sub(
        r"new URL\(\s*(?P<quote>[\"\'])(?P<spec>(?:\.{1,2}/|/assets/|assets/)[^\"\']+)(?P=quote)\s*,\s*import\.meta\.url\s*\)",
        repl_new_url,
        code,
    )

    def repl_g1(match: re.Match[str]) -> str:
        arg = match.group("arg")
        return f'g1 = function({arg}) {{ return globalThis.__airqr_asset_url("/" + {arg}); }};'

    code = re.sub(
        r"g1\s*=\s*function\((?P<arg>[A-Za-z_$][\w$]*)\)\s*\{\s*return\s*\"/\"\s*\+\s*(?P=arg)\s*;\s*\};",
        repl_g1,
        code,
        count=1,
    )

    code = re.sub(
        r"https://fastly\.jsdelivr\.net/npm/zxing-wasm@2\.2\.4/dist/\$\{[^}]+\}/\$\{([A-Za-z_$][\w$]*)\}",
        lambda m: "${globalThis.__airqr_asset_url(\"/assets/\" + " + m.group(1) + ")}",
        code,
    )

    for path in sorted(root_asset_paths, key=len, reverse=True):
        escaped = re.escape(path)
        code = code.replace(f'"{path}"', f'globalThis.__airqr_asset_url("{path}")')
        code = code.replace(f"'{path}'", f'globalThis.__airqr_asset_url("{path}")')
        code = re.sub(
            rf"{escaped}\?session=\$\{{",
            '${globalThis.__airqr_asset_url("' + path + '")}?session=${',
            code,
        )

    if "/assets/vendor-" in module_path:
        vendor_fe_replacement = (
            "Fe = () => {"
            " if (typeof window < \"u\" && window.location.protocol === \"file:\") {"
            "   const r = () => {"
            "     const o = window.location.hash || \"\";"
            "     return o.startsWith(\"#/\") ? o.slice(1) : o.length > 1 ? \"/\" + o.slice(1) : \"/\";"
            "   };"
            "   const [o, s] = w.useState(r);"
            "   w.useEffect(() => {"
            "     const c = () => s(r());"
            "     window.addEventListener(\"hashchange\", c);"
            "     window.addEventListener(\"popstate\", c);"
            "     c();"
            "     return () => {"
            "       window.removeEventListener(\"hashchange\", c);"
            "       window.removeEventListener(\"popstate\", c);"
            "     };"
            "   }, []);"
            "   const c = (d, h) => {"
            "     const u = typeof d == \"string\" ? d : String(d);"
            "     const t = u.startsWith(\"#\") ? u : u.startsWith(\"/\") ? `#${u}` : `#/${u.replace(/^\\\\/+/, \"\")}`;"
            "     h != null && h.replace ? window.history.replaceState(h == null ? void 0 : h.state, \"\", t) : window.history.pushState(h == null ? void 0 : h.state, \"\", t);"
            "     window.dispatchEvent(new Event(\"hashchange\"));"
            "   };"
            "   return [o || \"/\", c];"
            " }"
            " return _e(de());"
            "};"
        )
        code = re.sub(r"\bFe\s*=\s*\(\)\s*=>\s*_e\(de\(\)\);", vendor_fe_replacement, code, count=1)

    return code


def extract_first(pattern: str, text: str, default: str = "") -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return default
    return match.group(1)


def extract_stylesheet_hrefs(index_html_text: str) -> list[str]:
    hrefs: list[str] = []
    for match in re.finditer(r"<link[^>]*>", index_html_text, flags=re.IGNORECASE):
        tag = match.group(0)
        if not re.search(r'rel\s*=\s*["\']stylesheet["\']', tag, flags=re.IGNORECASE):
            continue
        href_match = re.search(r'href\s*=\s*["\']([^"\']+)["\']', tag, flags=re.IGNORECASE)
        if href_match:
            hrefs.append(href_match.group(1))
    return hrefs


def create_output_html(
    index_html_text: str,
    body_class: str,
    html_lang: str,
    html_class: str,
    title: str,
    inline_font_css: str,
    inline_main_css: str,
    import_map: dict[str, dict[str, str]],
    blob_manifest: dict[str, dict[str, str]],
    module_data_manifest: dict[str, str],
    wasm_data_manifest: dict[str, str],
    worker_children_manifest: dict[str, list[str]],
    worker_wasm_deps_manifest: dict[str, list[str]],
    entry_module: str,
    app_version: str,
) -> str:
    import_map_json = json.dumps(import_map, ensure_ascii=False, separators=(",", ":"))
    blob_manifest_json = json.dumps(blob_manifest, ensure_ascii=False, separators=(",", ":"))
    module_data_manifest_json = json.dumps(module_data_manifest, ensure_ascii=False, separators=(",", ":"))
    wasm_data_manifest_json = json.dumps(wasm_data_manifest, ensure_ascii=False, separators=(",", ":"))
    worker_children_manifest_json = json.dumps(worker_children_manifest, ensure_ascii=False, separators=(",", ":"))
    worker_wasm_deps_manifest_json = json.dumps(worker_wasm_deps_manifest, ensure_ascii=False, separators=(",", ":"))

    description = extract_first(r'<meta\s+name="description"\s+content="([^"]*)"', index_html_text)
    theme_color = extract_first(r'<meta\s+name="theme-color"\s+content="([^"]*)"', index_html_text, "#0f1419")

    skip_link = (
        '<a href="#main-content" '
        'class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 '
        'focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg">'
        "Skip to content"
        "</a>"
    )

    bootstrap_js = f"""
(() => {{
  const manifest = {blob_manifest_json};
  const moduleDataUrls = {module_data_manifest_json};
  const wasmDataUrls = {wasm_data_manifest_json};
  const workerChildren = {worker_children_manifest_json};
  const workerWasmDeps = {worker_wasm_deps_manifest_json};
  const blobUrls = Object.create(null);

  const decodeBase64 = (value) => {{
    const binary = atob(value);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {{
      bytes[i] = binary.charCodeAt(i);
    }}
    return bytes;
  }};

  for (const [assetPath, descriptor] of Object.entries(manifest)) {{
    try {{
      const bytes = decodeBase64(descriptor.b64);
      const blob = new Blob([bytes], {{ type: descriptor.mime || "application/octet-stream" }});
      blobUrls[assetPath] = URL.createObjectURL(blob);
    }} catch (error) {{
      console.error("Failed to create blob URL for", assetPath, error);
    }}
  }}

  const canonicalizePath = (rawPath) => {{
    const normalized = String(rawPath || "").replace(/\\\\/g, "/");
    let path = normalized;
    if (path.startsWith("file://")) {{
      try {{
        path = new URL(path).pathname || path;
      }} catch (_error) {{
      }}
    }}
    const parts = path.split("/");
    const out = [];
    for (const part of parts) {{
      if (!part || part === ".") {{
        continue;
      }}
      if (part === "..") {{
        if (out.length > 0) {{
          out.pop();
        }}
        continue;
      }}
      out.push(part);
    }}
    return "/" + out.join("/");
  }};

  function __airqr_install_runtime(blobMap, moduleDataMap, wasmDataMap, workerChildrenMap, workerWasmDepsMap) {{
    const moduleMap = moduleDataMap || {{}};
    const wasmMap = wasmDataMap || {{}};
    const workerChildMap = workerChildrenMap || {{}};
    const workerWasmMap = workerWasmDepsMap || {{}};
    const canonicalizePathInRuntime = (rawPath) => {{
      const normalized = String(rawPath || "").replace(/\\\\/g, "/");
      let path = normalized;
      if (path.startsWith("file://")) {{
        try {{
          path = new URL(path).pathname || path;
        }} catch (_error) {{
        }}
      }}
      const parts = path.split("/");
      const out = [];
      for (const part of parts) {{
        if (!part || part === ".") {{
          continue;
        }}
        if (part === "..") {{
          if (out.length > 0) {{
            out.pop();
          }}
          continue;
        }}
        out.push(part);
      }}
      return "/" + out.join("/");
    }};

    const resolveAssetUrl = (input) => {{
      if (input == null) {{
        return input;
      }}

      let value = input;
      if (typeof value === "object" && value !== null && "href" in value) {{
        value = value.href;
      }}

      const str = String(value);
      if (str.startsWith("blob:") || str.startsWith("data:") || str.startsWith("http://") || str.startsWith("https://")) {{
        return str;
      }}

      let base = str;
      let suffix = "";
      const queryIdx = str.indexOf("?");
      const hashIdx = str.indexOf("#");
      let cutIdx = -1;
      if (queryIdx >= 0 && hashIdx >= 0) {{
        cutIdx = Math.min(queryIdx, hashIdx);
      }} else {{
        cutIdx = Math.max(queryIdx, hashIdx);
      }}
      if (cutIdx >= 0) {{
        base = str.slice(0, cutIdx);
        suffix = str.slice(cutIdx);
      }}

      if (!base.startsWith("/") && !base.startsWith(".")) {{
        base = "/" + base;
      }}

      const normalized = canonicalizePathInRuntime(base);
      let mappedWasm = wasmMap[normalized];
      if (!mappedWasm && normalized.startsWith("/assets/")) {{
        mappedWasm = wasmMap[normalized.slice(7)];
      }}
      if (!mappedWasm && normalized.startsWith("/")) {{
        mappedWasm = wasmMap["/assets" + normalized];
      }}
      if (mappedWasm) {{
        return mappedWasm + suffix;
      }}

      let mapped = blobMap[normalized];
      if (!mapped && normalized.startsWith("/assets/")) {{
        mapped = blobMap[normalized.slice(7)];
      }}
      if (!mapped && normalized.startsWith("/")) {{
        mapped = blobMap["/assets" + normalized];
      }}

      return mapped ? (mapped + suffix) : str;
    }};

    const blobUrlToPath = Object.create(null);
    for (const [assetPath, assetUrl] of Object.entries(blobMap)) {{
      if (typeof assetUrl === "string") {{
        blobUrlToPath[assetUrl] = assetPath;
      }}
    }}

    const resolveAssetPath = (input) => {{
      if (input == null) {{
        return null;
      }}

      let value = input;
      if (typeof value === "object" && value !== null && "href" in value) {{
        value = value.href;
      }}

      const str = String(value);
      const direct = blobUrlToPath[str];
      if (direct) {{
        return direct;
      }}

      const queryIdx = str.indexOf("?");
      const hashIdx = str.indexOf("#");
      let cutIdx = -1;
      if (queryIdx >= 0 && hashIdx >= 0) {{
        cutIdx = Math.min(queryIdx, hashIdx);
      }} else {{
        cutIdx = Math.max(queryIdx, hashIdx);
      }}

      const base = cutIdx >= 0 ? str.slice(0, cutIdx) : str;
      const normalized = canonicalizePathInRuntime(base);
      if (blobMap[normalized]) {{
        return normalized;
      }}
      if (normalized.startsWith("/assets/") && blobMap[normalized.slice(7)]) {{
        return normalized.slice(7);
      }}
      if (normalized.startsWith("/") && blobMap["/assets" + normalized]) {{
        return "/assets" + normalized;
      }}
      return null;
    }};

    const encodeScriptToDataUrl = (source) => {{
      const bytes = new TextEncoder().encode(String(source));
      const CHUNK = 32768;
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {{
        const chunk = bytes.subarray(offset, offset + CHUNK);
        binary += String.fromCharCode(...chunk);
      }}
      return "data:text/javascript;base64," + btoa(binary);
    }};

    const buildWorkerSubset = (entryPath) => {{
      const moduleSubset = Object.create(null);
      const wasmSubset = Object.create(null);
      if (!entryPath) {{
        return {{ moduleSubset, wasmSubset }};
      }}

      const queue = [entryPath];
      const visited = new Set();
      while (queue.length > 0) {{
        const current = queue.pop();
        if (!current || visited.has(current)) {{
          continue;
        }}
        visited.add(current);
        if (moduleMap[current]) {{
          moduleSubset[current] = moduleMap[current];
        }}
        const wasmDeps = Array.isArray(workerWasmMap[current]) ? workerWasmMap[current] : [];
        for (const wasmPath of wasmDeps) {{
          if (wasmMap[wasmPath]) {{
            wasmSubset[wasmPath] = wasmMap[wasmPath];
          }}
        }}
        const children = Array.isArray(workerChildMap[current]) ? workerChildMap[current] : [];
        for (const childPath of children) {{
          queue.push(childPath);
        }}
      }}

      return {{
        moduleSubset,
        wasmSubset,
      }};
    }};

    globalThis.__airqr_blob_urls = blobMap;
    globalThis.__airqr_blob_url_to_path = blobUrlToPath;
    globalThis.__airqr_module_data_urls = moduleMap;
    globalThis.__airqr_wasm_data_urls = wasmMap;
    globalThis.__airqr_worker_children = workerChildMap;
    globalThis.__airqr_worker_wasm_deps = workerWasmMap;
    globalThis.__airqr_asset_url = resolveAssetUrl;

    // Module workers do not inherit page import maps. Wrap worker entrypoints
    // so each worker realm installs the same offline resolver before import.
    if (typeof globalThis.Worker === "function" && typeof globalThis.__airqr_create_worker !== "function") {{
      const NativeWorker = globalThis.Worker;

      globalThis.__airqr_create_worker = (url, options) => {{
        const opts = options || {{}};
        let resolved = url;
        if (typeof resolved === "object" && resolved !== null && "href" in resolved) {{
          resolved = resolved.href;
        }}
        if (typeof resolved === "string") {{
          resolved = resolveAssetUrl(resolved);
        }}

        if (opts.type === "module" && typeof resolved === "string") {{
          const resolvedPath = resolveAssetPath(url) || resolveAssetPath(resolved);
          const {{ moduleSubset, wasmSubset }} = buildWorkerSubset(resolvedPath);
          const moduleEntry = resolvedPath && moduleSubset[resolvedPath]
            ? moduleSubset[resolvedPath]
            : (resolvedPath && moduleMap[resolvedPath] ? moduleMap[resolvedPath] : resolved);
          const installSource = `(${{__airqr_install_runtime.toString()}})`;
          const wrappedCode = `${{installSource}}(${{JSON.stringify(blobMap)}}, ${{JSON.stringify(moduleSubset)}}, ${{JSON.stringify(wasmSubset)}}, ${{JSON.stringify(workerChildMap)}}, ${{JSON.stringify(workerWasmMap)}});\\n(async () => {{\\n  try {{\\n    await import(${{JSON.stringify(moduleEntry)}});\\n  }} catch (err) {{\\n    const msg = err && typeof err === "object" && "message" in err ? err.message : String(err);\\n    try {{\\n      self.postMessage({{ type: "ERROR", payload: "Worker bootstrap import failed: " + msg }});\\n    }} catch (_postErr) {{}}\\n    throw err;\\n  }}\\n}})();`;
          const wrappedUrl = encodeScriptToDataUrl(wrappedCode);
          return new NativeWorker(wrappedUrl, opts);
        }}

        return new NativeWorker(resolved, opts);
      }};
    }}
  }}

  __airqr_install_runtime(blobUrls, moduleDataUrls, wasmDataUrls, workerChildren, workerWasmDeps);
  if (typeof globalThis.__airqr_create_worker !== "function" && typeof globalThis.Worker === "function") {{
    globalThis.__airqr_create_worker = (url, options) => new Worker(url, options);
  }}

  if (typeof window !== "undefined" && window.location && window.location.protocol === "file:") {{
    const patchHistoryMethod = (methodName) => {{
      const original = window.history[methodName].bind(window.history);
      window.history[methodName] = (state, title, url) => {{
        try {{
          return original(state, title, url);
        }} catch (error) {{
          const isSecurityError = !!error && (error.name === "SecurityError" || String(error).includes("SecurityError"));
          if (!isSecurityError || typeof url !== "string") {{
            throw error;
          }}
          const fallback = url.startsWith("/") ? `#${{url}}` : `#/${{url.replace(/^\\/+/, "")}}`;
          return original(state, title, fallback);
        }}
      }};
    }};
    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");
  }}

  import("{entry_module}").catch((error) => {{
    console.error("AirQR single-file startup failed", error);
    const mount = document.getElementById("root");
    if (mount) {{
      mount.innerHTML = '<pre style="padding:16px;color:#ff8a8a;white-space:pre-wrap;">Failed to start AirQR. Check browser console.</pre>';
    }}
  }});
}})();
""".strip()

    html_class_attr = f' class="{html_class}"' if html_class else ""

    return f"""<!doctype html>
<html lang=\"{html_lang}\"{html_class_attr}>
<head>
  <meta charset=\"UTF-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
  <title>{title}</title>
  <meta name=\"description\" content=\"{description}\" />
  <meta name=\"theme-color\" content=\"{theme_color}\" />
  <meta name=\"application-version\" content=\"{app_version}\" />
  <style>
{inline_font_css}

{inline_main_css}
  </style>
  <script type=\"importmap\">{import_map_json}</script>
  <script>
{bootstrap_js}
  </script>
</head>
<body class=\"{body_class}\">
  {skip_link}
  <main id=\"main-content\"><div id=\"root\"></div></main>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Build modern offline single-file AirQR HTML")
    parser.add_argument("--output", type=Path, default=None, help="Output HTML path")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    app_version = (project_root / "VERSION").read_text(encoding="utf-8").strip()
    dist_dir = project_root / "apps" / "web" / "dist"
    if not dist_dir.exists():
        print("[ERR] apps/web/dist not found. Run npm build first.")
        return 1

    index_html_path = dist_dir / "index.html"
    if not index_html_path.exists():
        print("[ERR] apps/web/dist/index.html not found.")
        return 1

    assets = collect_dist_assets(dist_dir)
    add_zxing_wasm_assets(project_root, assets)

    inline_font_css = build_inline_font_css(project_root)

    if "/multi-chunk.html" in assets:
        multi_chunk_html = assets["/multi-chunk.html"].data.decode("utf-8")
        patched_multi_chunk = patch_aux_html(multi_chunk_html, inline_font_css)
        assets["/multi-chunk.html"] = Asset(
            path="/multi-chunk.html",
            mime="text/html",
            data=patched_multi_chunk.encode("utf-8"),
        )

    index_html_text = index_html_path.read_text(encoding="utf-8")

    entry_module = extract_first(r'<script[^>]+type="module"[^>]+src="([^"]+)"', index_html_text)
    stylesheet_hrefs = extract_stylesheet_hrefs(index_html_text)
    if not entry_module:
        print("[ERR] Could not detect entry module from dist/index.html")
        return 1
    if not stylesheet_hrefs:
        print("[ERR] Could not detect stylesheet links from dist/index.html")
        return 1

    css_paths = [href for href in stylesheet_hrefs if href in assets and href.endswith(".css")]
    if not css_paths:
        print("[ERR] No stylesheet assets found in dist assets map")
        return 1

    # Prefer Vite-generated CSS bundles over fonts.css to preserve full app styling.
    main_css_paths = [path for path in css_paths if path.startswith("/assets/")]
    if not main_css_paths:
        main_css_paths = [path for path in css_paths if path not in ("/fonts.css", "fonts.css")]
    if not main_css_paths:
        main_css_paths = css_paths

    html_lang = extract_first(r"<html[^>]*lang=\"([^\"]+)\"", index_html_text, "en")
    html_class = extract_first(r"<html[^>]*class=\"([^\"]+)\"", index_html_text, "")
    body_class = extract_first(r"<body[^>]*class=\"([^\"]+)\"", index_html_text, "")
    title = extract_first(r"<title>(.*?)</title>", index_html_text, "AirQR")

    root_asset_paths = sorted(
        [path for path in assets.keys() if not path.startswith("/assets/") and path != "/index.html"],
        key=len,
        reverse=True,
    )

    js_asset_paths = sorted(path for path in assets if path.startswith("/assets/") and path.endswith(".js"))
    module_id_by_path = {path: module_id_from_path(path) for path in js_asset_paths}
    patched_js_assets: dict[str, bytes] = {}

    for path in js_asset_paths:
        original = assets[path].data.decode("utf-8")
        patched = patch_js_module(original, path, root_asset_paths, module_id_by_path)
        patched_js_assets[path] = patched.encode("utf-8")

    import_map_imports: dict[str, str] = {}
    module_data_manifest_all: dict[str, str] = {}
    for path in js_asset_paths:
        uri = data_uri("application/javascript", patched_js_assets[path])
        import_map_imports[module_id_by_path[path]] = uri
        module_data_manifest_all[path] = uri

    worker_js_asset_paths = sorted(
        path for path in js_asset_paths if "worker" in Path(path).name.lower()
    )
    worker_js_path_set = set(worker_js_asset_paths)
    module_data_manifest: dict[str, str] = {
        path: module_data_manifest_all[path] for path in worker_js_asset_paths
    }

    worker_children_manifest: dict[str, list[str]] = {}
    worker_wasm_deps_manifest: dict[str, list[str]] = {}
    worker_js_ref_pattern = re.compile(r"/assets/[^\"']*worker[^\"']*\.js")
    worker_wasm_ref_pattern = re.compile(r"/assets/[^\"']+\.wasm")
    worker_wasm_name_pattern = re.compile(r"\b([A-Za-z0-9_-]+\.wasm)\b")
    for path in worker_js_asset_paths:
        code = patched_js_assets[path].decode("utf-8")
        child_paths = sorted(
            dep
            for dep in set(worker_js_ref_pattern.findall(code))
            if dep in worker_js_path_set and dep != path
        )
        wasm_paths_set = set(worker_wasm_ref_pattern.findall(code))
        bare_wasm_names = set(worker_wasm_name_pattern.findall(code))
        if bare_wasm_names:
            for wasm_name in bare_wasm_names:
                for asset_path in assets.keys():
                    if asset_path.endswith("/" + wasm_name):
                        wasm_paths_set.add(asset_path)
        wasm_paths = sorted(wasm_paths_set)
        worker_children_manifest[path] = child_paths
        worker_wasm_deps_manifest[path] = wasm_paths

    inline_main_css = "\n\n".join(
        assets[path].data.decode("utf-8")
        for path in main_css_paths
    )

    blob_manifest: dict[str, dict[str, str]] = {}
    wasm_data_manifest: dict[str, str] = {}
    for path, asset in assets.items():
        if path in patched_js_assets:
            payload = patched_js_assets[path]
            mime = "application/javascript"
        else:
            payload = asset.data
            mime = asset.mime
        blob_manifest[path] = {
            "mime": mime,
            "b64": b64(payload),
        }
        if path.endswith(".wasm"):
            wasm_data_manifest[path] = data_uri("application/wasm", payload)

    for path in list(worker_wasm_deps_manifest.keys()):
        deps = worker_wasm_deps_manifest[path]
        worker_wasm_deps_manifest[path] = [dep for dep in deps if dep in wasm_data_manifest]

    output_file = args.output or (project_root / "dist" / "web-singlefile" / "airqr-portable.html")
    output_file.parent.mkdir(parents=True, exist_ok=True)

    final_html = create_output_html(
        index_html_text=index_html_text,
        body_class=body_class,
        html_lang=html_lang,
        html_class=html_class,
        title=title,
        inline_font_css=inline_font_css,
        inline_main_css=inline_main_css,
        import_map={"imports": import_map_imports},
        blob_manifest=blob_manifest,
        module_data_manifest=module_data_manifest,
        wasm_data_manifest=wasm_data_manifest,
        worker_children_manifest=worker_children_manifest,
        worker_wasm_deps_manifest=worker_wasm_deps_manifest,
        entry_module=module_id_by_path.get(entry_module, entry_module),
        app_version=app_version,
    )

    output_file.write_text(final_html, encoding="utf-8")

    size_mb = output_file.stat().st_size / (1024 * 1024)
    print(f"[OK] Built single-file offline app: {output_file}")
    print(f"[OK] Size: {size_mb:.2f} MB")
    print(f"[OK] Entry: {module_id_by_path.get(entry_module, entry_module)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
