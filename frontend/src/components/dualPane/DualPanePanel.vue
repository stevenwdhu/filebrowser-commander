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
      <span>{{ footerText }}</span>
    </footer>
    <!-- In <body>, so its backdrop covers the header and sidebar too -->
    <Teleport to="body">
      <DualPaneMenu v-if="menuOpen" />
    </Teleport>
  </section>
</template>

<script>
import { computed } from "vue";
import ListingHeader from "@/components/files/ListingHeader.vue";
import DualPaneList from "@/components/dualPane/DualPaneList.vue";
import DualPaneMenu from "@/components/dualPane/DualPaneMenu.vue";
import DualPanePathBar from "@/components/dualPane/DualPanePathBar.vue";
import { dualPane, rightSelection, rightViewMode, setActivePane } from "@/store/dualPane.js";
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
    focusList() {
      this.$refs.list?.focus();
    },
    onKeydown(event) {
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
