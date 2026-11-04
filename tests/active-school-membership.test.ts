import { hasActiveSchoolMembership } from "../supabase/functions/_shared/active-school-membership.ts";

function fakeAdmin(data: unknown[], error: unknown = null) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select(_columns: string) { return this; },
    eq(column: string, value: unknown) { filters[column] = value; return this; },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data, error }).then(resolve, reject);
    },
  };
  return {
    filters,
    admin: { from(table: string) { if (table !== "school_memberships") throw new Error("Unexpected table"); return builder; } },
  };
}

Deno.test("accepts only an active membership for the same user, school and role", async () => {
  const { admin, filters } = fakeAdmin([
    { role: "teacher", is_active: true },
    { role: "manager", is_active: false },
  ]);
  const allowed = await hasActiveSchoolMembership(admin, "user-a", "school-a", "TEACHER", value => String(value ?? "").trim().toLowerCase());
  if (!allowed) throw new Error("Expected active matching membership to be accepted");
  if (filters.auth_user_id !== "user-a" || filters.school_id !== "school-a" || filters.is_active !== true) {
    throw new Error("Membership query was not restricted to the authenticated user, school and active state");
  }
});

Deno.test("rejects inactive and wrong-role memberships", async () => {
  const inactive = fakeAdmin([{ role: "teacher", is_active: false }]);
  const wrongRole = fakeAdmin([{ role: "student", is_active: true }]);
  const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
  if (await hasActiveSchoolMembership(inactive.admin, "user-a", "school-a", "teacher", normalize)) {
    throw new Error("Inactive membership must be rejected");
  }
  if (await hasActiveSchoolMembership(wrongRole.admin, "user-a", "school-a", "teacher", normalize)) {
    throw new Error("Wrong-role membership must be rejected");
  }
});

Deno.test("fails closed when membership lookup errors", async () => {
  const { admin } = fakeAdmin([], { code: "42501", message: "permission denied" });
  let rejected = false;
  try {
    await hasActiveSchoolMembership(admin, "user-a", "school-a", "teacher", value => String(value ?? "").toLowerCase());
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Membership lookup errors must reject authorization");
});
