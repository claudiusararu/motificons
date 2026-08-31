import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, normalize } from "node:path";

/* Structurally typed rather than imported from vite: this file is config, not
   app code, and the app tsconfig does not resolve vite's types. */
interface DevServer {
  middlewares: {
    use(path: string, handler: DevHandler): void;
  };
}
type DevHandler = (request: IncomingMessage, response: ServerResponse) => void;

/**
 * Serves pipeline/dist over HTTP during development.
 *
 * `astro dev` runs the app in workerd, which has no real filesystem, so a
 * node:fs dev driver is not an option. Rather than publishing 421MB into
 * miniflare's local R2 before anyone can run the site, the dev server exposes
 * the pipeline output at /__data/* with Range support - the same shape R2
 * gives us in production, so the storage driver's two implementations differ
 * only in transport.
 *
 * Development only: the plugin declares `apply: "serve"`, so none of this
 * exists in a build.
 */
export function devDataPlugin(dataDir: string, port: number) {
  return {
    name: "motificons-dev-data",
    apply: "serve" as const,

    config() {
      return {
        define: {
          __DEV_DATA_ORIGIN__: JSON.stringify(`http://127.0.0.1:${port}`),
          /* Separate from the data origin above on purpose: that one is an
             internal server-to-self fetch (storage-dev.ts), where 127.0.0.1
             avoids any localhost-resolution ambiguity. This one is handed to
             Better Auth as `baseURL` (lib/auth/dev-origin.ts), which has to
             match whatever origin the visitor's actual browser used to load
             the page - and "localhost" is the address everyone actually
             types, so it is the one Origin headers arrive with. */
          __DEV_APP_ORIGIN__: JSON.stringify(`http://localhost:${port}`),
        },
      };
    },

    configureServer(server: DevServer) {
      server.middlewares.use("/__data", (request, response) => {
        const rawPath = (request.url ?? "").split("?")[0] ?? "";
        const key = decodeURIComponent(rawPath).replace(/^\/+/, "");

        /* The key reaches the filesystem, so anything that could climb out of
           the data directory is refused before it gets there. */
        const target = normalize(join(dataDir, key));
        if (!target.startsWith(normalize(dataDir)) || key.includes("..")) {
          response.statusCode = 403;
          response.end("Forbidden");
          return;
        }

        let size: number;
        try {
          size = statSync(target).size;
        } catch {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }

        const range = /bytes=(\d+)-(\d+)/.exec(request.headers.range ?? "");
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(Number(range[2]), size - 1);
          response.statusCode = 206;
          response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          createReadStream(target, { start, end }).pipe(response);
          return;
        }

        response.statusCode = 200;
        createReadStream(target).pipe(response);
      });
    },
  };
}
