package fileutils

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func shrinkCopyChunks(t *testing.T, size int64) {
	t.Helper()
	old := copyChunkSize
	copyChunkSize = size
	t.Cleanup(func() { copyChunkSize = old })
}

func TestCopyFileWithProgressReportsEachChunk(t *testing.T) {
	shrinkCopyChunks(t, 1000)
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	big := bytes.Repeat([]byte("x"), 2500)
	if err := os.WriteFile(filepath.Join(src, "big"), big, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "small"), []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Copied as a link, so no bytes
	if err := os.Symlink("big", filepath.Join(src, "link")); err != nil {
		t.Fatal(err)
	}

	var reports []int64
	var started []string
	dst := filepath.Join(dir, "dst")
	progress := &CopyProgress{
		Start: func(source string) { started = append(started, source) },
		Wrote: func(n int64) { reports = append(reports, n) },
	}
	if err := CopyFileWithProgress(src, dst, progress); err != nil {
		t.Fatal(err)
	}
	if len(started) != 1 || started[0] != src {
		t.Fatalf("started = %v, want the folder once, before its data", started)
	}
	want := []int64{1000, 1000, 500, 10}
	if len(reports) != len(want) {
		t.Fatalf("reports = %v, want %v", reports, want)
	}
	for i := range want {
		if reports[i] != want[i] {
			t.Fatalf("reports = %v, want %v", reports, want)
		}
	}
	got, err := os.ReadFile(filepath.Join(dst, "big"))
	if err != nil || !bytes.Equal(got, big) {
		t.Fatalf("big copied wrong: %v (%d bytes)", err, len(got))
	}
	if target, err := os.Readlink(filepath.Join(dst, "link")); err != nil || target != "big" {
		t.Fatalf("link = %q, %v", target, err)
	}
}

func TestCopyFileContentsWithProgressFallsBackAfterBadFileDescriptor(t *testing.T) {
	shrinkCopyChunks(t, 8)
	const content = "complete file contents"
	src := struct{ io.Reader }{bytes.NewBufferString(content)}
	dst := &copyFileRangeRejectingWriter{}

	var total int64
	if err := copyFileContentsWithProgress(dst, src, func(n int64) { total += n }); err != nil {
		t.Fatal(err)
	}
	if got := dst.String(); got != content {
		t.Fatalf("copied contents = %q, want %q", got, content)
	}
	if total != int64(len(content)) {
		t.Fatalf("reported %d bytes, want %d", total, len(content))
	}
	if dst.readFromCalls != 1 {
		t.Fatalf("ReadFrom calls = %d, want 1", dst.readFromCalls)
	}
}

// underreportingWriter's ReadFrom copies the whole chunk but, like os.File.ReadFrom when
// copy_file_range fails partway and buffered I/O finishes the job, counts only the second part.
type underreportingWriter struct {
	bytes.Buffer
}

func (w *underreportingWriter) ReadFrom(r io.Reader) (int64, error) {
	head := make([]byte, 3)
	n, _ := io.ReadFull(r, head)
	_, _ = w.Write(head[:n])
	return io.Copy(&w.Buffer, r)
}

func TestCopyFileContentsWithProgressCopiesAllWhenReadFromUnderreports(t *testing.T) {
	shrinkCopyChunks(t, 8)
	const content = "complete file contents"
	var total int64
	dst := &underreportingWriter{}
	if err := copyFileContentsWithProgress(dst, bytes.NewBufferString(content), func(n int64) { total += n }); err != nil {
		t.Fatal(err)
	}
	if got := dst.String(); got != content {
		t.Fatalf("copied %q, want %q: a short count must not end the copy", got, content)
	}
	if total != int64(len(content)) {
		t.Fatalf("reported %d bytes, want %d", total, len(content))
	}
}

func TestMoveFileWithProgressRenamesWithoutCopying(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(src, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	reported := false
	progress := &CopyProgress{Start: func(string) { reported = true }, Wrote: func(int64) { reported = true }}
	if err := MoveFileWithProgress(src, filepath.Join(dir, "b.txt"), progress); err != nil {
		t.Fatal(err)
	}
	if reported {
		t.Fatal("a rename copies nothing, so it reports nothing")
	}
}
