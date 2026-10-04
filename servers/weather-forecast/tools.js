const SERVER_INFO = { name: "weather-forecast-mcp", version: "1.0.0" };

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

const FORECAST_DAYS_AHEAD = 15; // Open-Meteo serves dates up to ~15 days from today
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max";
const ARCHIVE_DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max";
const HISTORY_YEARS = 5;

// ---------- helpers ----------

async function getJson(url, params) {
  const res = await fetch(`${url}?${new URLSearchParams(params)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = new Error(data.reason || `Open-Meteo request failed with HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(new Date(s + "T00:00:00Z").getTime() + n * 86400000));
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
const round1 = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : null);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

const WMO = {
  0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Heavy freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Heavy freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light rain showers", 81: "Rain showers", 82: "Violent rain showers", 85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm with hail",
};
const describe = (c) => WMO[c] || "Unknown";

// State names the geocoder cannot resolve, and popular destinations that share a name with
// bigger places elsewhere (e.g. Manali in Tamil Nadu). Value = "place, region" hint.
const ALIASES = {
  goa: "Panjim, Goa", "north goa": "Mapusa, Goa", "south goa": "Margao, Goa", kerala: "Kochi, Kerala",
  rajasthan: "Jaipur, Rajasthan", kashmir: "Srinagar, Jammu and Kashmir", ladakh: "Leh, Ladakh",
  himachal: "Shimla, Himachal Pradesh", uttarakhand: "Dehradun, Uttarakhand", sikkim: "Gangtok, Sikkim",
  manali: "Manali, Himachal Pradesh", munnar: "Munnar, Kerala", ooty: "Ooty, Tamil Nadu",
  kodaikanal: "Kodaikanal, Tamil Nadu", alleppey: "Alappuzha, Kerala", pondicherry: "Puducherry, Puducherry",
};

// ---------- location ----------

async function resolveLocation(args) {
  if (args.latitude !== undefined && args.longitude !== undefined) {
    const lat = Number(args.latitude), lon = Number(args.longitude);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw new Error("latitude/longitude out of range");
    return { name: args.location || `${lat}, ${lon}`, latitude: lat, longitude: lon, other_matches: [] };
  }
  if (!args.location) throw new Error("Provide location (a place name) or latitude and longitude");

  const aliased = ALIASES[String(args.location).toLowerCase().trim()];
  const query = aliased || String(args.location);
  const [first, ...hints] = query.split(",").map((s) => s.trim()).filter(Boolean);
  const params = { name: first, count: "10", language: "en", format: "json" };
  const cc = args.country_code || (aliased ? "IN" : undefined);
  if (cc) params.countryCode = String(cc).toUpperCase();

  const data = await getJson(GEOCODE_URL, params);
  const results = data.results || [];
  if (!results.length) throw new Error(`Could not find a place called "${args.location}". Try adding a country_code or pass latitude and longitude.`);

  const hintText = hints.join(" ").toLowerCase();
  const score = (r) =>
    Math.log10((r.population || 0) + 10) +
    (hintText && [r.admin1, r.admin2, r.country].some((x) => x && hintText.includes(String(x).toLowerCase())) ? 10 : 0);
  const ranked = [...results].sort((a, b) => score(b) - score(a));
  const pick = ranked[0];
  const hintMatched = !hintText || [pick.admin1, pick.admin2, pick.country].some((x) => x && hintText.includes(String(x).toLowerCase()));
  const label = (r) => [r.name, r.admin1, r.country].filter(Boolean).join(", ");
  return {
    name: label(pick),
    latitude: pick.latitude,
    longitude: pick.longitude,
    timezone: pick.timezone,
    hint_mismatch: hintMatched ? undefined : `Asked for "${args.location}" but the closest match is ${label(pick)}; verify or pass latitude/longitude.`,
    other_matches: ranked.slice(1, 4).map((r) => ({ name: label(r), latitude: r.latitude, longitude: r.longitude })),
  };
}

const placeInfo = (loc) => ({
  name: loc.name,
  latitude: loc.latitude,
  longitude: loc.longitude,
  ...(loc.hint_mismatch ? { warning: loc.hint_mismatch } : {}),
  ...(loc.other_matches?.length
    ? { other_matches: loc.other_matches, match_note: "If the wrong place was chosen, retry with country_code or exact latitude/longitude." }
    : {}),
});

// ---------- data ----------

