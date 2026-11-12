#!/usr/bin/env python3
"""
Simple HTTP server to serve gzipped HTML files with proper Content-Encoding header.
Usage: python serve_gz.py [port]
"""

import http.server
import socketserver
import sys
import os
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class GzipHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler that serves .gz files with Content-Encoding: gzip"""

    def end_headers(self):
        # Add CORS headers for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_GET(self):
        # If requesting a .html file, check if compressed versions exist
        if self.path.endswith('.html') or self.path == '/':
            if self.path == '/':
                # List available HTML files
                html_files = list(Path('.').glob('**/*.html'))
                gz_files = list(Path('.').glob('**/*.html.gz'))
                br_files = list(Path('.').glob('**/*.html.br'))

                response = '<html><head><title>AirQR SVG Viewer</title></head><body>'
                response += '<h1>Available AirQR Animated SVGs</h1>'

                if html_files or gz_files or br_files:
                    response += '<h2>HTML Files (uncompressed)</h2><ul>'
                    for f in html_files:
                        response += f'<li><a href="/{f}">{f}</a></li>'
                    response += '</ul>'

                    response += '<h2>Gzipped Files</h2><ul>'
                    for f in gz_files:
                        response += f'<li><a href="/{f}">{f}</a></li>'
                    response += '</ul>'

                    response += '<h2>Brotli Files (best compression)</h2><ul>'
                    for f in br_files:
                        response += f'<li><a href="/{f}">{f}</a></li>'
                    response += '</ul>'
                else:
                    response += '<p>No AirQR files found. Run encode_svg first.</p>'

                response += '</body></html>'

                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Content-Length', len(response))
                self.end_headers()
                self.wfile.write(response.encode())
                return

            # Try to serve .html.br first (best compression), then .html.gz
            br_path = self.path[1:] + '.br'  # Remove leading /
            gz_path = self.path[1:] + '.gz'
            if os.path.exists(br_path):
                self.path = '/' + br_path
            elif os.path.exists(gz_path):
                self.path = '/' + gz_path

        # If requesting .html.br, serve with brotli encoding
        if self.path.endswith('.html.br'):
            file_path = self.path[1:]  # Remove leading /
            if os.path.exists(file_path):
                with open(file_path, 'rb') as f:
                    content = f.read()

                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Encoding', 'br')
                self.send_header('Content-Length', len(content))
                self.end_headers()
                self.wfile.write(content)
                return

        # If requesting .html.gz, serve with gzip encoding
        if self.path.endswith('.html.gz'):
            file_path = self.path[1:]  # Remove leading /
            if os.path.exists(file_path):
                with open(file_path, 'rb') as f:
                    content = f.read()

                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Encoding', 'gzip')
                self.send_header('Content-Length', len(content))
                self.end_headers()
                self.wfile.write(content)
                return

        # Default behavior for other files
        super().do_GET()

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), GzipHTTPRequestHandler) as httpd:
        print(f"🌐 AirQR SVG Server running at http://localhost:{PORT}/")
        print(f"📁 Serving from: {os.getcwd()}")
        print(f"\n💡 Tip: Files with .html.gz extension are served with gzip compression")
        print(f"   This reduces transfer size by ~70%!")
        print(f"\n🛑 Press Ctrl+C to stop\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n👋 Server stopped")
            sys.exit(0)
