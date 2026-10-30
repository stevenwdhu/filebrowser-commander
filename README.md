# FileBrowser Commander

A two-pane, keyboard-driven web file manager in the style of Total Commander, built on
[FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser).

> [!NOTE]
> FileBrowser Commander is a personal fork of FileBrowser Quantum. It's built on FileBrowser
> Quantum's main branch, which is its beta channel, and rebased onto it as that moves. Everything
> else (sources, users, sharing, search, previews, the API and `config.yaml`) works as in
> FileBrowser Quantum, and [its docs](https://filebrowserquantum.com/) cover it. This fork isn't
> affiliated with that project, so please don't report its problems upstream.

## Why

Many SMB and SFTP clients copy between two folders on a NAS by downloading every byte and
uploading it again. FileBrowser Quantum copies and moves on the NAS itself, so the data never
crosses the network. This fork puts that behind a two-pane, Total Commander-style layout with the
usual keys.

## What it adds

**Two panes**

- `Ctrl+\` or the header button opens a second pane beside the listing. `Tab` switches between
  them once you've clicked into a pane.
- Each pane has a path bar with a source picker, a `..` row, keyboard navigation and a
  right-click menu (the second pane's is shorter). Each folder shows in its own saved view: list,
  compact, normal, icons or gallery.
- `F5` and `F6` open the copy or move prompt for the active pane's selection, aimed at the other
  pane's folder. `F7` makes a folder and `F8` deletes.
- Dragging between the panes opens the same prompt. `Ctrl`/`Alt` copies and `Shift`/`Cmd` moves;
  otherwise it moves within a source and copies across sources.
- A bottom bar holds the F5–F8 buttons and the size slider, and each pane has a status line with
  its counts and size.
- `F1` lists the keys. Two panes need a window at least 1024px wide, with 640px left beside a
  pinned sidebar. Otherwise, and in shares, the layout stays single-pane.

**Copy and move**

These apply to every copy and move done through the prompt (`F5`, `F6`, a drag between the
panes, or Copy or Move in a menu), with one pane or two. Pasting, and dragging onto a folder in the
main listing, work as in FileBrowser Quantum.

- The prompt shows what's being copied or moved and where, and says why it can't go ahead, for
  example a folder into its own subfolder.
- The destination is picked in the prompt itself: switch source, click a folder in the path, type
  a path, or pick one of your Favorites (your sidebar's folder links) or one of the last 8
  destinations you used in this browser.
- While it runs, the prompt shows the time elapsed and the items done. When data is really copied
  (a copy, or a move between datasets, disks or separately mounted folders), it also shows the
  current item's bytes, the speed and the time left. Any other move is a rename and finishes at
  once.
- Bytes, speed and time left need the Realtime permission ("Enable real-time connections and
  updates"). Admins have it by default; for other users, an admin turns it on.
- Copies still use `copy_file_range`, so ZFS block cloning still works where the pool has it on.

**Smaller changes**

- The app calls itself FileBrowser Commander. Internal names, such as the login cookie, stay
  upstream's.
- Admins get the Realtime permission: any account that becomes an admin, and, once, the admins
  already there when you upgrade, such as one from FileBrowser Quantum. They can turn it off.
- The published image is built without upstream's opt-in usage reporting, shows its version as
  `commander-<commit>`, and doesn't offer FileBrowser Quantum's updates.

## Run it

Images are on GitHub's registry as `ghcr.io/stevenwdhu/filebrowser-commander`, for linux/amd64
only. `latest` is the newest build of `main`, and a tag such as `sha-1a2b3c4` pins the build whose
version shows as `commander-1a2b3c4`.

1. Make a data folder with a `config.yaml` in it. The server won't start without one. This is
   enough to begin with, and the [configuration docs](https://filebrowserquantum.com/en/docs/configuration/)
   have the rest:

   ```yaml
   server:
     sources:
       - path: /srv
   ```

2. Start it, for example with Docker Compose:

   ```yaml
   services:
     filebrowser-commander:
       image: ghcr.io/stevenwdhu/filebrowser-commander:latest
       ports:
         - "8080:80"
       volumes:
         - ./data:/home/filebrowser/data # config.yaml and the database
         - /path/to/files:/srv # what to browse
       restart: unless-stopped
   ```

   The container runs as user 1000, which needs write access to both folders. On an Apple Silicon
   Mac, add `platform: linux/amd64` to the service to run it under emulation; other ARM machines
   need amd64 emulation (QEMU) set up first.

3. Go to port 8080 on that machine (http://localhost:8080 locally) and sign in as `admin` with
   the password the first start prints: `docker compose logs | grep 'admin password'`. You'll choose
   your own then. It's printed only once, so if you lose it before signing in, stop the
   container, delete `data/database.sqlite*` and start again.

## Develop

`make setup` and `make dev` run it locally with hot reload, as in FileBrowser Quantum. A plain
`docker build -f _docker/Dockerfile .` keeps upstream's usage reporting and has no version;
[commander-image.yaml](.github/workflows/commander-image.yaml) shows how the published image is
built.

The two-pane code is mostly in its own files, such as `frontend/src/components/dualPane/`,
`frontend/src/store/dualPane.js` and `frontend/src/css/dualPane.css`, with small hooks into
upstream files. `frontend/src/components/dualPane/upstreamContract.test.js` checks the upstream
markup and code those hooks rely on, so a rebase that changes them fails the tests. The copy and
move changes edit upstream's `MoveCopy.vue`, `FileList.vue` and the server's copy code directly.

## License

Apache License 2.0, like FileBrowser Quantum; see [LICENSE](LICENSE).
