import type { APIRoute } from "astro";

export const prerender = false;

/* Packaged Mac app object in the ICONS R2 bucket. Packaging bumps this
   version string (and re-uploads the object under the new key) each time a
   new build ships - nothing else in this route needs to change. */
const DMG_VERSION = "0.1.0";
const DMG_KEY = `desktop/Motificons-${DMG_VERSION}.dmg`;

/** The narrow slice of the R2 binding this route touches, typed locally the
    same way lib/storage.ts and db/client.ts type theirs - this project does
    not depend on @cloudflare/workers-types. `body` is the ReadableStream
    streamed straight into the Response below; nothing here buffers it. */
interface IconsEnv {
  ICONS?: {
    get(key: string): Promise<{ body: ReadableStream } | null>;
  };
}

/**
 * Public Mac app download, streamed from R2 (dashboard.astro's "Mac app"
 * section links here). No gate of any kind: the Mac app is free, so an
 * anonymous visitor who lands on this URL gets the disk image, same as a
 * signed-in one.
 */
export const GET: APIRoute = async () => {
  const { env } = (await import("cloudflare:workers")) as unknown as {
    env: IconsEnv;
  };

  const object = await env.ICONS?.get(DMG_KEY);
  if (!object) {
    return new Response(
      JSON.stringify({
        error: "The download is being prepared - try again in a few minutes.",
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      },
    );
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/x-apple-diskimage",
      "Content-Disposition": `attachment; filename="Motificons-${DMG_VERSION}.dmg"`,
      /* Same object for every visitor now that nothing here is per-session,
         but the DMG_KEY changes with each packaged version, so a short
         shared cache is safe and a stale build is never pinned. */
      "Cache-Control": "public, max-age=3600",
    },
  });
};
