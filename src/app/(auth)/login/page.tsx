// =============================================================================
// /login  —  owned by the auth stream.
// -----------------------------------------------------------------------------
// CONTRACT WITH tests/e2e/fixtures.ts (do not break — twelve streams' e2e suites
// call loginAs() against exactly these selectors):
//   * a form at /login
//   * input[name="email"]
//   * input[name="password"]
//   * button[type="submit"]
//   * on success the browser navigates AWAY from /login
//
// Deliberately a server component with a server action and no client JavaScript:
// the form posts, the action signs in and redirects. Nothing here depends on
// hydration, so login still works if the client bundle fails to load.
//
// STYLING: plain semantic inputs with Tailwind utilities. The ui-shell stream is
// building src/components/ui in parallel; importing it now would couple this
// page to a module that does not exist yet. A follow-up PR swaps in the
// primitives once ui-shell lands.
// =============================================================================

import Link from "next/link";
import { redirect } from "next/navigation";

import { loginSchema } from "@/lib/contracts/validation";
import {
  AFTER_LOGIN_PATH,
  AuthError,
  INVALID_CREDENTIALS_MESSAGE,
  roleForEmail,
  signIn,
} from "@/lib/auth";
import { homeFor } from "@/lib/navigation/role-access";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

/** Error codes this page renders, keyed by the `?error=` query value. */
const ERROR_MESSAGES: Record<string, string> = {
  invalid: INVALID_CREDENTIALS_MESSAGE,
  // Emitted by requireRole()/middleware when a session exists but is not
  // privileged enough for the requested route.
  forbidden: "That area is restricted. Sign in with an account that has access.",
  // Auth.js redirects here with its own codes when its internal flow fails.
  CredentialsSignin: INVALID_CREDENTIALS_MESSAGE,
  Configuration: "Sign-in is misconfigured on the server. Contact an administrator.",
};

/**
 * Only same-origin relative paths may be used as a post-login destination.
 * Accepting an absolute URL here would be an open redirect: a link to
 * /login?next=https://evil.example would send a freshly authenticated user off-site.
 */
function safeNext(next: string | undefined): string {
  return explicitNext(next) ?? AFTER_LOGIN_PATH;
}

/**
 * The caller's requested destination, or null when they did not ask for one.
 *
 * Split out from `safeNext` because "no destination given" and "/dashboard" are
 * NOT the same thing, and treating them as one is the bug: every role was sent to
 * the student dashboard because the absence of a `next` was being converted into a
 * concrete student path before anyone knew the role. Callers that need a string
 * fallback (the error redirects, and the hidden form field) still use `safeNext`;
 * the success path uses this and resolves the fallback by role instead.
 *
 * The open-redirect defence is unchanged and still lives here: a `next` that is
 * absolute, protocol-relative, or points back at an auth page is discarded, so
 * /login?next=https://evil.example cannot send a freshly authenticated user
 * off-site.
 */
function explicitNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (next.startsWith("/login") || next.startsWith("/register")) return null;
  return next;
}

async function loginAction(formData: FormData): Promise<void> {
  "use server";

  const requested = explicitNext(String(formData.get("next") ?? "") || undefined);
  // Used only by the failure redirects below, which must send the visitor back to
  // /login with their destination preserved.
  const next = requested ?? AFTER_LOGIN_PATH;

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
  }

  try {
    const result: unknown = await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      // Redirect explicitly below so a failure can be turned into a form error
      // rather than an Auth.js error page.
      redirect: false,
    });
    if (typeof result === "string" && /[?&]error=/.test(result)) {
      throw new AuthError("CredentialsSignin");
    }
  } catch (err) {
    if (err instanceof AuthError) {
      redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
    }
    // redirect() signals by throwing; never swallow that.
    throw err;
  }

  // THE DESTINATION IS CHOSEN BY ROLE when the visitor did not ask for a specific
  // page. An instructor or admin signing in used to land on /dashboard, the student
  // dashboard, because AFTER_LOGIN_PATH is one constant for everybody.
  //
  // An explicit `next` still wins — it is how middleware returns somebody to the
  // page that made them sign in — and if that page is not for their role, the
  // redirect in src/middleware.ts moves them on. So a staff member following a link
  // to a student page still ends up somewhere sensible, without this action needing
  // to know which pages those are.
  //
  // The lookup is by email rather than from the session: signIn(..., { redirect:
  // false }) stages the cookie on the RESPONSE, while auth() reads the cookies that
  // came with the REQUEST, so within this request the caller is still anonymous. See
  // roleForEmail's own note.
  let destination = requested;
  if (!destination) {
    try {
      destination = homeFor(await roleForEmail(parsed.data.email));
    } catch {
      // A failed lookup must not fail a successful sign-in. The student home is the
      // safe fallback: middleware will move staff off it.
      destination = AFTER_LOGIN_PATH;
    }
  }

  // Outside the try: redirect() throws, and catching it here would turn a
  // successful login into an "invalid credentials" message.
  redirect(destination);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const message = error ? (ERROR_MESSAGES[error] ?? INVALID_CREDENTIALS_MESSAGE) : null;
  const destination = safeNext(next);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm text-neutral-600">
          Use the email and password you registered with.
        </p>
      </header>

      {message ? (
        <p
          role="alert"
          // Next.js injects its own role="alert" route announcer, so e2e specs
          // target this test id rather than getByRole("alert").
          data-testid="form-error"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {message}
        </p>
      ) : null}

      <form action={loginAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="next" value={destination} />

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Sign in
        </button>
      </form>

      <p className="text-sm text-neutral-600">
        No account yet?{" "}
        <Link href="/register" className="font-medium underline">
          Register as a student
        </Link>
      </p>
    </main>
  );
}
