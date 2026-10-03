import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import netlify from "@netlify/vite-plugin";

/**
 * Serves /api/* from the Hono app inside the Vite dev server. The Netlify functions emulator re-bundles
 * functions per request, which breaks the embedded PGlite database; in production the same app runs in
 * netlify/functions/api.mts.
 */
function apiDevPlugin(): Plugin {
  return {
    name: "land-finder-api-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (url !== "/api" && !url.startsWith("/api/")) return next();
        try {
          const mod = (await server.ssrLoadModule("/server/api/dev-entry.ts")) as { handle: (r: Request) => Promise<Response> };
          const { getRequestListener } = await import("@hono/node-server");
          await getRequestListener(mod.handle)(req, res);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // The Netlify plugin emulates /api/* functions, redirects, headers and env vars during `vite dev`.
  // Edge functions, blobs, image CDN, geolocation and Netlify Database are not used (edge emulation needs Deno).
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === "test"
      ? []
      : [
          apiDevPlugin(),
          netlify({
            functions: { enabled: false },
            edgeFunctions: { enabled: false },
            blobs: { enabled: false },
            database: { enabled: false },
            images: { enabled: false },
            geolocation: { enabled: false },
          }),
        ]),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  server: {
    // PGlite writes its data files here; they must not trigger rebuilds.
    watch: { ignored: ["**/.data/**", "**/.netlify/**"] },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
}));
