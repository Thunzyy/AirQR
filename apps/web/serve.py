#!/usr/bin/env python3
"""
AirQR Web - Offline HTTP Server

Simple HTTP server with proper MIME types, COOP/COEP headers for SharedArrayBuffer,
and memory caching for optimal performance.

Usage:
    python serve.py [--port PORT] [--no-browser] [--no-cache] [--verbose]

Options:
    --port PORT      Port to listen on (default: 8080)
    --no-browser     Don't auto-open browser
    --no-cache       Disable memory caching
    --verbose        Show HTTP request logs
"""

import argparse
import os
import sys
import threading
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Dict, Optional

# =============================================================================
# CONFIGURATION
# =============================================================================

# MIME types mapping
MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
}

# Security headers for SharedArrayBuffer support
SECURITY_HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
}

# Cache settings (cache files smaller than this threshold)
CACHE_MAX_SIZE = 5 * 1024 * 1024  # 5MB

# =============================================================================
# MEMORY CACHE
# =============================================================================

class FileCache:
    """Simple in-memory file cache."""

    def __init__(self, enabled: bool = True, max_size: int = CACHE_MAX_SIZE):
        self.enabled = enabled
        self.max_size = max_size
        self.cache: Dict[str, bytes] = {}
        self.lock = threading.Lock()

    def get(self, path: str) -> Optional[bytes]:
        """Get file from cache."""
        if not self.enabled:
            return None
        with self.lock:
            return self.cache.get(path)

    def put(self, path: str, content: bytes):
        """Put file in cache if it's small enough."""
        if not self.enabled or len(content) > self.max_size:
            return
        with self.lock:
            self.cache[path] = content

    def size(self) -> int:
        """Get cache size in bytes."""
        with self.lock:
            return sum(len(v) for v in self.cache.values())

    def count(self) -> int:
        """Get number of cached files."""
        with self.lock:
            return len(self.cache)

# =============================================================================
# REQUEST HANDLER
# =============================================================================

class AirQRRequestHandler(SimpleHTTPRequestHandler):
    """Custom request handler with MIME types, security headers, and caching."""

    # Class variables (set by main)
    cache: FileCache = None
    verbose: bool = False

    def log_message(self, format, *args):
        """Override to control logging."""
        if self.verbose:
            super().log_message(format, *args)

    def end_headers(self):
        """Add security headers before ending response."""
        # Add COOP/COEP headers for SharedArrayBuffer
        for header, value in SECURITY_HEADERS.items():
            self.send_header(header, value)

        # Add cache control (no cache for now to ensure updates are visible)
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')

        super().end_headers()

    def guess_type(self, path):
        """Guess MIME type with our custom mappings."""
        ext = Path(path).suffix.lower()
        return MIME_TYPES.get(ext, 'application/octet-stream')

    def do_GET(self):
        """Handle GET requests with caching."""
        # Get the requested path
        path = self.translate_path(self.path)

        # Check cache first
        cached_content = self.cache.get(path) if self.cache else None

        if cached_content is not None:
            # Serve from cache
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Content-Length', str(len(cached_content)))
            self.end_headers()
            self.wfile.write(cached_content)
            return

        # Check if file exists
        if not os.path.exists(path):
            self.send_error(404, "File not found")
            return

        # Check if it's a directory (serve index.html)
        if os.path.isdir(path):
            index_path = os.path.join(path, 'index.html')
            if os.path.exists(index_path):
                path = index_path
            else:
                self.send_error(404, "index.html not found")
                return

        try:
            # Read file
            with open(path, 'rb') as f:
                content = f.read()

            # Cache if small enough
            if self.cache:
                self.cache.put(path, content)

            # Send response
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        except IOError:
            self.send_error(500, "Error reading file")

# =============================================================================
# SERVER
# =============================================================================

def open_browser(port: int):
    """Open browser after a short delay."""
    import time
    time.sleep(1)  # Wait for server to start
    url = f"http://localhost:{port}"
    print(f"\n  Opening {url} in browser...")
    webbrowser.open(url)

def run_server(port: int, no_browser: bool = False, no_cache: bool = False, verbose: bool = False):
    """Run the HTTP server."""

    # Set class variables
    AirQRRequestHandler.cache = FileCache(enabled=not no_cache)
    AirQRRequestHandler.verbose = verbose

    # Change to script directory
    script_dir = Path(__file__).parent.resolve()
    os.chdir(script_dir)

    # Create server
    try:
        server = ThreadingHTTPServer(('localhost', port), AirQRRequestHandler)
    except OSError as e:
        if e.errno == 10048 or e.errno == 48:  # Address already in use (Windows/Unix)
            print(f"\n  ERROR: Port {port} is already in use")
            print(f"  Try: python serve.py --port {port + 1}")
            return 1
        else:
            raise

    # Print info
    print("\n" + "=" * 60)
    print("  AirQR Web - Offline Server")
    print("=" * 60)
    print(f"\n  Server:  http://localhost:{port}")
    print(f"  Folder:  {script_dir}")
    print(f"  Cache:   {'Enabled' if not no_cache else 'Disabled'}")
    print(f"  Threads: Multi-threaded (ThreadingHTTPServer)")
    print("\n  Press Ctrl+C to stop")
    print("=" * 60 + "\n")

    # Open browser in background thread
    if not no_browser:
        threading.Thread(target=open_browser, args=(port,), daemon=True).start()

    # Run server
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\n  Shutting down server...")
        server.shutdown()

        # Print cache stats
        if not no_cache and AirQRRequestHandler.cache:
            cache = AirQRRequestHandler.cache
            cache_size_mb = cache.size() / 1024 / 1024
            print(f"  Cache: {cache.count()} files, {cache_size_mb:.1f}MB")

        print("  Server stopped\n")
        return 0

# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="AirQR Web offline HTTP server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=8080,
        help="Port to listen on (default: 8080)"
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't auto-open browser"
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Disable memory caching"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show HTTP request logs"
    )

    args = parser.parse_args()

    return run_server(
        port=args.port,
        no_browser=args.no_browser,
        no_cache=args.no_cache,
        verbose=args.verbose
    )

if __name__ == "__main__":
    sys.exit(main())
