// THE single place that reads Workers-vs-Node runtime secrets, mirroring
// src/db/db.ts's "one isolated connection file" discipline for the other
// place this app touches host-specific runtime access: secrets.
//
// getCloudflareContext() (from @opennextjs/cloudflare) only resolves
// inside the actual Cloudflare Workers runtime — calling it anywhere else
// (a plain Node host, or `next build`/`next start` outside Workers)
// throws. Found by the Phase 6.5 Railway portability spike
// (RAILWAY_DEPLOY.md): ten files called getCloudflareContext() directly
// for secrets, none of them portable, each hitting that exact throw on a
// real Railway deploy. This generalizes the fix to one file instead of
// ten separate ad-hoc casts.
//
// Every secret this app reads through getCloudflareContext() is a plain
// string (Workers Secret or var), never a binding object — R2 and the
// database each already have their own portable access pattern (R2's
// S3-compatible API, db.ts's connection file), so a plain process.env
// fallback is a faithful substitute on non-Workers hosts: set the same
// secret names as real environment variables there.
export async function getRuntimeEnv<T>(): Promise<T> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    return env as unknown as T;
  } catch {
    return process.env as unknown as T;
  }
}

// Workers-only background-work primitive: ctx.waitUntil(promise) tells
// the runtime to keep the isolate alive until `promise` settles, even
// after the response has been sent. A standard Node process has no
// equivalent concept — nothing tears the process down after a response,
// so the async work can just run un-awaited; the process survives to
// finish it on its own. On Workers, skipping ctx.waitUntil would risk the
// isolate being torn down mid-task, so the two hosts genuinely need
// different handling here, not just a fallback value.
export async function runInBackground(task: () => Promise<void>): Promise<void> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(task());
  } catch {
    void task();
  }
}
