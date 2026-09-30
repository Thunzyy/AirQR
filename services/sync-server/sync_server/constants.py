"""Shared constants for the sync server."""

import re

SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
HISTORY_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

# Request body size limits
MAX_JSON_BODY_SIZE = 1 * 1024 * 1024        # 1 MB
MAX_UPLOAD_BODY_SIZE = 100 * 1024 * 1024     # 100 MB

SECURITY_HEADERS = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data: https:; connect-src 'self' ws: wss: blob: https://static.cloudflareinsights.com https://cloudflareinsights.com; worker-src 'self' blob:",
}
