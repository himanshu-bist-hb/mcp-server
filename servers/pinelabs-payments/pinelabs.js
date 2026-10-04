// Thin Pine Labs Plural client + pure helpers (EMI estimate, group split).
// Amounts are INR at the tool boundary and paise on the Pine Labs wire.
const crypto = require("crypto");

const BASES = {
  uat: "https://pluraluat.v2.pinepg.in",
  prod: "https://api.pluralpay.in",
};

const baseUrl = () => BASES[(process.env.PINELABS_ENV || "uat").toLowerCase()] || BASES.uat;
const maxLinkInr = () => Number(process.env.MAX_LINK_AMOUNT_INR || 500000);
const toPaise = (inr) => Math.round(Number(inr) * 100);

let cachedToken = null; // { value, expiresAt }

async function getToken() {
  // This server can create payment links: never run live (prod) without endpoint auth.
  if ((process.env.PINELABS_ENV || "uat").toLowerCase() === "prod" && !process.env.MCP_AUTH_TOKEN) {
    throw new Error("MCP_AUTH_TOKEN must be set when PINELABS_ENV=prod");
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const { PINELABS_CLIENT_ID: id, PINELABS_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error("PINELABS_CLIENT_ID / PINELABS_CLIENT_SECRET not configured");
  const res = await fetch(`${baseUrl()}/api/auth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Pine Labs auth failed (${res.status}): ${JSON.stringify(data)}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function plural(method, path, body) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
      "Request-ID": crypto.randomUUID(),
      "Request-Timestamp": new Date().toISOString(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Pine Labs ${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function checkAmount(inr) {
  if (!(inr > 0)) throw new Error("amount_inr must be > 0");
  if (inr > maxLinkInr()) throw new Error(`amount_inr exceeds safety cap of ${maxLinkInr()} INR`);
}

function buildCustomer(c = {}) {
  const out = {};
  if (c.name) {
    const [first, ...rest] = String(c.name).trim().split(/\s+/);
    out.first_name = first;
    if (rest.length) out.last_name = rest.join(" ");
  }
  if (c.email) out.email_id = c.email;
  if (c.phone) out.mobile_number = c.phone;
  return Object.keys(out).length ? out : undefined;
}

const shape = (r) => ({
  payment_link: r.payment_link,
  payment_link_id: r.payment_link_id,
  order_id: r.order_id,
  status: r.status,
  amount_inr: r.amount ? r.amount.value / 100 : undefined,
  amount_due_inr: r.amount_due ? r.amount_due.value / 100 : undefined,
  expire_by: r.expire_by,
  merchant_payment_link_reference: r.merchant_payment_link_reference,
});

async function createPaymentLink({
  amount_inr,
  reference,
  description,
  customer,
  allowed_payment_methods,
  expire_by,
  callback_url,
  metadata,
}) {
  checkAmount(amount_inr);
  if (!reference || reference.length > 50) throw new Error("reference is required (max 50 chars)");
  const body = {
    amount: { value: toPaise(amount_inr), currency: "INR" },
    merchant_payment_link_reference: reference,
    description,
    customer: buildCustomer(customer),
    allowed_payment_methods,
    expire_by,
    callback_url,
    merchant_metadata: metadata,
  };
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  return shape(await plural("POST", "/api/pay/v1/paymentlink", body));
}

async function getPaymentLink(payment_link_id) {
  return shape(await plural("GET", `/api/pay/v1/paymentlink/${encodeURIComponent(payment_link_id)}`));
}

// Split total across travelers in paise so the shares always sum exactly.
function splitAmounts(totalInr, travelers) {
  const total = toPaise(totalInr);
  const n = travelers.length;
  if (!n) throw new Error("travelers must have at least one entry");
  const custom = travelers.some((t) => t.share_inr !== undefined);
  if (custom) {
    if (travelers.some((t) => !(t.share_inr > 0))) {
      throw new Error("when any share_inr is given, every traveler needs a positive share_inr");
    }
    const sum = travelers.reduce((s, t) => s + toPaise(t.share_inr), 0);
    if (sum !== total) throw new Error(`shares sum to ${sum / 100} INR but total is ${total / 100} INR`);
    return travelers.map((t) => toPaise(t.share_inr));
  }
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return travelers.map((_, i) => base + (i < extra ? 1 : 0));
}

async function createGroupSplitLinks({ trip_id, total_amount_inr, travelers, description, expire_by, callback_url, allowed_payment_methods }) {
  checkAmount(total_amount_inr);
  if (!trip_id || trip_id.length > 40) throw new Error("trip_id is required (max 40 chars)");
  const shares = splitAmounts(total_amount_inr, travelers);
  const links = [];
  for (let i = 0; i < travelers.length; i++) {
    const t = travelers[i];
    const link = await createPaymentLink({
      amount_inr: shares[i] / 100,
      reference: `${trip_id}-${i + 1}`,
      description: `${description || "Trip payment"} - share ${i + 1}/${travelers.length}`,
      customer: t,
      allowed_payment_methods,
      expire_by,
      callback_url,
      metadata: { trip_id, traveler: String(t.name || i + 1).slice(0, 100) },
    });
    links.push({ traveler: t.name || `Traveler ${i + 1}`, share_inr: shares[i] / 100, ...link });
  }
  return { trip_id, total_amount_inr, links };
}

async function getGroupPaymentStatus(payment_link_ids) {
  const rows = await Promise.all(
    payment_link_ids.map(async (id) => {
      try {
        const l = await getPaymentLink(id);
        return { payment_link_id: id, status: l.status, amount_inr: l.amount_inr, amount_due_inr: l.amount_due_inr };
      } catch (e) {
        return { payment_link_id: id, status: "UNKNOWN", error: e.message };
      }
    })
  );
  const paid = rows.filter((r) => r.status === "PROCESSED" || r.amount_due_inr === 0);
  return {
    total_links: rows.length,
    paid: paid.length,
    pending: rows.length - paid.length,
    all_paid: paid.length === rows.length,
    links: rows,
  };
}

// Reducing-balance EMI estimate. Offline, no bank data: use for "~Rs X/month" copy only.
function estimateEmi(amountInr, annualRatePct = 14, tenures = [3, 6, 9, 12]) {
  return tenures.map((n) => {
    const r = annualRatePct / 12 / 100;
    const emi = r === 0 ? amountInr / n : (amountInr * r * (1 + r) ** n) / ((1 + r) ** n - 1);
    const monthly = Math.round(emi * 100) / 100;
    return {
      tenure_months: n,
      monthly_emi_inr: monthly,
      total_payable_inr: Math.round(monthly * n * 100) / 100,
      total_interest_inr: Math.round((monthly * n - amountInr) * 100) / 100,
      assumed_annual_rate_pct: annualRatePct,
    };
  });
}

// Live bank-specific EMI offers (needs the card BIN, first 6-8 digits).
async function discoverEmiOffers({ amount_inr, card_bin }) {
  checkAmount(amount_inr);
  const data = await plural("POST", "/api/affordability/v1/offer/discovery", {
    order_amount: { value: toPaise(amount_inr), currency: "INR" },
    payment_options: { card_details: { bin: String(card_bin) } },
  });
  return (data.issuers || []).map((iss) => ({
    issuer: iss.issuer_name || iss.name || iss.id,
    tenures: (iss.tenures || []).map((t) => ({
      tenure_id: t.tenure_id,
      tenure_months: t.tenure_value,
      monthly_emi_inr: t.monthly_emi_amount && t.monthly_emi_amount.value / 100,
      total_interest_inr: t.interest_amount && t.interest_amount.value / 100,
      interest_rate_pct: t.interest_rate_percentage,
      emi_type: t.emi_type,
    })),
  }));
}

module.exports = {
  createPaymentLink,
  getPaymentLink,
  createGroupSplitLinks,
  getGroupPaymentStatus,
  estimateEmi,
  discoverEmiOffers,
  splitAmounts,
};
