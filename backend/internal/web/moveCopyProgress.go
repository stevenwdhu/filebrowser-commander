package web

import (
	"encoding/json"
	"io/fs"
	"path/filepath"
	"time"

	"github.com/gtsteffaniak/filebrowser/backend/internal/adapters/fs/fileutils"
	"github.com/gtsteffaniak/filebrowser/backend/internal/events"
)

// moveCopyProgressInterval is how often a copy's progress is sent at most.
const moveCopyProgressInterval = 250 * time.Millisecond

// maxProgressIDLength bounds the id a client picks for its request.
const maxProgressIDLength = 64

// moveCopyProgressEvent is the "moveCopyProgress" event on /api/events.
type moveCopyProgressEvent struct {
	ID         string `json:"id"`
	Items      int    `json:"items"` // items of the request finished, whether they were copied or not
	TotalItems int    `json:"totalItems"`
	Current    string `json:"current"` // name of the item being processed
	Copied     int64  `json:"copied"`  // bytes of the current item copied so far
	Size       int64  `json:"size"`    // bytes the current item's copy will write; 0 until known, and for a rename
	Bytes      int64  `json:"bytes"`   // bytes written by this request so far, over all its items
}

// moveCopyProgress sends a copy or move's progress to the requesting user's open pages. The handler
// drives it from its own goroutine, one request item after another; a nil one does nothing.
type moveCopyProgress struct {
	id         string
	username   string
	totalItems int
	finished   int
	started    bool
	current    string
	copied     int64
	size       int64
	written    int64
	lastSent   time.Time
	send       func(eventType, message string, users []string)
}

// newMoveCopyProgress returns nil unless the client asked for progress and can receive it: shares
// have no event stream, and /api/events needs the realtime permission or admin.
func newMoveCopyProgress(d *Context, req MoveCopyRequest) *moveCopyProgress {
	if req.ProgressID == "" || len(req.ProgressID) > maxProgressIDLength || d.Share.Hash != "" || d.User == nil {
		return nil
	}
	if req.Action != "copy" && req.Action != "move" {
		return nil
	}
	if !d.User.Permissions.Realtime && !d.User.Permissions.Admin {
		return nil
	}
	return &moveCopyProgress{
		id:         req.ProgressID,
		username:   d.User.Username,
		totalItems: len(req.Items),
		send:       events.TrySendToUsers,
	}
}

// next marks the previous item as finished, whether it was copied, renamed or refused, and starts
// the next one.
func (p *moveCopyProgress) next(name string) {
	if p == nil {
		return
	}
	if p.started {
		p.finished++
	}
	p.started = true
	p.current = name
	p.copied = 0
	p.size = 0
	p.report(false)
}

// copyProgress follows the current item's copy. A move only calls it when it falls back to
// copying, so a rename is never sized. Nil without progress, so the copy stays a single io.Copy.
func (p *moveCopyProgress) copyProgress() *fileutils.CopyProgress {
	if p == nil {
		return nil
	}
	return &fileutils.CopyProgress{
		// Sized here, after the handler's checks, from the path it really copies
		Start: func(source string) {
			p.size = treeBytes(source)
			p.copied = 0
			p.report(false)
		},
		Wrote: func(written int64) {
			p.written += written
			// A file that grows while it's copied mustn't run past its size (this package has its own min)
			p.copied += written
			if p.copied > p.size {
				p.copied = p.size
			}
			// The last bytes always go out: the page then knows the item is written, even if the server
			// still has work on it, such as deleting a moved folder's source
			p.report(p.copied >= p.size)
		},
	}
}

// finish marks the last item as finished and sends the final state.
func (p *moveCopyProgress) finish() {
	if p == nil {
		return
	}
	if p.started {
		p.finished++
	}
	p.started = false
	p.current = ""
	p.copied = 0
	p.size = 0
	p.report(true)
}

func (p *moveCopyProgress) report(force bool) {
	now := time.Now()
	if !force && now.Sub(p.lastSent) < moveCopyProgressInterval {
		return
	}
	p.lastSent = now
	message, err := json.Marshal(moveCopyProgressEvent{
		ID:         p.id,
		Items:      p.finished,
		TotalItems: p.totalItems,
		Current:    p.current,
		Copied:     p.copied,
		Size:       p.size,
		Bytes:      p.written,
	})
	if err != nil {
		return
	}
	p.send("moveCopyProgress", string(message), []string{p.username})
}

// treeBytes is the size of a file, or of the regular files under a folder. Links are copied as
// links, so they count for nothing; anything unreadable is skipped.
func treeBytes(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.Type().IsRegular() {
			return nil
		}
		if info, infoErr := entry.Info(); infoErr == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}
