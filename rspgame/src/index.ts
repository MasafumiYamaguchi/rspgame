import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";

export class Match extends DurableObject {
  WaitingSocket: WebSocket | null = null;
  pairs: Map<WebSocket, WebSocket> = new Map();
  moves: Map<WebSocket, string> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketOpen(socket: WebSocket) {
    const opponent = this.WaitingSocket;
    if (opponent) {
      this.WaitingSocket = null;
      this.pairs.set(socket, opponent);
      this.pairs.set(opponent, socket);
      opponent.send("match");
      socket.send("match");
    } else {
      this.WaitingSocket = socket;
      socket.send("waiting");
    }
  }

  async webSocketMessage(socket: WebSocket, message: string) {
    if (socket === this.WaitingSocket) {
      // Ignore messages from the waiting socket
      return;
    }
    if (message === `rock` || message === `paper` || message === `scissors`) {
      if (this.pairs.has(socket)) {
        const opponentMove = message;
        this.moves.set(socket, message);
        const opponent = this.pairs.get(socket);
        if (!this.moves.has(opponent!)) {
          // Opponent hasn't made a move yet
          socket.send("waiting");
          return;
        }
        const playerMove =
          this.WaitingSocket === socket ? opponentMove : message;
        const resultforme = this.determineWinner(playerMove, opponentMove);
        const resultforopponent = this.determineWinner(
          opponentMove,
          playerMove,
        );
        if (resultforme === "win") {
          this.moves.set(socket, "win");
          this.moves.set(opponent!, "lose");
        } else if (resultforme === "lose") {
          this.moves.set(socket, "lose");
          this.moves.set(opponent!, "win");
        } else {
          this.moves.set(socket, "draw");
          this.moves.set(opponent!, "draw");
        }
        this.pairs.get(socket)!.send(resultforme);
        this.pairs.get(socket)!.send(resultforopponent);
        this.pairs.delete(socket);
        this.moves.delete(socket);
      }
    }
  }

  async webSocketClose(socket: WebSocket) {
    if (socket === this.WaitingSocket) {
      this.WaitingSocket = null;
    }
    if (this.pairs.get(socket)) {
      const opponent = this.pairs.get(socket)!;
      opponent.send("opponent_left");
      this.pairs.delete(opponent);
    }
    this.pairs.delete(socket);
    this.moves.delete(socket);
  }

  determineWinner(playerMove: string, opponentMove: string): string {
    if (playerMove === opponentMove) {
      return "draw";
    }
    if (
      (playerMove === "rock" && opponentMove === "scissors") ||
      (playerMove === "paper" && opponentMove === "rock") ||
      (playerMove === "scissors" && opponentMove === "paper")
    ) {
      return "win";
    }
    return "lose";
  }
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text("Hello, World!");
});

app.get("/match", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }
  const env = c.env;
  const id = env.MATCH.idFromName("match");
  const stub = env.MATCH.get(id);
  const request = c.req.raw;
  const response = await stub.fetch(request);
  return response;
});

export default app;
