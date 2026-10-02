import { NextResponse } from "next/server";
import { COOKIE_NAME, cookieValue, tokenMatches } from "@/lib/nilm/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const back = new URL("/appareils", request.url);
  if (!tokenMatches(token)) {
    back.searchParams.set("erreur", "1");
    return NextResponse.redirect(back, 303);
  }
  const res = NextResponse.redirect(back, 303);
  res.cookies.set(COOKIE_NAME, cookieValue()!, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