function toDays(d) {
  return d.time.map((t, i) => ({
    date: t,
    summary: describe(d.weather_code?.[i]),
    weather_code: d.weather_code?.[i],
    temp_max_c: round1(d.temperature_2m_max[i]),
    temp_min_c: round1(d.temperature_2m_min[i]),
    rain_mm: round1(d.precipitation_sum[i]),
    rain_chance_pct: d.precipitation_probability_max?.[i] ?? null,
    wind_max_kmh: round1(d.wind_speed_10m_max[i]),
    uv_index_max: round1(d.uv_index_max?.[i]),
  }));
}

async function fetchForecast(loc, start, end, hourly) {
  const params = {
    latitude: loc.latitude, longitude: loc.longitude, daily: DAILY, timezone: "auto",
    start_date: start, end_date: end,
  };
  if (hourly) params.hourly = "temperature_2m,precipitation_probability,precipitation";
  return getJson(FORECAST_URL, params);
}

// Same calendar dates in each of the last N years, from actual recorded weather.
async function fetchHistory(loc, start, end) {
  const startYear = Number(start.slice(0, 4));
  const jobs = [];
  for (let k = 1; k <= HISTORY_YEARS; k++) {
    const shift = (s) => {
      const d = new Date(s + "T00:00:00Z");
      d.setUTCFullYear(d.getUTCFullYear() - k);
      return iso(d);
    };
    jobs.push(
      getJson(ARCHIVE_URL, {
        latitude: loc.latitude, longitude: loc.longitude, daily: ARCHIVE_DAILY, timezone: "auto",
        start_date: shift(start), end_date: shift(end),
      }).catch(() => null)
    );
  }
  const years = (await Promise.all(jobs)).filter(Boolean);
  if (!years.length) throw new Error("Historical weather data was unavailable for this location");
  const samples = [];
  for (const y of years)
    toDays(y.daily).forEach((d) => samples.push(d));
  return { samples, years_used: years.length, base_year: startYear };
}

// ---------- scoring ----------

function metrics(days) {
  const n = days.length;
  const pct = (fn) => Math.round((days.filter(fn).length / n) * 100);
  return {
    sample_days: n,
    avg_temp_max_c: round1(avg(days.map((d) => d.temp_max_c).filter((x) => x !== null))),
    avg_temp_min_c: round1(avg(days.map((d) => d.temp_min_c).filter((x) => x !== null))),
    avg_rain_mm_per_day: round1(avg(days.map((d) => d.rain_mm ?? 0))),
    rainy_day_pct: pct((d) => (d.rain_mm ?? 0) >= 1),
    heavy_rain_day_pct: pct((d) => (d.rain_mm ?? 0) >= 20),
    thunderstorm_day_pct: pct((d) => (d.weather_code ?? 0) >= 95),
    hot_day_pct: pct((d) => (d.temp_max_c ?? 0) >= 35),
    cold_day_pct: pct((d) => (d.temp_max_c ?? 99) <= 10),
    windy_day_pct: pct((d) => (d.wind_max_kmh ?? 0) >= 40),
  };
}

function verdict(m) {
  const penalties = [
    [m.rainy_day_pct * 0.45, `rain on ${m.rainy_day_pct}% of days`],
    [m.heavy_rain_day_pct * 0.6, `heavy rain (20mm+) on ${m.heavy_rain_day_pct}% of days`],
    [m.thunderstorm_day_pct * 0.4, `thunderstorms on ${m.thunderstorm_day_pct}% of days`],
    [m.hot_day_pct * 0.25, `very hot (35°C+) on ${m.hot_day_pct}% of days`],
    [m.cold_day_pct * 0.25, `very cold (10°C or below) on ${m.cold_day_pct}% of days`],
    [m.windy_day_pct * 0.2, `strong wind on ${m.windy_day_pct}% of days`],
  ];
  const score = Math.max(0, Math.round(100 - penalties.reduce((a, [p]) => a + p, 0)));
  const reasons = penalties.filter(([p]) => p >= 4).sort((a, b) => b[0] - a[0]).map(([, r]) => r);
  let rating = score >= 70 ? "good" : score >= 45 ? "mixed" : "poor";
  // A dry but cold or scorching trip is not "good" for a general traveller.
  const hi = m.avg_temp_max_c;
  if (rating === "good" && hi !== null && (hi < 15 || hi >= 36)) {
    rating = "mixed";
    reasons.unshift(hi < 15 ? `cold: average daytime high only ${hi}°C` : `very hot: average daytime high ${hi}°C`);
  }
  if (!reasons.length) reasons.push("no significant rain, heat, cold or wind expected");
  return { score, rating, reasons };
}

