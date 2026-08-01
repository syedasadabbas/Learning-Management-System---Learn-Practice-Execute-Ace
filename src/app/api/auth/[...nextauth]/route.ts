// =============================================================================
// Auth.js internal endpoints — /api/auth/session, /api/auth/csrf,
// /api/auth/callback/credentials, /api/auth/signout, ...
// -----------------------------------------------------------------------------
// The explicit sibling routes (register/login/logout/me, named in the frozen
// ROUTES map) take precedence over this catch-all, because Next.js resolves a
// static segment before a catch-all at the same level. Both can therefore coexist.
//
// Node runtime, not edge: the credentials provider reaches for `pg` and
// `bcryptjs` through src/lib/auth.ts.
// =============================================================================

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;

export const runtime = "nodejs";
