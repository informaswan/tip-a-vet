// donation-worker/src/index.js
const ALLOWED_ORIGINS = [
  "https://tip-a-vet.com",
  "https://informaswan.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)),
  });
}

function clampText(value, max) {
  return String(value == null ? "" : value).slice(0, max);
}

async function stripeRequest(env, path, init) {
  const response = await fetch("https://api.stripe.com/v1/" + path, Object.assign({
    headers: {
      "Authorization": "Bearer " + env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  }, init));
  let data;
  try {
    data = await response.json();
  } catch (error) {
    return { ok: false, message: "Stripe returned an unreadable response" };
  }
  if (!response.ok) {
    return { ok: false, message: data.error ? data.error.message : "Stripe error" };
  }
  return { ok: true, data: data };
}

async function createSession(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const tipCents = Math.round(Number(body.tipCents));
  const supportCents = Math.round(Number(body.supportCents) || 0);
  const returnUrl = body.returnUrl;

  if (!(tipCents > 0) || !returnUrl) {
    return jsonResponse({ error: "tipCents and returnUrl are required" }, 400, origin);
  }
  if (tipCents < 100) {
    return jsonResponse({ error: "tip must be at least $1" }, 400, origin);
  }
  if (supportCents < 0) {
    return jsonResponse({ error: "support amount can't be negative" }, 400, origin);
  }
  if (tipCents + supportCents > 50000) {
    return jsonResponse({ error: "total must be at most $500" }, 400, origin);
  }

  let returnUrlOrigin;
  try {
    returnUrlOrigin = new URL(returnUrl).origin;
  } catch (error) {
    return jsonResponse({ error: "returnUrl must be a valid URL" }, 400, origin);
  }
  if (!ALLOWED_ORIGINS.includes(returnUrlOrigin)) {
    return jsonResponse({ error: "returnUrl must be on an allowed origin" }, 400, origin);
  }

  const vetId = clampText(body.vetId, 80);
  const vetName = clampText(body.vetName, 80);
  const note = clampText(body.note, 200);
  const base = returnUrl.split("#")[0];

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][product_data][name]", "Tip for " + (vetName || "this period's vet"));
  params.set("line_items[0][price_data][product_data][description]", "Paid out to the veteran at the end of the period, minus card fees.");
  params.set("line_items[0][price_data][unit_amount]", String(tipCents));
  params.set("line_items[0][quantity]", "1");
  if (supportCents > 0) {
    params.set("line_items[1][price_data][currency]", "usd");
    params.set("line_items[1][price_data][product_data][name]", "Covers fees and supports Tip a Vet");
    params.set("line_items[1][price_data][unit_amount]", String(supportCents));
    params.set("line_items[1][quantity]", "1");
  }
  params.set("success_url", base + "#/tip/complete?session_id={CHECKOUT_SESSION_ID}");
  params.set("cancel_url", base + "#/tip");
  params.set("payment_intent_data[statement_descriptor]", "TIP A VET");
  [["vet_id", vetId], ["vet_name", vetName], ["tip_cents", tipCents], ["support_cents", supportCents], ["note", note]].forEach(function (pair) {
    params.set("metadata[" + pair[0] + "]", String(pair[1]));
    params.set("payment_intent_data[metadata][" + pair[0] + "]", String(pair[1]));
  });

  const result = await stripeRequest(env, "checkout/sessions", { method: "POST", body: params.toString() });
  if (!result.ok) {
    return jsonResponse({ error: result.message }, 500, origin);
  }
  return jsonResponse({ url: result.data.url }, 200, origin);
}

async function sessionStatus(url, env, origin) {
  const id = url.searchParams.get("id") || "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) {
    return jsonResponse({ error: "Invalid session id" }, 400, origin);
  }
  const result = await stripeRequest(env, "checkout/sessions/" + id, { method: "GET" });
  if (!result.ok) {
    return jsonResponse({ error: result.message }, 500, origin);
  }
  const session = result.data;
  const meta = session.metadata || {};
  return jsonResponse({
    paid: session.payment_status === "paid",
    vetName: meta.vet_name || "",
    note: meta.note || "",
    tipCents: Number(meta.tip_cents) || 0,
    supportCents: Number(meta.support_cents) || 0,
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method === "POST" && url.pathname === "/create-donation-session") {
      return createSession(request, env, origin);
    }
    if (request.method === "GET" && url.pathname === "/session-status") {
      return sessionStatus(url, env, origin);
    }
    return jsonResponse({ error: "Not found" }, 404, origin);
  },
};