// ---------- core: weather for dates ----------

async function weatherForDates(loc, start, end, { hourly = false } = {}) {
  if (!DATE.test(start || "") || !DATE.test(end || "")) throw new Error("start_date and end_date must be YYYY-MM-DD");
  if (end < start) throw new Error("end_date must not be before start_date");
  if (daysBetween(start, end) > 31) throw new Error("Date range can be at most 31 days");
  const today = iso(new Date());
  if (end < today) throw new Error("These dates are in the past");
  const horizon = addDays(today, FORECAST_DAYS_AHEAD);

  const out = { forecast: null, history: null };

  const fcStart = start < today ? today : start;
  if (fcStart <= horizon && fcStart <= end) {
    const fcEnd = end < horizon ? end : horizon;
    try {
      const data = await fetchForecast(loc, fcStart, fcEnd, hourly && daysBetween(fcStart, fcEnd) <= 3);
      out.forecast = { start: fcStart, end: fcEnd, days: toDays(data.daily), hourly: data.hourly };
    } catch (e) {
      if (e.status !== 400) throw e; // out-of-range edge: fall through to history
    }
  }
  const histStart = out.forecast ? addDays(out.forecast.end, 1) : start < today ? today : start;
  if (histStart <= end) {
    const h = await fetchHistory(loc, histStart, end);
    out.history = { start: histStart, end, years_used: h.years_used, samples: h.samples };
  }
  return out;
}

function analyse(out) {
  const parts = [];
  if (out.forecast) parts.push({ basis: "forecast", days: out.forecast.days });
  if (out.history) parts.push({ basis: "historical_average", days: out.history.samples });
  const all = parts.flatMap((p) => p.days);
  const m = metrics(all);
  return { ...m, ...verdict(m), basis: parts.map((p) => p.basis) };
}

function basisNote(out) {
  const notes = [];
  if (out.forecast) notes.push(`Forecast for ${out.forecast.start} to ${out.forecast.end}.`);
  if (out.history)
    notes.push(
      `${out.history.start} to ${out.history.end} is beyond the reliable forecast window (about ${FORECAST_DAYS_AHEAD} days), so it uses the average of actual weather on the same dates over the last ${out.history.years_used} years. This is a climate guide, not a forecast.`
    );
  return notes.join(" ");
}

// ---------- tool handlers ----------

async function getWeather(args) {
  const loc = await resolveLocation(args);
  const out = await weatherForDates(loc, args.start_date, args.end_date, { hourly: args.include_hourly });
  const result = { location: placeInfo(loc), note: basisNote(out) };
  if (out.forecast) {
    result.forecast_days = out.forecast.days;
    if (out.forecast.hourly) {
      const h = out.forecast.hourly;
      result.hourly = h.time.map((t, i) => ({
        time: t, temp_c: round1(h.temperature_2m[i]), rain_chance_pct: h.precipitation_probability[i], rain_mm: round1(h.precipitation[i]),
      }));
    }
  }
  if (out.history) {
    const m = metrics(out.history.samples);
    result.historical_average = { dates: `${out.history.start} to ${out.history.end}`, years_used: out.history.years_used, ...m };
  }
  return result;
}

async function getCurrentWeather(args) {
  const loc = await resolveLocation(args);
  const data = await getJson(FORECAST_URL, {
    latitude: loc.latitude, longitude: loc.longitude, timezone: "auto",
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
  });
  const c = data.current;
  return {
    location: placeInfo(loc),
    observed_at: c.time,
    summary: describe(c.weather_code),
    temp_c: round1(c.temperature_2m),
    feels_like_c: round1(c.apparent_temperature),
    humidity_pct: c.relative_humidity_2m,
    rain_mm_last_hour: round1(c.precipitation),
    wind_kmh: round1(c.wind_speed_10m),
  };
}

async function scoreTripWeather(args) {
  const loc = await resolveLocation(args);
  const out = await weatherForDates(loc, args.start_date, args.end_date);
  const a = analyse(out);
  return {
    location: placeInfo(loc),
    dates: `${args.start_date} to ${args.end_date}`,
    rating: a.rating,
    score: a.score,
    reasons: a.reasons,
    basis: a.basis,
    stats: {
      avg_temp_max_c: a.avg_temp_max_c, avg_temp_min_c: a.avg_temp_min_c, avg_rain_mm_per_day: a.avg_rain_mm_per_day,
      rainy_day_pct: a.rainy_day_pct, heavy_rain_day_pct: a.heavy_rain_day_pct, thunderstorm_day_pct: a.thunderstorm_day_pct,
      hot_day_pct: a.hot_day_pct, cold_day_pct: a.cold_day_pct, windy_day_pct: a.windy_day_pct,
    },
    note: basisNote(out),
  };
}

