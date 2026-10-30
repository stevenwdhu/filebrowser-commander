// FileBrowser Commander: an account switched to admin gets the Realtime permission, as the server
// gives it (backend/internal/state/commander_admin_realtime.go), so the user form shows what will
// be saved. Realtime stays a toggle: switched off again before saving, an existing admin keeps it
// off, while the server still turns it on for a new or promoted admin.

/** The form's permissions once `field` is set to `value`, before that change is applied. */
export function withAdminRealtimeDefault(permissions, field, value) {
  if (field !== "permissions.admin" || !value || permissions?.admin) {
    return permissions;
  }
  return { ...permissions, realtime: true };
}
