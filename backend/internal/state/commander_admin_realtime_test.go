package state

import (
	"path/filepath"
	"testing"

	"github.com/gtsteffaniak/filebrowser/backend/internal/database/users"
	"github.com/gtsteffaniak/filebrowser/backend/pkg/settings"
)

func initAdminRealtimeTestDB(t *testing.T) string {
	t.Helper()
	t.Setenv("FILEBROWSER_ONLYOFFICE_SECRET", "")
	settings.Initialize("../../../_docker/src/noauth/backend/config.yaml")
	settings.Env.IsPlaywright = true

	dbPath := filepath.Join(t.TempDir(), "filebrowser.sqlite")
	if _, err := Initialize(dbPath); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = Close() })
	return dbPath
}

func realtimeOf(t *testing.T, username string) bool {
	t.Helper()
	loaded, err := GetUserByUsername(username)
	if err != nil {
		t.Fatal(err)
	}
	return loaded.Permissions.Realtime
}

func setPermissions(t *testing.T, id uint64, username string, perms users.Permissions) {
	t.Helper()
	patch := &users.User{ID: id, FrontendUser: users.FrontendUser{Username: username, Permissions: perms}}
	if err := UpdateUser(patch, "", "permissions"); err != nil {
		t.Fatal(err)
	}
}

// setRealtimeInStore writes Realtime straight to the database, as an older version left it.
func setRealtimeInStore(t *testing.T, username string, on bool) {
	t.Helper()
	stored, err := sqlDb.GetUserByUsername(username)
	if err != nil {
		t.Fatal(err)
	}
	stored.Permissions.Realtime = on
	if err := sqlDb.UpdateUser(stored); err != nil {
		t.Fatal(err)
	}
	deleteUserFromCache(stored)
}

func TestNewAdminGetsRealtime(t *testing.T) {
	initAdminRealtimeTestDB(t)

	admin := &users.User{FrontendUser: users.FrontendUser{Username: "new-admin", Permissions: users.Permissions{Admin: true}}}
	if err := CreateUser(admin, "password"); err != nil {
		t.Fatal(err)
	}
	if !realtimeOf(t, "new-admin") {
		t.Fatal("an account created as an admin should have Realtime")
	}

	plain := &users.User{FrontendUser: users.FrontendUser{Username: "new-user", Permissions: users.Permissions{Share: true}}}
	if err := CreateUser(plain, "password"); err != nil {
		t.Fatal(err)
	}
	if realtimeOf(t, "new-user") {
		t.Fatal("a non-admin account should keep Realtime off")
	}
}

func TestPromotedAdminGetsRealtimeAndKeepsItsChoice(t *testing.T) {
	initAdminRealtimeTestDB(t)

	user := &users.User{FrontendUser: users.FrontendUser{Username: "promoted", Permissions: users.Permissions{Share: true}}}
	if err := CreateUser(user, "password"); err != nil {
		t.Fatal(err)
	}
	if realtimeOf(t, "promoted") {
		t.Fatal("expected Realtime off before the promotion")
	}

	// Promoted, even when the same save leaves Realtime off
	setPermissions(t, user.ID, "promoted", users.Permissions{Admin: true, Share: true})
	if !realtimeOf(t, "promoted") {
		t.Fatal("an account promoted to admin should get Realtime")
	}

	// An admin that turns it off keeps it off
	setPermissions(t, user.ID, "promoted", users.Permissions{Admin: true, Share: true, Realtime: false})
	if realtimeOf(t, "promoted") {
		t.Fatal("an admin's own choice to turn Realtime off should be kept")
	}
	setPermissions(t, user.ID, "promoted", users.Permissions{Admin: true, Share: true, Api: true})
	if realtimeOf(t, "promoted") {
		t.Fatal("saving an admin's other permissions should not turn Realtime back on")
	}

	// Demoting leaves it as it was; promoting again turns it on
	setPermissions(t, user.ID, "promoted", users.Permissions{Share: true})
	if realtimeOf(t, "promoted") {
		t.Fatal("demoting should not turn Realtime on")
	}
	setPermissions(t, user.ID, "promoted", users.Permissions{Admin: true})
	if !realtimeOf(t, "promoted") {
		t.Fatal("promoting again should turn Realtime on")
	}
}

func TestDemotedAdminTakesEnforcedRealtime(t *testing.T) {
	initAdminRealtimeTestDB(t)
	// Realtime enforced for users, with the default (off)
	if err := PatchUserDefaultsEnforced([]byte(`{"account":{"permissions":{"realtime":true}}}`)); err != nil {
		t.Fatal(err)
	}

	admin := &users.User{FrontendUser: users.FrontendUser{Username: "enforced-admin", Permissions: users.Permissions{Admin: true}}}
	if err := CreateUser(admin, "password"); err != nil {
		t.Fatal(err)
	}
	if !realtimeOf(t, "enforced-admin") {
		t.Fatal("enforced defaults skip admins, so an admin should still get Realtime")
	}

	// As the user form and admin-group sync save a demotion: only Admin changes
	setPermissions(t, admin.ID, "enforced-admin", users.Permissions{Realtime: true})
	loaded, err := GetUserByUsername("enforced-admin")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Permissions.Admin || loaded.Permissions.Realtime {
		t.Fatalf("a demoted account should take the enforced Realtime value; perms=%+v", loaded.Permissions)
	}
}

func TestExistingAdminsGetRealtimeOnceAtStartup(t *testing.T) {
	dbPath := initAdminRealtimeTestDB(t)

	for _, u := range []*users.User{
		{FrontendUser: users.FrontendUser{Username: "old-admin", Permissions: users.Permissions{Admin: true}}},
		{FrontendUser: users.FrontendUser{Username: "old-user", Permissions: users.Permissions{Share: true}}},
	} {
		if err := CreateUser(u, "password"); err != nil {
			t.Fatal(err)
		}
	}
	// As a database from FileBrowser Quantum, or an earlier version, has them
	setRealtimeInStore(t, "old-admin", false)
	if err := sqlDb.DeleteSetting(adminRealtimeDefaultedSettingKey); err != nil {
		t.Fatal(err)
	}

	if err := Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Initialize(dbPath); err != nil {
		t.Fatal(err)
	}
	if !realtimeOf(t, "old-admin") {
		t.Fatal("an existing admin should get Realtime on the first start")
	}
	if realtimeOf(t, "old-user") {
		t.Fatal("an existing non-admin should keep Realtime off")
	}
	if _, err := sqlDb.GetSetting(adminRealtimeDefaultedSettingKey); err != nil {
		t.Fatalf("expected the marker after the first start: %v", err)
	}

	// Turned off afterwards, it stays off on later starts
	old, err := GetUserByUsername("old-admin")
	if err != nil {
		t.Fatal(err)
	}
	setPermissions(t, old.ID, "old-admin", users.Permissions{Admin: true, Realtime: false})
	if err := Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Initialize(dbPath); err != nil {
		t.Fatal(err)
	}
	if realtimeOf(t, "old-admin") {
		t.Fatal("a later start should keep an admin's choice to turn Realtime off")
	}
}
