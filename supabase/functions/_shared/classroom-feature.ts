export function canEnterOnlineClass(
  globalEnabled: boolean,
  schoolEnabled: boolean,
  isPlatformAdmin = false,
): boolean {
  return isPlatformAdmin || (globalEnabled && schoolEnabled);
}
