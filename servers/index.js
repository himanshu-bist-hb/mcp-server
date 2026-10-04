// Registry of every MCP server. The key is the URL segment: /<key>/mcp
module.exports = {
  "flight-details": { load: () => require("./flight-details/tools"), summary: "Search flights and find the cheapest fares (Google Flights)" },
  "flight-deals": { load: () => require("./flight-deals/tools"), summary: "Currently discounted round-trip flight deals (Google Flights Deals)" },
  "hotel-details": { load: () => require("./hotel-details/tools"), summary: "Hotel search and hotel deals (Google Hotels)" },
  "hotel-reviews": { load: () => require("./hotel-reviews/tools"), summary: "Hotel guest reviews and review highlights (Google Hotels Reviews)" },
  "hotel-photos": { load: () => require("./hotel-photos/tools"), summary: "Hotel photos by category (Google Hotels Photos)" },
  "travel-explore": { load: () => require("./travel-explore/tools"), summary: "Where to travel for given dates, with flight and hotel prices (Google Travel Explore)" },
  "google-news": { load: () => require("./google-news/tools"), summary: "Travel news and disruption alerts (Google News)" },
  "tripadvisor-place": { load: () => require("./tripadvisor-place/tools"), summary: "Tripadvisor attractions, restaurants and hotels" },
  "tripadvisor-reviews": { load: () => require("./tripadvisor-reviews/tools"), summary: "Tripadvisor reviews and review summaries" },
  "pinelabs-payments": { load: () => require("./pinelabs-payments/tools"), summary: "Trip payments via Pine Labs: EMI options and group split payment links" },
  "weather-forecast": { load: () => require("./weather-forecast/tools"), summary: "Weather forecasts and trip weather scoring (Open-Meteo)" },
};
