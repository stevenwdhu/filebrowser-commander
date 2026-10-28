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
    <DualPaneStatusLine pane="right" />
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
import DualPaneStatusLine from "@/components/dualPane/DualPaneStatusLine.vue";
import { dualPane, rightSelection, rightViewMode, setActivePane } from "@/store/dualPane.js";

const LONG_PRESS_MS = 500;
// Keys a focused toolbar button or sort header handles natively; the left listing must not see them
const CONTROL_KEYS = new Set([" ", "Enter"]);

export default {
  name: "DualPanePanel",
  components: { ListingHeader, DualPaneList, DualPaneMenu, DualPanePathBar, DualPaneStatusLine },
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
  },
  beforeUnmount() {
    this.cancelLongPress();
  },
  methods: {
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
      // The status line has no menu, as the left pane's has none
      if (event.target.closest?.(".dual-pane-status")) return;
      const row = event.target.closest?.(".listing-item");
      this.openMenuAt(event.clientX, event.clientY, row);
    },
    onTouchStart(event) {
      this.cancelLongPress();
      const touch = event.touches?.[0];
      const row = event.target.closest?.(".listing-item");
      if (!touch || event.target.closest?.(".dual-pane-status")) return;
      this.longPressTimer = setTimeout(() => this.openMenuAt(touch.clientX, touch.clientY, row), LONG_PRESS_MS);
    },
    cancelLongPress() {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    },
  },
};
</script>
