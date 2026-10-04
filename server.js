// Local dev server: npm run dev  ->  http://localhost:3000/<server>/mcp
const http = require("http");
const handler = require("./api/mcp");

http
  .createServer((req, res) => {
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (o) => (res.setHeader("Content-Type", "application/json"), res.end(JSON.stringify(o)));
    handler(req, res);
  })
  .listen(3000, () => console.log("MCP servers on http://localhost:3000  (index at /)"));
