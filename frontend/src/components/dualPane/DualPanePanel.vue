<template>
  <!-- click.stop keeps ListingView's window click handler from clearing the left selection; the
       capture-phase contextmenu runs before the rows' own handler, which opens the app's menu -->
  <section
    class="dual-pane-right"
    :class="{ 'is-active': isActive }"
    :aria-label="$t('dualPane.pane')"
    @click.stop
    @contextmenu.capture.prevent.stop="onContextMenu"
    @keydown="onKeydown"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="cancelLongPress"
    @touchend="cancelLongPress"
  >
    <DualPanePathBar />
    <div class="dual-pane-header">
      <ListingHeader use-picker-sorting />
    </div>
    <DualPaneList ref="list" />
    <footer class="dual-pane-footer">
      <span class="dual-pane-footer-summary">{{ footerText }}</span>
      <!-- Commander function keys; they act on the active pane, like the keys themselves -->
      <div class="dual-pane-keybar" role="toolbar" :aria-label="$t('help.functionKeys')">
        <button
          v-for="key in functionKeys"
          :key="key.command"
          type="button"
          class="dual-pane-keybar-button"
          :title="key.title"
          :aria-label="key.label"
          @mousedown.prevent
          @click="runKey(key.command)"
        >
          <kbd>{{ key.key }}</kbd>
          <span class="dual-pane-keybar-label">{{ key.label }}</span>
        </button>
      </div>
    </footer>
    <!-- In <body>, so its backdrop covers the header and sidebar too -->
    <Teleport to="body">
      <DualPaneMenu v-if="menuOpen" />
    </Teleport>
  </section>
</template>

<script>
import { computed } from "vue";
import { getters } from "@/store";
import ListingHeader from "@/components/files/ListingHeader.vue";
import DualPaneList from "@/components/dualPane/DualPaneList.vue";
import DualPaneMenu from "@/components/dualPane/DualPaneMenu.vue";
import DualPanePathBar from "@/components/dualPane/DualPanePathBar.vue";
import { dualPane, rightSelection, rightViewMode, setActivePane } from "@/store/dualPane.js";
import { dualPaneCommands } from "@/utils/dualPane/commands.js";
import { getHumanReadableFilesize } from "@/utils/filesizes";
import { paneSummary } from "@/utils/dualPane/paneModel.js";

const LONG_PRESS_MS = 500;
// Keys a focused toolbar button or sort header handles natively; the left listing must not see them
const CONTROL_KEYS = new Set([" ", "Enter"]);

export default {
  name: "DualPanePanel",
  components: { ListingHeader, DualPaneList, DualPaneMenu, DualPanePathBar },
  // The header, rows and icons follow this folder's layout rather than the main listing's
  provide: () => ({ listingViewMode: computed(rightViewMode) }),
  data: () => ({
    longPressTimer: null,
  }),
  computed: {
    isActive() {
      return dualPane.active === "right";
    },
    menuOpen() {
      return Boolean(dualPane.menu);
    },
    functionKeys() {
      const t = (key) => this.$t(key, { suffix: "" });
      return [
        { key: "F5", command: "copyToOther", label: t("general.copy") },
        { key: "F6", command: "moveToOther", label: t("general.move") },
        { key: "F7", command: "newFolderInActive", label: t("files.newFolder") },
        { key: "F8", command: "deleteInActive", label: t("general.delete") },
      ].map((entry) => ({ ...entry, title: `${entry.key} ${entry.label}` }));
    },
    footerText() {
      const right = dualPane.right;
      const summary = paneSummary(right.entries, right.selected);
      if (summary.selectedCount > 0) {
        const label = summary.selectedCount === 1 ? this.$t("general.selectionSingle") : this.$t("general.selectionMultiple");
        return `${summary.selectedCount} ${label} (${getHumanReadableFilesize(summary.selectedBytes)})`;
      }
      if (summary.dirs === 0 && summary.files === 0) {
        return "";
      }
      const parts = [];
      if (summary.dirs > 0) {
        parts.push(`${summary.dirs} ${summary.dirs === 1 ? this.$t("general.folder") : this.$t("general.folders")}`);
      }
      if (summary.files > 0) {
        parts.push(`${summary.files} ${summary.files === 1 ? this.$t("general.file") : this.$t("general.files")}`);
      }
      return `${parts.join(" | ")} (${getHumanReadableFilesize(summary.bytes)})`;
    },
  },
  beforeUnmount() {
    this.cancelLongPress();
  },
  methods: {
    runKey(command) {
      if (getters.currentPromptName()) return;
      dualPaneCommands[command]({});
    },
    focusList() {
      this.$refs.list?.focus();
    },
    onKeydown(event) {
      // An open prompt handles Enter itself (Prompts.vue); a button focused behind it must not
      if (getters.currentPromptName()) return;
      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      const isControl = tag === "button" || tag === "a" || target?.getAttribute?.("role") === "button";
      if (isControl && CONTROL_KEYS.has(event.key) && !target.closest(".listing-item")) {
        event.stopPropagation();
      }
    },
    openMenuAt(x, y, row) {
      setActivePane("right");
      const entry = dualPane.right.entries.find((candidate) => candidate.path === row?.dataset.path);
      const onEntry = Boolean(entry) && !entry.isParent;
      if (onEntry && !dualPane.right.selected.includes(entry.path)) {
        // Act on the row under the pointer unless it is already part of the selection
        rightSelection.selectOnly(entry.path);
      } else if (onEntry) {
        rightSelection.setCursor(entry.path);
      }
      dualPane.menu = { x, y, onEntry };
    },
    onContextMenu(event) {
      const row = event.target.closest?.(".listing-item");
      this.openMenuAt(event.clientX, event.clientY, row);
    },
    onTouchStart(event) {
      this.cancelLongPress();
      const touch = event.touches?.[0];
      const row = event.target.closest?.(".listing-item");
      if (!touch) return;
      this.longPressTimer = setTimeout(() => this.openMenuAt(touch.clientX, touch.clientY, row), LONG_PRESS_MS);
    },
    cancelLongPress() {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    },
  },
};
</script>
