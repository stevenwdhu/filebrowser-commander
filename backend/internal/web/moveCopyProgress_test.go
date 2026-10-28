package web

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gtsteffaniak/filebrowser/backend/internal/database/users"
)

type sentProgress struct {
	events []moveCopyProgressEvent
	users  [][]string
}

func (s *sentProgress) send(eventType, message string, to []string) {
	if eventType != "moveCopyProgress" {
		return
	}
	var event moveCopyProgressEvent
	if err := json.Unmarshal([]byte(message), &event); err != nil {
		panic(err)
	}
	s.events = append(s.events, event)
	s.users = append(s.users, to)
}

func (s *sentProgress) last() moveCopyProgressEvent {
	return s.events[len(s.events)-1]
}

func writeBytes(t *testing.T, path string, size int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", size)), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestMoveCopyProgressFollowsEachItem(t *testing.T) {
	dir := t.TempDir()
	writeBytes(t, filepath.Join(dir, "a.bin"), 100)
	writeBytes(t, filepath.Join(dir, "c", "one"), 30)
	writeBytes(t, filepath.Join(dir, "c", "sub", "two"), 20)

	sent := &sentProgress{}
	p := &moveCopyProgress{id: "op1", username: "alice", totalItems: 3, send: sent.send}

	p.next("a.bin")
	if len(sent.events) != 1 || sent.last() != (moveCopyProgressEvent{ID: "op1", TotalItems: 3, Current: "a.bin"}) {
		t.Fatalf("first event = %+v", sent.events)
	}
	if strings.Join(sent.users[0], ",") != "alice" {
		t.Fatalf("sent to %v, want only the requesting user", sent.users[0])
	}

	copying := p.copyProgress()
	copying.Start(filepath.Join(dir, "a.bin"))
	copying.Wrote(60)
	if len(sent.events) != 1 {
		t.Fatalf("reports within %v should wait, sent %d", moveCopyProgressInterval, len(sent.events))
	}
	copying.Wrote(60) // the file grew while it was copied: still no more than its size
	if p.size != 100 || p.copied != 100 {
		t.Fatalf("copied %d of %d, want 100 of 100", p.copied, p.size)
	}
	// ...and its last bytes go out at once
	if len(sent.events) != 2 || sent.last().Copied != 100 {
		t.Fatalf("the item's last bytes should be sent straight away: %+v", sent.events)
	}

	p.next("b") // a rename: never sized
	p.next("c")
	p.lastSent = time.Now().Add(-time.Second)
	copying.Start(filepath.Join(dir, "c"))
	if got := sent.last(); got != (moveCopyProgressEvent{ID: "op1", Items: 2, TotalItems: 3, Current: "c", Size: 50, Bytes: 120}) {
		t.Fatalf("a folder is sized when its copy starts, and the request's bytes keep counting: %+v", got)
	}

	// The last state always goes out, however soon after the one before
	copying.Wrote(20)
	p.finish()
	if got := sent.last(); got != (moveCopyProgressEvent{ID: "op1", Items: 3, TotalItems: 3, Bytes: 140}) {
		t.Fatalf("final event = %+v, want every byte written, even past an item's size", got)
	}
}

func TestMoveCopyProgressIsOffUnlessAskedAndReceivable(t *testing.T) {
	realtime := &users.User{FrontendUser: users.FrontendUser{Username: "alice", Permissions: users.Permissions{Realtime: true}}}
	admin := &users.User{FrontendUser: users.FrontendUser{Username: "root", Permissions: users.Permissions{Admin: true}}}
	plain := &users.User{FrontendUser: users.FrontendUser{Username: "bob"}}
	copyWithID := MoveCopyRequest{Action: "copy", ProgressID: "op1"}

	var off *moveCopyProgress
	off.next("a")
	off.finish()
	if off.copyProgress() != nil {
		t.Fatal("no progress means nothing to follow, so the copy stays a single io.Copy")
	}

	for name, tc := range map[string]struct {
		ctx *Context
		req MoveCopyRequest
	}{
		"no id":                 {&Context{User: realtime}, MoveCopyRequest{Action: "copy"}},
		"id too long":           {&Context{User: realtime}, MoveCopyRequest{Action: "copy", ProgressID: strings.Repeat("x", maxProgressIDLength+1)}},
		"rename":                {&Context{User: realtime}, MoveCopyRequest{Action: "rename", ProgressID: "op1"}},
		"share":                 {shareContext(realtime), copyWithID},
		"without user":          {&Context{}, copyWithID},
		"no realtime, no admin": {&Context{User: plain}, copyWithID},
	} {
		if newMoveCopyProgress(tc.ctx, tc.req) != nil {
			t.Errorf("%s: progress should be off", name)
		}
	}
	for name, user := range map[string]*users.User{"realtime": realtime, "admin": admin} {
		if newMoveCopyProgress(&Context{User: user}, copyWithID) == nil {
			t.Errorf("%s: a copy with an id gets progress", name)
		}
	}
}

func shareContext(user *users.User) *Context {
	d := &Context{User: user}
	d.Share.Hash = "abc"
	return d
}

func TestTreeBytes(t *testing.T) {
	dir := t.TempDir()
	writeBytes(t, filepath.Join(dir, "a"), 10)
	writeBytes(t, filepath.Join(dir, "sub", "b"), 5)
	// Copied as a link, so it counts for nothing
	if err := os.Symlink("a", filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	if got := treeBytes(dir); got != 15 {
		t.Fatalf("folder = %d bytes, want 15", got)
	}
	if got := treeBytes(filepath.Join(dir, "a")); got != 10 {
		t.Fatalf("file = %d bytes, want 10", got)
	}
	if got := treeBytes(filepath.Join(dir, "missing")); got != 0 {
		t.Fatalf("missing = %d bytes, want 0", got)
	}
}
