import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";

export class Match extends DurableObject {
  // 待機中のソケット
  WaitingSocket: WebSocket | null = null;
  // 待機中のプレイヤーID
  waitingPlayerId: string | null = null;
  // プレイヤーIDから対戦相手のプレイヤーIDを取得するマップ
  opponentByPlayer = new Map<string | null, string | null>();
  // プレイヤーIDから出した手を取得するマップ
  movesByPlayer = new Map<string | null, string | null>();
  // ソケットIDのカウンタ
  nextSocketId = 1;

  // プレイヤーIDを取得するヘルパ
  private playerIdOf(socket: WebSocket): string | null {
    const tag = this.ctx.getTags(socket).find((t) => t.startsWith("player:"));
    return tag ? tag.slice("player:".length) : null;
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request) {
    // ここでWebSocket接続以外を弾く
    console.log("[fetch] upgrade=", request.headers.get("Upgrade"));
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    // ペアの準備
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // プレイヤーIDの設定とWebSocketの承認
    const myId = "p" + this.nextSocketId++;
    this.ctx.acceptWebSocket(server, ["player:" + myId]);
    // 待機列から相手を選んでマップにセット
    const opponentId = this.waitingPlayerId;
    if (opponentId) {
      this.waitingPlayerId = null;
      this.opponentByPlayer.set(myId, opponentId);
      this.opponentByPlayer.set(opponentId, myId);
      // マッチが確定したらログ表示
      console.log("[match] " + myId + " vs " + opponentId);
      server.send("match");

      const oppSocket = this.ctx.getWebSockets("player:" + opponentId)[0];
      if (oppSocket) oppSocket.send("match");
    } else {
      // 待機列に並ぶ
      this.waitingPlayerId = myId;
      console.log("[waiting] " + myId);
      server.send("waiting");
    }
    // 接続したぜヒャッハー！！！
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string) {
    // 私はだぁれ。そして手札を表示
    const me = this.playerIdOf(socket);
    console.log("[move] " + me + " -> " + message);

    // 相手のWebSocketをIDで取得
    const opponent = this.ctx.getWebSockets(
      "player:" + this.opponentByPlayer.get(me!),
    )[0];
    console.log(
      "[move] opponent=",
      opponent ? this.playerIdOf(opponent) : "none",
    );
    if (!opponent) return; // 誰もいなかったら何もしない

    // 送られてきた内容がじゃんけんの手だったらじゃんけんの処理
    if (message === "rock" || message === "paper" || message === "scissors") {
      this.movesByPlayer.set(me, message);
      const opponentMove = this.movesByPlayer.get(this.playerIdOf(opponent));
      if (!opponentMove) {
        socket.send("waiting_opponent_move");
        return;
      }
      // idで表示するために一旦準備
      const opp = this.playerIdOf(opponent);
      const resultForMe = this.determineWinner(message, opponentMove);
      const resultForOpponent = this.determineWinner(opponentMove, message);
      console.log(
        "[result] " +
          me +
          "=" +
          resultForMe +
          ", " +
          opp +
          "=" +
          resultForOpponent,
      );
      // 結果を両者に送る
      socket.send(resultForMe);
      opponent.send(resultForOpponent);

      // マップをリセツト
      this.movesByPlayer.delete(me);
      this.movesByPlayer.delete(this.playerIdOf(opponent));
      this.opponentByPlayer.delete(me);
      this.opponentByPlayer.delete(this.playerIdOf(opponent));
    }
  }

  // 切断処理
  async webSocketClose(socket: WebSocket) {
    // 私はだぁれ。そしてログ表示
    const me = this.playerIdOf(socket);
    console.log("[close] " + me);

    // 自分が待ち列にいたらクリアしとく
    if (socket === this.WaitingSocket) {
      this.WaitingSocket = null;
    }
    // 相手のソケットをゲッツ
    const opponent = this.ctx.getWebSockets(
      "player:" + this.opponentByPlayer.get(me!),
    )[0];
    // 相手がいたら抜けるぜベイビと言う
    if (opponent) {
      console.log("[close] notify opponent " + this.playerIdOf(opponent));
      opponent.send("opponent_left");
      this.opponentByPlayer.delete(me);
      this.opponentByPlayer.delete(this.playerIdOf(opponent));
    }
  }

  // 勝ち負けの処理
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

// いきなりWebSocketつなごうとすると詰められるので普通のHTTPを用意
app.get("/", (c) => {
  return c.text("Hello, World!");
});

// WebSocket用のパス
app.get("/match", async (c) => {
  // Codexくんがheaderを小文字にしておくと漏れながなくなると言うのでそうしておく
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }
  // ここらへんはwranglerのもろもろ
  const env = c.env;
  const id = env.MATCH.idFromName("match");
  const stub = env.MATCH.get(id);
  const request = c.req.raw;
  const response = await stub.fetch(request);
  return response;
});

export default app;
