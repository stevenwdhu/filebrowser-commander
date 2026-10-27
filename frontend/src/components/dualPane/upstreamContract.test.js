// Rebase tripwire: the dual pane hooks into upstream files by id, class and a few lines of markup.
// If upstream renames one of these, this fails before the layout quietly breaks.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import Files from "@/views/Files.vue?raw";
import Layout from "@/views/Layout.vue?raw";
import ListingView from "@/views/files/ListingView.vue?raw";
import DefaultBar from "@/views/bars/Default.vue?raw";
import ListingItem from "@/components/files/ListingItem.vue?raw";
import ListingHeader from "@/components/files/ListingHeader.vue?raw";
import Icon from "@/components/files/Icon.vue?raw";
import Scrollbar from "@/components/files/Scrollbar.vue?raw";
import Shelf from "@/components/Shelf.vue?raw";
import StatusBar from "@/components/StatusBar.vue?raw";
import PathPicker from "@/components/prompts/PathPicker.vue?raw";
import Help from "@/components/prompts/Help.vue?raw";
import Mutations from "@/store/mutations.ts?raw";
import Url from "@/utils/url.js?raw";

// CSS ?raw imports come back empty under vitest
const baseCss = readFileSync(resolve(process.cwd(), "src/css/base.css"), "utf8");

describe("upstream contract for the dual pane", () => {
  it("mounts the host after #main and the toggle before the view switch", () => {
    expect(Layout).toMatch(/<Scrollbar id="main"[\s\S]*<\/Scrollbar>\s*<DualPaneHost v-if="isLoggedIn" \/>/);
    expect(DefaultBar).toMatch(/<DualPaneToggle \/>\s*<action\s+v-if="showHeaderSwitchView/);
    expect(Help).toMatch(/<DualPaneHelpSection \/>\s*<\/div>\s*<\/div>\s*<div class="card-actions">/);
  });

  it("still positions the left pane's pieces the way dualPane.css overrides them", () => {
    expect(baseCss).toMatch(/#main \{[^}]*position: fixed;[^}]*width: 100%;/);
    expect(Shelf).toContain('id="shelf"');
    expect(StatusBar).toContain('id="status-bar"');
    expect(Scrollbar).toMatch(/\.thumb \{[^}]*position: fixed;/);
    expect(Scrollbar).toContain("thumb-section-id");
    expect(ListingView).toContain('this.width = document.getElementById("main")?.offsetWidth || window.innerWidth;');
  });

  it("keeps the row and refresh behaviour the right pane relies on", () => {
    // Fallthrough @click/@dblclick on rows needs ListingItem to declare no emits
    expect(ListingItem).not.toMatch(/\n {2}emits:/);
    expect(ListingItem).toContain(':data-index="index"');
    expect(ListingItem).toContain(':data-name="name"');
    // Pane drag and drop finds folder rows by these
    expect(ListingItem).toContain(':data-dir="isDir"');
    expect(ListingItem).toContain("application/x-filebrowser-internal-drag");
    // DualPaneHost watches state.reload synchronously because Files.vue resets it straight away
    expect(Files).toContain("mutations.setReload(false)");
    expect(PathPicker).toContain("selectionContextId");
    expect(PathPicker).toContain('eventBus.emit("pathSelected"');
  });

  it("lets the right pane's layout reach its rows, icons and header, and Switch view reach the pane", () => {
    for (const component of [ListingItem, Icon, ListingHeader]) {
      expect(component).toContain("inject: { listingViewMode: { default: null } },");
      // Every other read of the view mode goes through the component's own viewMode
      expect(component.match(/getters\.viewMode\(\)/g)).toHaveLength(1);
    }
    expect(DefaultBar).toContain("return icons[activePaneViewMode()]");
    expect(DefaultBar).toContain("const current = activePaneViewMode();");
    expect(DefaultBar).toMatch(/if \(saveActivePaneViewMode\(newViewMode\)\) return;\s*mutations\.updateDisplayPreferences\(\{ viewMode: newViewMode \}\);/);
    expect(Mutations).toContain("updateDisplayPreferences: (payload: Partial<DisplayPreference>, location?: { source: string; path: string }) => {");
    expect(Mutations).toContain("const path = location?.path ?? state.route.path;");
    // store/dualPane.js builds the same route path for the right pane's folder
    expect(Url).toMatch(/urlPath = `files\/\$\{encodeURIComponent\(source\)\}\/\$\{encodedPath\}`;/);
    expect(Url).toMatch(/export function encodePath\(str\) \{\s*return str\s*\.split\("\/"\)\s*\.map\(\(v\) => encodeURIComponent\(v\)\)\s*\.join\("\/"\);/);
    // Ctrl+F1-F3 act on the active pane too, and with both panes shown the size slider leaves the default alone
    expect(Files).toMatch(/if \(!saveActivePaneViewMode\(newViewMode\)\) \{\s*mutations\.updateDisplayPreferences/);
    expect(StatusBar).toContain("if (!dualPane.shown) void mutations.updateCurrentUser({ viewMode: newMode });");
    expect(StatusBar.match(/mutations\.updateCurrentUser\(/g)).toHaveLength(1);
    // The right pane's thumbnails outlive the main listing's route
    expect(Icon).toMatch(/routePath\(\) \{\s*\/\/[^\n]*\n\s*if \(this\.listingViewMode\) return;\s*this\.cancelActivePreviews\(\);/);
  });

  it("still sizes the layouts and picks them by size the way paneLayout.js copies", () => {
    for (const line of [
      "const baseSize = 20 + (size * 15); // 35px to 155px",
      "const cellSize = baseSize + 30;",
      "const baseCalc = 80 + (size * 25);",
      "const extraScaling = Math.max(0, size - 5) * 15;",
      "const iconFontSize = (3 + (size * 0.5)).toFixed(2); // 3em to 7.5em",
      "Math.round(baseSize * 1.2)",
      "? 40 + (size * 2)  // 42px to 58px",
      ": 50 + (size * 3); // 53px to 77px",
      "const iconSize = (2 + (size * 0.12)).toFixed(2); // 2.12em to 3.08em",
      "const iconFontSize = (1.5 + (size * 0.12)).toFixed(2); // 1.62em to 2.58em",
      "const iconSize = (3.2 + (size * 0.15)).toFixed(2); // 3.35em to 4.55em",
      "const iconFontSize = (2.2 + (size * 0.12)).toFixed(2); // 2.32em to 3.28em",
      "columnWidth: 250 + state.user.gallerySize * 50,",
    ]) {
      expect(ListingView).toContain(line);
    }
    expect(StatusBar).toMatch(/if \(currentMode === "gallery" \|\| currentMode === "icons"\) \{\s*if \(size <= 4\)/);
    expect(StatusBar).toMatch(/if \(currentMode === "list" \|\| currentMode === "compact"\) \{\s*if \(size <= 3\)/);
  });
});
