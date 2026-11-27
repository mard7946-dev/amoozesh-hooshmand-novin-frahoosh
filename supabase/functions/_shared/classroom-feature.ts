export function canEnterOnlineClass(
  globalEnabled: boolean,
  schoolEnabled: boolean,
  isPlatformAdmin = false,
): boolean {
  // School-level shutdown applies to every signed-in role, including platform admins.
  // Only the global platform switch and this school's explicit flag may grant entry.
  return globalEnabled === true && schoolEnabled === true;
}
