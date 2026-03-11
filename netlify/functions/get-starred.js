import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  try {
    const store = getStore("pdm-preferred");
    const raw   = await store.get("starred");
    const list  = raw ? JSON.parse(raw) : [];

    return new Response(JSON.stringify({ starred: list }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("get-starred error:", err);
    return new Response(JSON.stringify({ starred: [], error: err.message }), {
      status: 200, // still return 200 so the frontend degrades gracefully
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/api/get-starred" };
