// End-to-end check: starts the combined server and calls every endpoint over HTTP.
const http = require("http");
const handler = require("./api/mcp");

const server = http.createServer((req, res) => {
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (o) => (res.setHeader("Content-Type", "application/json"), res.end(JSON.stringify(o)));
  handler(req, res);
});

const rpc = async (base, path, method, params, id = 1) => {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: r.status, body: await r.json() };
};

const tomorrow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// One representative live call per server.
const CALLS = {
  "flight-details": ["find_cheapest_flights", { departure_id: "DEL", arrival_id: "GOI", outbound_date: tomorrow(14), stops: 1, limit: 2 }],
  "flight-deals": ["find_flight_deals", { departure_id: "DEL", limit: 2 }],
  "hotel-details": ["find_hotel_deals", { query: "hotels in Goa", check_in_date: tomorrow(14), check_out_date: tomorrow(16), limit: 2 }],
  "hotel-reviews": ["get_hotel_reviews", { hotel_query: "Radisson Blu Resort Goa Cavelossim Beach", limit: 2 }],
  "hotel-photos": ["get_hotel_photos", { hotel_query: "Radisson Blu Resort Goa Cavelossim Beach", category: "Bedroom", photos_per_category: 1 }],
  "travel-explore": ["find_best_value_destinations", { departure_id: "DEL", outbound_date: tomorrow(14), return_date: tomorrow(17), limit: 2 }],
  "google-news": ["search_travel_news", { query: "Goa tourism", limit: 2 }],
  "tripadvisor-place": ["find_top_rated_places", { query: "beaches in Goa", limit: 2 }],
  "tripadvisor-reviews": ["get_review_summary", { place_id: "8519463" }],
  "weather-forecast": ["score_trip_weather", { location: "Goa", start_date: tomorrow(3), end_date: tomorrow(5) }],
};

server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  let failed = 0;
  const check = (label, ok, extra = "") => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  };

  const idx = await (await fetch(base + "/")).json();
  check("index lists servers", idx.servers?.length === 10, `${idx.servers?.length} servers`);

  const unknown = await fetch(base + "/nope/mcp", { method: "POST", body: "{}" });
  check("unknown server -> 404", unknown.status === 404);

  for (const s of idx.servers) {
    const name = s.name;
    const path = `/${name}/mcp`;
    const health = await (await fetch(base + path)).json();
    const init = await rpc(base, path, "initialize", {});
    const list = await rpc(base, path, "tools/list");
    const names = list.body.result?.tools?.map((t) => t.name) || [];
    check(`${name}: health + initialize + tools/list`, health.status === "ok" && init.body.result?.serverInfo && names.length > 0, names.join(", "));

    const [tool, args] = CALLS[name];
    const t0 = Date.now();
    const call = await rpc(base, path, "tools/call", { name: tool, arguments: args });
    const res = call.body.result;
    const text = res?.content?.[0]?.text || "";
    check(`${name}: ${tool}`, res && !res.isError, res?.isError ? text.slice(0, 160) : `${text.length} chars in ${Date.now() - t0}ms`);
  }

  const missing = await rpc(base, "/flight-details/mcp", "tools/call", { name: "find_cheapest_flights", arguments: {} });
  check("missing args -> tool error", missing.body.result?.isError === true, missing.body.result?.content?.[0]?.text);
  const badDate = await rpc(base, "/flight-details/mcp", "tools/call", {
    name: "find_cheapest_flights", arguments: { departure_id: "DEL", arrival_id: "GOI", outbound_date: "10-10-2026" },
  });
  check("ported validation -> tool error", badDate.body.result?.isError === true, badDate.body.result?.content?.[0]?.text);

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  server.close();
  process.exit(failed ? 1 : 0);
});
