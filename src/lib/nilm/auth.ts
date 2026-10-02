import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE_NAME = "nilm_admin";

const sha = (s: string) => createHash("sha256").update(`fhe-nilm:${s}`).digest();

/** Jeton d'accès à l'espace NILM (variable Vercel serveur NILM_ADMIN_TOKEN). */
export const adminConfigured = () => Boolean(process.env.NILM_ADMIN_TOKEN);

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Comparaison en temps constant d'un jeton fourni avec NILM_ADMIN_TOKEN. */
export function tokenMatches(provided: string): boolean {
  const expected = process.env.NILM_ADMIN_TOKEN;
  if (!expected || !provided) return false;
  return safeEqual(sha(provided), sha(expected));
}

/** Valeur du cookie posé après connexion : empreinte du jeton, jamais le jeton lui-même. */
export function cookieValue(): string | null {
  const expected = process.env.NILM_ADMIN_TOKEN;
  return expected ? sha(expected).toString("hex") : null;
}

/** Admin = en-tête `Authorization: Bearer <jeton>` (appels machine) ou cookie httpOnly (navigateur). */
export async function isAdmin(request?: Request): Promise<boolean> {
  const bearer = request?.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && tokenMatches(bearer)) return true;
  const expected = cookieValue();
  if (!expected) return false;
  const jar = await cookies();
  const got = jar.get(COOKIE_NAME)?.value;
  return Boolean(got) && safeEqual(Buffer.from(got!), Buffer.from(expected));
}
