# mcp-server

Travel MCP servers for the Bandobast agent, all served from **one Vercel deployment**.
Each server has its own endpoint: `https://<your-project>.vercel.app/<server>/mcp`

| Endpoint | Tools | Data source |
|---|---|---|
| `/flight-details/mcp` | `find_cheapest_flights`, `search_flights`, `find_flight_deals` | SerpApi Google Flights + Google Flights Deals |
| `/flight-deals/mcp` | `find_flight_deals` | SerpApi Google Flights Deals (same tool as above, also kept on its own endpoint) |
| `/hotel-details/mcp` | `find_hotel_deals`, `search_hotels` | SerpApi Google Hotels |
| `/hotel-reviews/mcp` | `get_hotel_reviews`, `get_hotel_review_highlights` | SerpApi Google Hotels Reviews |
| `/hotel-photos/mcp` | `get_hotel_photos` | SerpApi Google Hotels Photos |
| `/travel-explore/mcp` | `explore_destinations`, `find_best_value_destinations` | SerpApi Google Travel Explore |
| `/google-news/mcp` | `search_travel_news`, `check_travel_disruptions` | SerpApi Google News |
| `/tripadvisor-place/mcp` | `search_places`, `find_top_rated_places`, `get_place_details` | SerpApi Tripadvisor |
| `/tripadvisor-reviews/mcp` | `get_place_reviews`, `get_review_summary` | SerpApi Tripadvisor Place |
| `/pinelabs-payments/mcp` | `estimate_emi`, `get_emi_offers`, `create_payment_link`, `create_group_split_links`, `get_group_payment_status`, `get_payment_link_status` | Pine Labs Plural (UAT or prod) |
| `/weather-forecast/mcp` | `get_weather`, `get_current_weather`, `score_trip_weather`, `compare_destinations_weather` | Open-Meteo (no key) |

`GET /` returns this list as JSON. `GET /<server>/mcp` is a health check for that server.
Prices are in INR.

`/pinelabs-payments/mcp` needs `PINELABS_CLIENT_ID` and `PINELABS_CLIENT_SECRET` (and `PINELABS_ENV=uat|prod`). It only creates payment links; the traveler pays on Pine Labs' hosted page. In prod it refuses to run unless `MCP_AUTH_TOKEN` is set.

## Deploy

1. Import this repo at vercel.com/new (framework preset: **Other**, no build command).
2. Add the environment variables `SERPAPI_API_KEY`, `PINELABS_CLIENT_ID`, `PINELABS_CLIENT_SECRET` and `PINELABS_ENV`. Optionally add `MCP_AUTH_TOKEN` to require
   an `Authorization: Bearer <token>` header on every endpoint.
3. Deploy, then register each endpoint as its own MCP connector in AgenticOrg.

## Run locally

```
cp .env.example .env.local   # then add your SerpApi key
npm run dev                  # http://localhost:3000/<server>/mcp
npm test                     # calls every endpoint end to end (uses a few SerpApi credits)
```

## Layout

- `api/mcp.js` is the single serverless function; `vercel.json` rewrites `/<server>/mcp` to it.
- `lib/core.js` is the shared MCP protocol handling.
- `servers/<name>/tools.js` defines each server's tools. To add a server, create one and add it to `servers/index.js`.
