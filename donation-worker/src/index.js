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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)),
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
    }

    const donationAmount = Number(body.donationAmount);
    const returnUrl = body.returnUrl;

    if (!(donationAmount > 0) || !returnUrl) {
      return jsonResponse({ error: "donationAmount and returnUrl are required" }, 400, origin);
    }

    if (donationAmount < 0.5) {
      return jsonResponse({ error: "donationAmount must be at least $0.50" }, 400, origin);
    }

    if (donationAmount > 500) {
      return jsonResponse({ error: "donationAmount must be at most $500" }, 400, origin);
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

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][product_data][name]", "Support Tip a Vet");
    params.set("line_items[0][price_data][unit_amount]", String(Math.round(donationAmount * 100)));
    params.set("line_items[0][quantity]", "1");
    params.set("success_url", returnUrl);
    params.set("cancel_url", returnUrl);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    let session;
    try {
      session = await stripeResponse.json();
    } catch (error) {
      return jsonResponse({ error: "Stripe returned an unreadable response" }, 500, origin);
    }

    if (!stripeResponse.ok) {
      return jsonResponse({ error: session.error ? session.error.message : "Stripe error" }, 500, origin);
    }

    return jsonResponse({ url: session.url }, 200, origin);
  },
};