async function compareWeather(args) {
  const list = Array.isArray(args.locations) ? args.locations.filter(Boolean) : [];
  if (list.length < 2) throw new Error("Provide at least 2 locations to compare");
  if (list.length > 6) throw new Error("Compare at most 6 locations at a time");
  const results = await Promise.all(
    list.map(async (name) => {
      try {
        const loc = await resolveLocation({ location: name, country_code: args.country_code });
        const out = await weatherForDates(loc, args.start_date, args.end_date);
        const a = analyse(out);
        return {
          requested: name, resolved_as: loc.name, rating: a.rating, score: a.score, reasons: a.reasons, basis: a.basis,
          avg_temp_max_c: a.avg_temp_max_c, avg_temp_min_c: a.avg_temp_min_c, rainy_day_pct: a.rainy_day_pct,
        };
      } catch (e) {
        return { requested: name, error: e.message };
      }
    })
  );
  const ok = results.filter((r) => !r.error).sort((a, b) => b.score - a.score);
  return {
    dates: `${args.start_date} to ${args.end_date}`,
    ranking: ok.map((r, i) => ({ rank: i + 1, ...r })),
    failed: results.filter((r) => r.error),
    note: "Ranked by weather score (100 = ideal). 'basis' says whether each score comes from a forecast or a historical average; do not treat a historical average as a forecast.",
  };
}

// ---------- tool definitions ----------

const where = {
  location: { type: "string", description: "Place name, e.g. 'Baga, Goa', 'Manali', 'Bangkok'. Add a region after a comma to disambiguate." },
  country_code: { type: "string", description: "2-letter country code to narrow the place lookup, e.g. 'IN'" },
  latitude: { type: "number", description: "Exact latitude (use with longitude instead of location)" },
  longitude: { type: "number", description: "Exact longitude (use with latitude instead of location)" },
};
const dates = {
  start_date: { type: "string", description: "First day, YYYY-MM-DD" },
  end_date: { type: "string", description: "Last day, YYYY-MM-DD (max 31 days)" },
};

const TOOLS = [
  {
    name: "get_weather",
    description:
      "Daily weather for a place and date range: summary, max/min temperature (°C), rain (mm and chance), wind and UV. Dates within about 15 days use a real forecast; later dates use the average of actual weather on the same dates over the last 5 years and are labelled as such. Set include_hourly for hourly detail on trips of up to 3 days.",
    inputSchema: {
      type: "object",
      properties: { ...where, ...dates, include_hourly: { type: "boolean", description: "Add hourly temperature and rain (forecast ranges of 3 days or fewer)" } },
      required: ["start_date", "end_date"],
    },
    handler: getWeather,
  },
  {
    name: "get_current_weather",
    description: "Current conditions right now for a place: temperature, feels-like, humidity, rain and wind.",
    inputSchema: { type: "object", properties: where },
    handler: getCurrentWeather,
  },
  {
    name: "score_trip_weather",
    description:
      "Rate the weather for a trip at one place and dates as good, mixed or poor (score 0-100) with plain reasons (rain, heavy rain, thunderstorms, heat, cold, wind). Uses forecast where available, otherwise a 5-year historical average, and says which. Use to decide whether a destination suits the dates or to flag a risky travel leg.",
    inputSchema: { type: "object", properties: { ...where, ...dates }, required: ["start_date", "end_date"] },
    handler: scoreTripWeather,
  },
  {
    name: "compare_destinations_weather",
    description:
      "Rank 2-6 candidate destinations by weather for the same dates. Returns each place's rating, score, reasons and whether it is based on a forecast or historical average, best first. Use when choosing where to go.",
    inputSchema: {
      type: "object",
      properties: {
        locations: { type: "array", items: { type: "string" }, description: "2-6 place names, e.g. ['Goa', 'Manali', 'Jaipur']" },
        country_code: { type: "string", description: "2-letter country code applied to all lookups, e.g. 'IN'" },
        ...dates,
      },
      required: ["locations", "start_date", "end_date"],
    },
    handler: compareWeather,
  },
];

module.exports = { SERVER_INFO, TOOLS };
