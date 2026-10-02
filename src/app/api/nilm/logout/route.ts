import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/nilm/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const res = NextResponse.redirect(new URL("/appareils", request.url), 303);
  res.cookies.delete(COOKIE_NAME);
  return res;
}
