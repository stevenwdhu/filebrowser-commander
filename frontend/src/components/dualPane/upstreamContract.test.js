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
import Scrollbar from "@/components/files/Scrollbar.vue?raw";
import Shelf from "@/components/Shelf.vue?raw";
import StatusBar from "@/components/StatusBar.vue?raw";
import PathPicker from "@/components/prompts/PathPicker.vue?raw";

// CSS ?raw imports come back empty under vitest
const baseCss = readFileSync(resolve(process.cwd(), "src/css/base.css"), "utf8");

describe("upstream contract for the dual pane", () => {
  it("mounts the host after #main and the toggle before the view switch", () => {
    expect(Layout).toMatch(/<Scrollbar id="main"[\s\S]*<\/Scrollbar>\s*<DualPaneHost v-if="isLoggedIn" \/>/);
    expect(DefaultBar).toMatch(/<DualPaneToggle \/>\s*<action\s+v-if="showHeaderSwitchView/);
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
    expect(ListingItem).toContain("application/x-filebrowser-internal-drag");
    // DualPaneHost watches state.reload synchronously because Files.vue resets it straight away
    expect(Files).toContain("mutations.setReload(false)");
    expect(PathPicker).toContain("selectionContextId");
    expect(PathPicker).toContain('eventBus.emit("pathSelected"');
  });
});
