import "server-only";

export const PROFILE_AVATAR_IDS = ["avatar-01"] as const;
export type ProfileAvatarId = (typeof PROFILE_AVATAR_IDS)[number];

export function getProfileAvatar(jellyfinUserId: string): ProfileAvatarId {
  if (!jellyfinUserId || jellyfinUserId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(jellyfinUserId)) {
    throw new Error("Invalid Jellyfin user identity.");
  }
  return "avatar-01";
}
