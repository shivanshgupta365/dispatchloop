import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_"],
  // Tauri's bundled WebView2 / WKWebView supports modern ECMAScript; a single
  // target avoids esbuild attempting unsupported downlevel transforms.
  build: { target: "es2022" }
});
