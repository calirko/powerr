import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/status": "http://localhost:3050",
      "/power": "http://localhost:3050",
      "/logs": "http://localhost:3050",
      "/login": {
        target: "http://localhost:3050",
        // Page loads of /login must get Vite's index.html; only the POST goes to the server.
        bypass: (req) => (req.method === "GET" ? "/index.html" : undefined),
      },
      "/ws": { target: "ws://localhost:3050", ws: true },
    },
  },
});
