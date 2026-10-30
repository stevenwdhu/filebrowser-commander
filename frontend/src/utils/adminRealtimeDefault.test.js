import { describe, expect, it } from "vitest";
import UserEdit from "@/components/prompts/UserEdit.vue?raw";
import { withAdminRealtimeDefault } from "./adminRealtimeDefault.js";

describe("withAdminRealtimeDefault", () => {
  const plain = { admin: false, share: true, api: false, realtime: false };

  it("switches Realtime on when Admin is switched on", () => {
    expect(withAdminRealtimeDefault(plain, "permissions.admin", true)).toEqual({ ...plain, realtime: true });
  });

  it("leaves everything else alone", () => {
    const admin = { ...plain, admin: true };
    expect(withAdminRealtimeDefault(admin, "permissions.admin", true)).toBe(admin); // already an admin
    expect(withAdminRealtimeDefault(admin, "permissions.admin", false)).toBe(admin); // demoted
    expect(withAdminRealtimeDefault(admin, "permissions.realtime", false)).toBe(admin); // its own toggle
    expect(withAdminRealtimeDefault(plain, "permissions.share", true)).toBe(plain);
    expect(withAdminRealtimeDefault(undefined, "permissions.admin", true)).toEqual({ realtime: true });
  });

  // Rebase tripwire: upstream's user form applies it before each account toggle change
  it("is still applied by the user form", () => {
    expect(UserEdit).toMatch(
      /onEditAccountChange\(field, value\) \{\s*this\.editAccount\.permissions = withAdminRealtimeDefault\(this\.editAccount\.permissions, field, value\);\s*this\.applyEditAccountField\(field, value\);/,
    );
  });
});
