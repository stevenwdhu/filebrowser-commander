package cmd

import (
	"path/filepath"
	"testing"

	"github.com/gtsteffaniak/filebrowser/backend/internal/app"
	"github.com/gtsteffaniak/filebrowser/backend/internal/state"
	"github.com/gtsteffaniak/filebrowser/backend/pkg/settings"
)

// FileBrowser Commander: the admin reset from adminPassword in the config, which runs at every
// start, keeps the admin's own Realtime choice.
func TestAdminPasswordResetKeepsAdminRealtimeChoice(t *testing.T) {
	t.Setenv("FILEBROWSER_ONLYOFFICE_SECRET", "")
	settings.Initialize("../../_docker/src/sharing/backend/config.yaml") // sets auth.adminPassword
	settings.Env.IsPlaywright = true
	if !settings.ConfigTriggersAdminPasswordReset() {
		t.Fatal("expected the test config to reset the admin at startup")
	}

	dbPath := filepath.Join(t.TempDir(), "filebrowser.sqlite")
	if _, err := state.Initialize(dbPath); err != nil {
		t.Fatal(err)
	}
	app.MustWireServices(state.Default())
	t.Cleanup(func() { _ = state.Close() })

	validateUserInfo(true)
	admin, err := state.GetUserByUsername("admin")
	if err != nil {
		t.Fatal(err)
	}
	if !admin.Permissions.Admin || !admin.Permissions.Realtime {
		t.Fatalf("expected the admin to start with Realtime on; perms=%+v", admin.Permissions)
	}

	admin.Permissions.Realtime = false
	if err = state.UpdateUser(&admin, "", "permissions"); err != nil {
		t.Fatal(err)
	}
	validateUserInfo(false) // the next start
	admin, err = state.GetUserByUsername("admin")
	if err != nil {
		t.Fatal(err)
	}
	if admin.Permissions.Realtime {
		t.Fatalf("the admin reset turned the admin's Realtime back on; perms=%+v", admin.Permissions)
	}
	if !admin.Permissions.Admin || !admin.Permissions.Share || !admin.Permissions.Api {
		t.Fatalf("the admin reset should still restore the other admin permissions; perms=%+v", admin.Permissions)
	}
}
