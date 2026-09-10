// Worker entrypoint. Wraps OpenNext's generated worker to add a `scheduled`
// handler for Cloudflare Cron Triggers — OpenNext only generates a `fetch`
// handler, and there is no hook in `open-next.config.ts` to add one, so
// wrangler's `main` points here and this delegates every request straight
// through. `opennextjs-cloudflare deploy` shells out to `wrangler deploy`
// without overriding `main`, so this is respected on deploy.
//
// Deliberately JavaScript, not TypeScript: `.open-next/worker.js` is build
// output that does not exist in a fresh checkout, and CI runs `typecheck`
// before `build:worker`. tsconfig's `include` covers .ts/.tsx/.mts but not
// .js, so a .js entry keeps that import out of tsc's way. The logic worth
// checking lives in src/lib/cron-routes.ts, which is typed and covered by
// scripts/check-cron-triggers-wired.mjs.

import openNextWorker from "./.open-next/worker.js";
import { cronRouteFor } from "./src/lib/cron-routes";

// OpenNext's Durable Objects have to stay exported from the deployed entry
// or their bindings resolve to nothing at runtime.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default {
  fetch(request, env, ctx) {
    return openNextWorker.fetch(request, env, ctx);
  },

  // Cron jobs run through their existing /api/cron/* route handlers rather
  // than calling the job libraries directly: those routes already carry the
  // shared-secret auth and error handling, they stay independently callable
  // for a manual run, and this keeps one code path per job instead of two
  // that can drift. The request is built and consumed inside this
  // invocation, so it never crosses a request context.
  async scheduled(controller, env, ctx) {
    const path = cronRouteFor(controller.cron);

    if (!path) {
      // Unreachable while check-cron-triggers-wired.mjs passes in CI; if it
      // ever happens, a trigger is firing into nothing and silence is the
      // worst outcome.
      console.error(
        JSON.stringify({ message: "cron trigger has no mapped route", cron: controller.cron }),
      );
      return;
    }

    const request = new Request(new URL(path, env.NEXT_PUBLIC_SITE_URL), {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET ?? ""}` },
    });

    const response = await openNextWorker.fetch(request, env, ctx);

    if (!response.ok) {
      // Logged, not thrown: each job's own heartbeat is what the liveness
      // check alerts on, and a job that fails leaves its heartbeat stale by
      // design. This line is for reading the reason afterwards in Workers
      // logs.
      const body = await response.text().catch(() => "");
      console.error(
        JSON.stringify({
          message: "cron route returned an error",
          cron: controller.cron,
          path,
          status: response.status,
          body: body.slice(0, 500),
        }),
      );
    }
  },
};
