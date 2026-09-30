import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/server/snapshot-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Opening the store and issuing a read checks that the persistent database
    // is reachable without exposing its location or any saved market data.
    getSnapshot("health-check", "readiness");
    return NextResponse.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
