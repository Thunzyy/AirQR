/// <reference types="vitest" />
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import {
  configureSyncHttpProxy,
  configureSyncWebSocketProxy,
  resolveSyncProxyTargets,
} from "./vite.syncProxy";

const certPath =
  process.env.VITE_SSL_CERT ||
  path.resolve(__dirname, "..", "..", "localhost+2.pem");
const keyPath =
  process.env.VITE_SSL_KEY ||
  path.resolve(__dirname, "..", "..", "localhost+2-key.pem");
const hasCustomCert = fs.existsSync(certPath) && fs.existsSync(keyPath);
const httpsConfig = hasCustomCert
  ? {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    }
  : undefined;
const {
  syncServerTarget: syncServerApiProxyTarget,
  syncServerWsTarget: syncServerEventsWsProxyTarget,
} = resolveSyncProxyTargets(process.env);
const proxyAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: false,
});

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@web": path.resolve(__dirname, "src"),
    },
  },
  plugins: [
    react(),
    ...(hasCustomCert ? [] : [basicSsl()]),
    wasm(),
    topLevelAwait(),
  ],
  server: {
    host: true, // Listen on all local IPs
    allowedHosts: true, // Allow all hosts (required for ngrok)
    https: httpsConfig,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      // Browser clients stay same-origin in dev. The proxy defaults to the explicit
      // local split listeners (8081 API / 8082 WS), but an explicit
      // VITE_SYNC_SERVER_URL without a WS override is treated as a same-origin target.
      "/api/v1/ws": {
        target: syncServerEventsWsProxyTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
        configure: configureSyncWebSocketProxy,
      },
      "/api/ws": {
        target: syncServerEventsWsProxyTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
        configure: configureSyncWebSocketProxy,
      },
      // Proxy API requests to the internal sync-server HTTP listener.
      "/api": {
        target: syncServerApiProxyTarget,
        changeOrigin: false,
        secure: false,
        xfwd: true,
        configure: configureSyncHttpProxy,
        agent: syncServerApiProxyTarget.startsWith("https://") ? proxyAgent : undefined,
      },
      // Keep operational probes on the same trusted browser origin too. The
      // connection flow uses these paths to distinguish AirQR from another
      // process that may have claimed the configured local port.
      "/health": {
        target: syncServerApiProxyTarget,
        changeOrigin: false,
        secure: false,
        xfwd: true,
        configure: configureSyncHttpProxy,
        agent: syncServerApiProxyTarget.startsWith("https://") ? proxyAgent : undefined,
      },
      "/ready": {
        target: syncServerApiProxyTarget,
        changeOrigin: false,
        secure: false,
        xfwd: true,
        configure: configureSyncHttpProxy,
        agent: syncServerApiProxyTarget.startsWith("https://") ? proxyAgent : undefined,
      },
      "/version": {
        target: syncServerApiProxyTarget,
        changeOrigin: false,
        secure: false,
        xfwd: true,
        configure: configureSyncHttpProxy,
        agent: syncServerApiProxyTarget.startsWith("https://") ? proxyAgent : undefined,
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    https: httpsConfig,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'wouter', 'zustand'],
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          encoder: ['omggif', 'fflate'],
        },
      },
    },
  },
  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
  optimizeDeps: {
    exclude: ["zxing-wasm"],
  },
});
