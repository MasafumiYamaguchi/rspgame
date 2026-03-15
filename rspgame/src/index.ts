import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";

export class Match extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request) {
    return new Response("Hello from Match DO!");
  }
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get("/match", async (c) => {
  const id = c.env.MATCH.idFromName("match");
  const stub = c.env.MATCH.get(id);
  return stub.fetch("http://example.com/match");
});

export default app;
