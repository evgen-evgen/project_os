const http = require("node:http");
const fs= require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || "./data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function safeName(title, fallback) {
  const cleaned = String(title || "")
    .replace(/[/\\?%*:|"<>#^~\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function projectMarkdown(p) {
  const tasks = (p.milestones || []).flatMap((m) => m.tasks || []);
  const done = tasks.filter((t) => t.done).length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const next = tasks.find((t) => t.isNext && !t.done);

  const lines = [
    "---",
    `title: ${JSON.stringify(p.title || "Untitled project")}`,
    `status: ${p.status || "active"}`,
    `progress: ${progress}`,
    next ? `next: ${JSON.stringify(next.title)}` : "next: null",
    "---",
    "",
    `# ${p.title || "Untitled project"}`,
    "",
    p.description ? `_${p.description}_` : "",
    "",
    next ? `> **NEXT:** ${next.title}` : "> NEXT не задан",
    "",
  ];

  for (const m of p.milestones || []) {
    lines.push(`## ${m.title}`, "");
    for (const t of m.tasks || []) {
      const box = t.done ? "x" : " ";
      const mark = t.isNext && !t.done ? " **#next**" : "";
      lines.push(`- [${box}] ${t.title}${mark}`);
      if (t.notes) {
        for (const line of String(t.notes).split(/\r?\n/)) lines.push(`  ${line}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function inboxMarkdown(inbox) {
  const lines = ["---", "title: Inbox", "tags: [inbox]", "---", "", "# Inbox", ""];
  for (const item of inbox || []) lines.push(`- ${item.text}`);
  return lines.join("\n") + "\n";
}

function writeMarkdown(state) {
  const wanted = new Map();
  const used = new Set();
  for (const p of state.projects || []) {
    let name = safeName(p.title, "Untitled project");
    while (used.has(name.toLowerCase())) name += " _";
    used.add(name.toLowerCase());
    wanted.set(`${name}.md`, projectMarkdown(p));
  }
  wanted.set("Inbox.md", inboxMarkdown(state.inbox));

  for (const [file, content] of wanted) {
    fs.writeFileSync(path.join(DATA_DIR, file), content, "utf-8");
  }
  // remove stale project files (renamed/deleted projects)
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (f.endsWith(".md") && !wanted.has(f)) fs.unlinkSync(path.join(DATA_DIR, f));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/state") {
      if (!fs.existsSync(STATE_FILE)) return sendJson(res, 404, { error: "no data yet" });
      return sendJson(res, 200, JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")));
    }

    if (req.method === "PUT" && req.url === "/api/state") {
      const raw = await readBody(req);
      const state = JSON.parse(raw);
      if (!Array.isArray(state.projects) || !Array.isArray(state.inbox)) {
        return sendJson(res, 400, { error: "invalid state" });
      }
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = STATE_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
      fs.renameSync(tmp, STATE_FILE);
      try {
        writeMarkdown(state);
      } catch (e) {
        console.error("markdown sync failed:", e.message);
      }
      return sendJson(res, 200, { ok: true });
    }

    const urlPath = req.url.split("?")[0];
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      return res.end(fs.readFileSync(file));
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

fs.mkdirSync(DATA_DIR, { recursive: true });
server.listen(PORT, () => console.log(`project-os listening on :${PORT}, data in ${DATA_DIR}`));
