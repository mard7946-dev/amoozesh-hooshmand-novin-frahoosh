export async function hasActiveSchoolMembership(
  admin: any,
  authUserId: string,
  schoolId: string,
  role: string,
  normalizeRole: (value: unknown) => string,
): Promise<boolean> {
  const { data, error } = await admin.from("school_memberships")
    .select("role,is_active")
    .eq("auth_user_id", authUserId)
    .eq("school_id", schoolId)
    .eq("is_active", true);
  if (error) {
    console.error("active school membership lookup failed", JSON.stringify({
      code: error.code ?? null,
      message: error.message ?? null,
    }));
    throw error;
  }
  return (data ?? []).some((membership: any) =>
    membership.is_active === true && normalizeRole(membership.role) === normalizeRole(role)
  );
}
