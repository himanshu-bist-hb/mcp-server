// Single Vercel function serving every MCP server.
//   POST /<server>/mcp   -> that server's MCP endpoint (rewritten to /api/mcp?server=<server>)
//   GET  /               -> index of available servers
const registry = require("../servers");
const { serve, setCors } = require("../lib/core");

function serverNameFrom(req) {
  const url = new URL(req.url, "http://localhost");
  const q = url.searchParams.get("server");
  if (q) return q;
  const m = url.pathname.match(/^\/([^/]+)\/mcp\/?$/);
  return m ? m[1] : null;
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const token = process.env.MCP_AUTH_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const name = serverNameFrom(req);

  if (!name) {
    const proto = req.headers["x-forwarded-proto"] || "http";
    const base = req.headers.host ? `${proto}://${req.headers.host}` : "";
    return res.status(200).json({
      name: "mcp-server",
      status: "ok",
      servers: Object.entries(registry).map(([key, s]) => ({
        name: key,
        endpoint: `${base}/${key}/mcp`,
        summary: s.summary,
      })),
    });
  }

  const entry = registry[name];
  if (!entry) {
    return res.status(404).json({ error: `Unknown server "${name}"`, available: Object.keys(registry) });
  }
  return serve(entry.load(), req, res);
};
