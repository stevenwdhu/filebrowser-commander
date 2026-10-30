package state

import (
	"errors"

	"github.com/gtsteffaniak/filebrowser/backend/internal/database/sqldb"
	"github.com/gtsteffaniak/filebrowser/backend/internal/database/users"
	"github.com/gtsteffaniak/go-logger/logger"
)

// FileBrowser Commander: admins have the Realtime permission by default, so they get live updates
// and copy/move progress without finding the toggle. Everyone keeps the toggle, and an admin that
// turns it off keeps it off.

// adminRealtimeDefaultedSettingKey records that the admins already in the database got Realtime once.
const adminRealtimeDefaultedSettingKey = "commanderAdminRealtimeDefaulted"

// applyAdminRealtimeDefault turns Realtime on for an account that becomes an admin: one created
// as an admin (before is nil) or promoted. Saving an admin that stays one keeps its choice.
// Enforced user defaults skip admins, so a demoted account takes an enforced Realtime value again;
// otherwise the save would be refused as not matching it.
func applyAdminRealtimeDefault(before, after *users.User) {
	wasAdmin := before != nil && before.Permissions.Admin
	switch {
	case after.Permissions.Admin && !wasAdmin:
		after.Permissions.Realtime = true
	case wasAdmin && !after.Permissions.Admin && EffectiveEnforced().Account.Permissions.Realtime:
		after.Permissions.Realtime = EffectiveUserDefaults().Account.Permissions.Realtime
	}
}

// turnOnRealtimeForExistingAdminsOnce gives the admins already in the database Realtime the first
// time it runs on that database, e.g. an admin carried over from FileBrowser Quantum, which starts
// without it. Later changes to the toggle are kept. A failure is logged and retried on the next
// start rather than stopping this one.
func turnOnRealtimeForExistingAdminsOnce() {
	if _, err := sqlDb.GetSetting(adminRealtimeDefaultedSettingKey); err == nil {
		return
	} else if !errors.Is(err, sqldb.ErrSettingNotFound) {
		logger.Errorf("failed to read the admin Realtime marker: %v", err)
		return
	}
	all, err := sqlDb.ListUsers()
	if err != nil {
		logger.Errorf("failed to list users to turn on Realtime for admins: %v", err)
		return
	}
	for _, user := range all {
		if !user.Permissions.Admin || user.Permissions.Realtime {
			continue
		}
		user.Permissions.Realtime = true
		if err := sqlDb.UpdateUser(user); err != nil {
			logger.Errorf("failed to turn on Realtime for admin %q: %v", user.Username, err)
			return
		}
		deleteUserFromCache(user)
		logger.Infof("Turned on real-time connections for admin %q (once; it can be turned off in its permissions)", user.Username)
	}
	if err := sqlDb.SaveSetting(adminRealtimeDefaultedSettingKey, true); err != nil {
		logger.Errorf("failed to save the admin Realtime marker: %v", err)
	}
}
