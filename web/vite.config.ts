import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";

const REPO = path.resolve(__dirname, "..");
const ROSTER = path.join(REPO, "data/roster.json");
const CHARS_DIR = path.join(__dirname, "public/chars");

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/* ローカル個人アプリ用API。dev/preview サーバ内で完結し、追加プロセス不要。
   - GET/PUT /api/roster : data/roster.json の読み書き（リポジトリ管理＝Claudeと共有）
   - POST /api/image?key= : public/chars/ に画像保存（gitignore、ローカル専用）
   - POST /api/sync       : roster.json を git commit & push */
function localApi(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || "/", "http://localhost");
    try {
      if (url.pathname === "/api/roster") {
        if (req.method === "GET") {
          if (!fs.existsSync(ROSTER)) return json(res, 200, { sync: 60, bar: 3, chars: {} });
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(fs.readFileSync(ROSTER));
        }
        if (req.method === "PUT") {
          const body = JSON.parse((await readBody(req)).toString("utf-8"));
          if (!body || typeof body.chars !== "object") return json(res, 400, { error: "invalid roster" });
          fs.mkdirSync(path.dirname(ROSTER), { recursive: true });
          fs.writeFileSync(ROSTER, JSON.stringify(body, null, 1) + "\n");
          return json(res, 200, { ok: true });
        }
      }
      if (url.pathname === "/api/image" && req.method === "POST") {
        const key = url.searchParams.get("key");
        if (!key) return json(res, 400, { error: "key required" });
        const buf = await readBody(req);
        if (buf.length > 5_000_000) return json(res, 400, { error: "5MBまで" });
        const name = Buffer.from(key).toString("base64url");
        fs.mkdirSync(CHARS_DIR, { recursive: true });
        fs.writeFileSync(path.join(CHARS_DIR, name + ".png"), buf);
        return json(res, 200, { ok: true, url: `/chars/${name}.png` });
      }
      if (url.pathname === "/api/sync" && req.method === "POST") {
        const git = (...args: string[]) =>
          execFileSync("git", args, { cwd: REPO, encoding: "utf-8" });
        git("add", "data/roster.json");
        const status = git("status", "--porcelain", "data/roster.json").trim();
        if (status) git("commit", "-m", "ロスター更新（アプリから同期）");
        let pushed = false, error = "";
        try { git("push"); pushed = true; }
        catch (e: any) { error = String(e.stderr || e.message || e); }
        return json(res, 200, { ok: pushed, committed: !!status, error });
      }
      next();
    } catch (e: any) {
      json(res, 500, { error: String(e?.message || e) });
    }
  };
  return {
    name: "local-api",
    configureServer(server: ViteDevServer) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

// base "./" なので GitHub Pages のサブパス・file://・Artifact のどこでも動く
export default defineConfig({
  base: "./",
  plugins: process.env.SINGLE ? [viteSingleFile()] : [localApi()],
});
