import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body    = await req.json();
    const starred = Array.isArray(body.starred) ? body.starred : [];

    // Basic sanity — cap at 5000 entries, trim each to 64 chars
    const clean = [...new Set(starred)]
      .slice(0, 5000)
      .map(s => String(s).slice(0, 64));

    const store = getStore("pdm-preferred");
    await store.set("starred", JSON.stringify(clean));

    return new Response(JSON.stringify({ ok: true, count: clean.length }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("set-starred error:", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/api/set-starred" };
