import { type NextRequest } from "next/server";

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;

export function checkAdminAuth(req: NextRequest): boolean {
  if (!ADMIN_TOKEN) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${ADMIN_TOKEN}`;
}
