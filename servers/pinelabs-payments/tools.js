const pl = require("./pinelabs");

const SERVER_INFO = { name: "pinelabs-payments-mcp", version: "1.0.0" };

const customerProps = {
  name: { type: "string", description: "Traveler full name" },
  email: { type: "string", description: "Traveler email" },
  phone: { type: "string", description: "Traveler mobile number" },
};

const TOOLS = [
  {
    name: "estimate_emi",
    description:
      "Offline EMI estimate for a trip total (monthly amount, interest, total payable for 3/6/9/12 months). Use it to show 'pay in installments' options while planning. This is an estimate, not a bank offer; use get_emi_offers for real bank offers.",
    inputSchema: {
      type: "object",
      properties: {
        amount_inr: { type: "number", description: "Trip total in INR" },
        annual_rate_pct: { type: "number", description: "Assumed annual interest rate %, default 14. Use 0 for no-cost EMI." },
        tenures: { type: "array", items: { type: "integer" }, description: "Tenures in months, default [3,6,9,12]" },
      },
      required: ["amount_inr"],
    },
    handler: async (a) => ({
      amount_inr: a.amount_inr,
      note: "Estimate only. Final EMI depends on the customer's bank and card.",
      options: pl.estimateEmi(a.amount_inr, a.annual_rate_pct, a.tenures),
    }),
  },
  {
    name: "get_emi_offers",
    description:
      "Live bank-specific EMI offers from Pine Labs for an amount and a card BIN (first 6-8 card digits). Returns issuer tenures, monthly EMI and interest.",
    inputSchema: {
      type: "object",
      properties: {
        amount_inr: { type: "number", description: "Amount in INR" },
        card_bin: { type: "string", description: "First 6-8 digits of the customer's card" },
      },
      required: ["amount_inr", "card_bin"],
    },
    handler: async (a) => ({ amount_inr: a.amount_inr, issuers: await pl.discoverEmiOffers(a) }),
  },
  {
    name: "create_payment_link",
    description:
      "Create a Pine Labs payment link for one payer. The customer pays on Pine Labs' hosted page (UPI, cards, netbanking, EMI, etc.). Confirm the amount with the user before calling.",
    inputSchema: {
      type: "object",
      properties: {
        amount_inr: { type: "number", description: "Amount in INR" },
        reference: { type: "string", description: "Unique reference for this link, max 50 chars (e.g. trip id + purpose). Reusing it is idempotent." },
        description: { type: "string", description: "Shown to the payer, e.g. 'Goa trip 12-15 Nov'" },
        customer: { type: "object", properties: customerProps },
        allowed_payment_methods: {
          type: "array",
          items: { type: "string", enum: ["CARD", "UPI", "NETBANKING", "WALLET", "CREDIT_EMI", "DEBIT_EMI", "BNPL"] },
          description: "Restrict methods. Include CREDIT_EMI/DEBIT_EMI to offer installments.",
        },
        expire_by: { type: "string", description: "ISO 8601 expiry, max 180 days out" },
        callback_url: { type: "string", description: "Where to redirect after payment" },
      },
      required: ["amount_inr", "reference", "customer"],
    },
    handler: (a) => pl.createPaymentLink(a),
  },
  {
    name: "create_group_split_links",
    description:
      "Split a group trip total across travelers and create one Pine Labs payment link per traveler. Splits equally by default (remainder paise go to the first travelers), or give share_inr per traveler for custom shares that sum to the total. Returns each traveler's link to share. Confirm the split with the user first.",
    inputSchema: {
      type: "object",
      properties: {
        trip_id: { type: "string", description: "Stable trip id, max 40 chars. Link references become <trip_id>-<n>." },
        total_amount_inr: { type: "number", description: "Total trip cost in INR" },
        travelers: {
          type: "array",
          items: {
            type: "object",
            properties: { ...customerProps, share_inr: { type: "number", description: "Optional custom share in INR" } },
          },
          description: "One entry per payer",
        },
        description: { type: "string" },
        expire_by: { type: "string", description: "ISO 8601 deadline for all payments" },
        callback_url: { type: "string" },
        allowed_payment_methods: { type: "array", items: { type: "string" } },
      },
      required: ["trip_id", "total_amount_inr", "travelers"],
    },
    handler: (a) => pl.createGroupSplitLinks(a),
  },
  {
    name: "get_group_payment_status",
    description:
      "Check who has paid in a group trip. Pass the payment_link_ids returned by create_group_split_links. Returns paid/pending counts and whether everyone has paid, so booking can proceed.",
    inputSchema: {
      type: "object",
      properties: { payment_link_ids: { type: "array", items: { type: "string" } } },
      required: ["payment_link_ids"],
    },
    handler: (a) => pl.getGroupPaymentStatus(a.payment_link_ids),
  },
  {
    name: "get_payment_link_status",
    description: "Get the status and amount due of a single payment link.",
    inputSchema: {
      type: "object",
      properties: { payment_link_id: { type: "string" } },
      required: ["payment_link_id"],
    },
    handler: (a) => pl.getPaymentLink(a.payment_link_id),
  },
];

module.exports = { SERVER_INFO, TOOLS };
