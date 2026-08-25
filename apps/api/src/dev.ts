import { serve } from "@hono/node-server";
import app from "./server.js";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`DispatchLoop API listening on http://127.0.0.1:${port}`);
