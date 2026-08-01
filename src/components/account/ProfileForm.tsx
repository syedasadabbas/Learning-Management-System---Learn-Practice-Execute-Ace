// =============================================================================
// PROFILE FORM — owned by the `account` stream.
// -----------------------------------------------------------------------------
// Renders ONLY the editable fields, plus email and role as read-only text with an
// explicit note about why. That is presentation; the actual barrier is the named
// column list in src/lib/account/profile.ts and the schema in validation.ts, both
// of which have no route to `role` at all. Three layers, because "the form does
// not show it" has never stopped a POST.
//
// `defaultValue` (uncontrolled) rather than `value`: this is a server component
// with no client state, and a controlled input without an onChange would be
// read-only in the browser.
// =============================================================================

import { Button, Card } from "@/components/ui";
import type { AccountProfile } from "@/lib/account/profile";
import { resolveNotice, PROFILE_NOTICES } from "@/lib/account/messages";

import { Field, ReadOnlyField, TextAreaField } from "./Field";
import { FormNotice } from "./FormNotice";

const ROLE_LABELS: Record<string, string> = {
  student: "Student",
  instructor: "Instructor",
  admin: "Administrator",
};

export function ProfileForm({
  profile,
  action,
  statusCode,
}: {
  profile: AccountProfile;
  action: (formData: FormData) => Promise<void>;
  statusCode?: string;
}) {
  const notice = resolveNotice(PROFILE_NOTICES, statusCode);

  return (
    <Card
      title="Profile"
      subtitle="How you appear on the leaderboard and to your instructors."
    >
      <form action={action} className="flex flex-col gap-4" noValidate>
        <FormNotice notice={notice} testId="profile-notice" />

        <Field
          id="name"
          label="Full name"
          type="text"
          autoComplete="name"
          required
          maxLength={255}
          defaultValue={profile.name}
        />

        <ReadOnlyField
          label="Email"
          value={profile.email}
          note="Your email is your sign-in identity. Ask an administrator to change it."
        />

        <ReadOnlyField
          label="Role"
          value={ROLE_LABELS[profile.role] ?? profile.role}
          note="Roles are assigned by an administrator and cannot be changed here."
        />

        <Field
          id="avatarUrl"
          label="Avatar URL"
          type="url"
          inputMode="url"
          maxLength={500}
          placeholder="https://…"
          hint="A link to an image. Leave empty to use your initials."
          defaultValue={profile.avatarUrl ?? ""}
        />

        <TextAreaField
          id="bio"
          label="Short bio"
          maxLength={2000}
          hint="Up to 2000 characters."
          defaultValue={profile.bio ?? ""}
        />

        <Field
          id="githubProfile"
          label="GitHub profile"
          type="url"
          inputMode="url"
          maxLength={255}
          placeholder="https://github.com/your-handle"
          defaultValue={profile.githubProfile ?? ""}
        />

        <Field
          id="linkedinProfile"
          label="LinkedIn profile"
          type="url"
          inputMode="url"
          maxLength={255}
          placeholder="https://www.linkedin.com/in/your-handle"
          defaultValue={profile.linkedinProfile ?? ""}
        />

        <div>
          <Button type="submit" data-testid="save-profile">
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}
