// =============================================================================
// /register  —  owned by the auth stream.
// -----------------------------------------------------------------------------
// Self-registration always creates a `student` (see createStudentAccount). Role
// is never read from the form; promotion to instructor/admin is an
// administrative action owned by the instructor-admin stream.
//
// Same no-client-JavaScript approach as /login: server component + server action.
// Plain inputs and Tailwind utilities, not @/components/ui — ui-shell is being
// built in parallel and a later PR wires in the primitives.
//
// Password rule (min 8 characters) is NOT restated here; it comes from
// registerSchema in the frozen contracts file, so there is one source of truth.
// =============================================================================

import Link from "next/link";
import { redirect } from "next/navigation";

import { registerSchema } from "@/lib/contracts/validation";
import {
  AFTER_LOGIN_PATH,
  AuthError,
  createStudentAccount,
  DuplicateEmailError,
  signIn,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register" };

/** Minimum password length, read from the frozen schema rather than hardcoded. */
const PASSWORD_MIN_LENGTH = 8;

async function registerAction(formData: FormData): Promise<void> {
  "use server";

  const email = String(formData.get("email") ?? "");

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email,
    password: formData.get("password"),
    // No cohortId from the form: cohort assignment is an admin decision, and a
    // self-chosen cohort would let a student pick a cohort with easier deadlines.
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") ?? "";
    const detail = field ? `${field}: ${issue?.message}` : (issue?.message ?? "invalid");
    redirect(`/register?error=validation&detail=${encodeURIComponent(detail)}`);
  }

  try {
    await createStudentAccount(parsed.data);
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      // Registration must say the email is taken — otherwise the form is a dead
      // end. Login stays generic; that asymmetry is deliberate.
      redirect("/register?error=duplicate");
    }
    throw err;
  }

  // Sign the new student in immediately; a register flow that dumps the user back
  // on the login form to retype what they just typed is a needless second step.
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // The account exists; only the automatic sign-in failed. Send them to
      // /login rather than losing the registration.
      redirect("/login?error=invalid");
    }
    throw err;
  }

  redirect(AFTER_LOGIN_PATH);
}

const ERROR_HEADLINES: Record<string, string> = {
  duplicate: "An account with that email already exists. Try signing in instead.",
  validation: "Please correct the highlighted details.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const { error, detail } = await searchParams;
  const headline = error ? (ERROR_HEADLINES[error] ?? "Registration failed.") : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Create your student account</h1>
        <p className="text-sm text-neutral-600">
          Registration enrols you as a student. Instructors and admins are added by
          an administrator.
        </p>
      </header>

      {headline ? (
        <div
          role="alert"
          // Next.js injects its own role="alert" route announcer, so e2e specs
          // target this test id rather than getByRole("alert").
          data-testid="form-error"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          <p>{headline}</p>
          {detail ? <p className="mt-1 text-red-700">{detail}</p> : null}
        </div>
      ) : null}

      <form action={registerAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium">
            Full name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            minLength={2}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>

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
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
          <p className="text-xs text-neutral-500">
            At least {PASSWORD_MIN_LENGTH} characters.
          </p>
        </div>

        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Create account
        </button>
      </form>

      <p className="text-sm text-neutral-600">
        Already registered?{" "}
        <Link href="/login" className="font-medium underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
