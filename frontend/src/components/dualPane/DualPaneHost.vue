<template>
  <template v-if="mountedPane">
    <DualPanePanel v-show="shown" />
    <div
      v-show="shown"
      class="dual-pane-divider"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :aria-label="$t('dualPane.resize')"
      :aria-valuenow="Math.round((1 - ratio) * 100)"
      aria-valuemin="25"
      aria-valuemax="75"
      @pointerdown="startResize"
      @click.stop
      @dblclick.stop="resetRatio"
      @keydown.left.prevent.stop="stepRatio(0.05)"
      @keydown.right.prevent.stop="stepRatio(-0.05)"
    ></div>
    <div
      v-show="shown && leftActive"
      class="dual-pane-left-indicator"
      :style="{ left: sidebarOffset }"
      aria-hidden="true"
    ></div>
  </template>
</template>

<script>
import "@/css/dualPane.css";
import { toRaw } from "vue";
import { getters, mutations, state } from "@/store";
import { normalizeDirPath } from "@/utils/moveCopyDestinations.js";
import { eventBus } from "@/store/eventBus";
import DualPanePanel from "@/components/dualPane/DualPanePanel.vue";
import {
  dualPane,
  ensureRightLoaded,
  followGallerySize,
  initDualPane,
  paneSideOfElement,
  refreshRight,
  resortRight,
  setActivePane,
  setPaneRatio,
} from "@/store/dualPane.js";
import { leftNavigation, locationKey, openedFromRight, runDualPaneCommand } from "@/utils/dualPane/commands.js";
import { resolveDualPaneKey } from "@/utils/dualPane/keymap.js";
import { paneDragHandlers } from "@/utils/dualPane/dragDrop.js";

const DRAG_EVENTS = ["dragstart", "dragenter", "dragover", "drop", "dragend"];

// Below this width for the two panes together (after a sticky sidebar) only one is shown
const MIN_PANES_WIDTH = 640;
const TRAILING_RESIZE_MS = 150;

export default {
  name: "DualPaneHost",
  components: { DualPanePanel },
  data: () => ({
    lastShown: false,
    lastLeft: null,
    resizeFrame: null,
    resizeTimer: null,
    viewportWidth: window.innerWidth,
    remPx: 16,
  }),
  computed: {
    available() {
      const roomy = this.viewportWidth - this.sidebarPx >= MIN_PANES_WIDTH;
      return Boolean(state.user?.username) && !getters.isShare() && !getters.isMobile() && dualPane.wideEnough && roomy;
    },
    mountedPane() {
      return this.available && dualPane.enabled;
    },
    // Hidden, not unmounted, during previews, settings and tools so the pane keeps its place
    shown() {
      const view = getters.currentView();
      return this.mountedPane && (view === "listingView" || (view === "loading" && this.lastShown));
    },
    ratio() {
      return dualPane.ratio;
    },
    activeSide() {
      return dualPane.active;
    },
    leftActive() {
      return dualPane.active === "left";
    },
    // Space a sticky sidebar takes on the left, as Layout pads #main
    stickySidebar() {
      return getters.isStickySidebar() && getters.isSidebarVisible();
    },
    sidebarOffset() {
      return this.stickySidebar ? `${state.sidebar.width}em` : "0px";
    },
    sidebarPx() {
      return this.stickySidebar ? state.sidebar.width * this.remPx : 0;
    },
    layoutKey() {
      return [this.shown, dualPane.ratio, this.sidebarOffset].join("|");
    },
    leftLocation() {
      if (getters.currentView() !== "listingView") return null;
      return locationKey(state.req?.source, normalizeDirPath(state.req?.path));
    },
  },
  watch: {
    shown: {
      immediate: true,
      handler(shown) {
        this.lastShown = shown;
        dualPane.shown = shown;
        if (shown) {
          ensureRightLoaded();
          if (dualPane.right.stale) refreshRight();
        } else {
          dualPane.menu = null;
        }
      },
    },
    layoutKey: {
      immediate: true,
      handler() {
        this.applyLayout();
      },
    },
    // Separate from the layout so switching panes doesn't fire resize events
    activeSide(active) {
      if (this.shown) document.documentElement.dataset.dualPaneActive = active;
    },
    leftLocation(location) {
      if (!location) return;
      if (location === leftNavigation.expected) {
        leftNavigation.expected = null;
      } else if (location !== this.lastLeft && this.lastLeft !== null) {
        // The sidebar, search, history or a link moved the left pane: that is where the user is
        setActivePane("left");
      }
      this.lastLeft = location;
      // A file opened from the right pane has been closed: forget where it said to go back to
      if (openedFromRight.item && toRaw(state.previousHistoryItem) === openedFromRight.item) {
        mutations.setPreviousHistoryItem(null);
      }
      openedFromRight.item = null;
    },
  },
  created() {
    this.remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    initDualPane(state.user?.username);
    this.stopUserWatch = this.$watch(() => state.user?.username, (username) => initDualPane(username));
    // Files.vue clears the reload flag synchronously, so only a sync watcher sees it
    this.stopReloadWatch = this.$watch(() => state.reload, (reload) => {
      if (reload) refreshRight();
    }, { flush: "sync" });
    this.stopSortWatch = this.$watch(() => getters.pickerSorting(), () => resortRight(), { deep: true });
    this.stopSizeWatch = this.$watch(() => state.user?.gallerySize, (size) => followGallerySize(size));
    eventBus.on("itemsDeleted", refreshRight);
    eventBus.on("itemsRenamed", refreshRight);
    window.addEventListener("keydown", this.onKeydown, true);
    window.addEventListener("paste", this.onPaste, true);
    window.addEventListener("resize", this.onResize);
    document.addEventListener("pointerdown", this.onPointerDown, true);
    this.dragListeners = DRAG_EVENTS.map((type) => {
      // A drag can end after the pane was hidden; always clear its state then
      const listener = (event) => {
        if (this.shown || type === "dragend") paneDragHandlers[type](event);
      };
      document.addEventListener(type, listener, true);
      return [type, listener];
    });
  },
  beforeUnmount() {
    this.stopUserWatch?.();
    this.stopReloadWatch?.();
    this.stopSortWatch?.();
    this.stopSizeWatch?.();
    eventBus.off("itemsDeleted", refreshRight);
    eventBus.off("itemsRenamed", refreshRight);
    window.removeEventListener("keydown", this.onKeydown, true);
    window.removeEventListener("paste", this.onPaste, true);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    for (const [type, listener] of this.dragListeners || []) {
      document.removeEventListener(type, listener, true);
    }
    cancelAnimationFrame(this.resizeFrame);
    clearTimeout(this.resizeTimer);
    dualPane.shown = false;
    this.clearLayout();
  },
  methods: {
    applyLayout() {
      if (!this.shown) {
        this.clearLayout();
        return;
      }
      const root = document.documentElement;
      const sidebar = this.sidebarOffset;
      const share = `calc((100vw - ${sidebar}) * ${dualPane.ratio})`;
      root.style.setProperty("--dual-pane-width", `clamp(320px, ${share}, calc(100vw - ${sidebar} - 320px))`);
      root.classList.add("dual-pane");
      root.dataset.dualPaneActive = dualPane.active;
      this.notifyResize();
    },
    clearLayout() {
      const root = document.documentElement;
      const wasShown = root.classList.contains("dual-pane");
      root.classList.remove("dual-pane", "dual-pane-resizing");
      root.style.removeProperty("--dual-pane-width");
      delete root.dataset.dualPaneActive;
      if (wasShown) this.notifyResize();
    },
    // The listing and its scrollbar measure on window resize, which a layout change doesn't fire.
    // ListingView throttles resize without a trailing call, so send a second one after the throttle.
    notifyResize() {
      cancelAnimationFrame(this.resizeFrame);
      clearTimeout(this.resizeTimer);
      this.resizeFrame = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
      this.resizeTimer = setTimeout(() => window.dispatchEvent(new Event("resize")), TRAILING_RESIZE_MS);
    },
    onResize() {
      this.viewportWidth = window.innerWidth;
    },
    keyContext() {
      return {
        available: this.available && getters.currentView() === "listingView",
        shown: this.shown,
        active: dualPane.active,
        promptOpen: Boolean(getters.currentPromptName()),
        searchActive: Boolean(state.isSearchActive),
        menuOpen: Boolean(dualPane.menu),
      };
    },
    onKeydown(event) {
      const command = resolveDualPaneKey(event, this.keyContext());
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      runDualPaneCommand(command);
    },
    // Ctrl+V while the right pane is active must not paste into the left pane's folder
    onPaste(event) {
      const tag = event.target?.tagName?.toLowerCase();
      if (!this.shown || dualPane.active !== "right" || tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;
      event.stopPropagation();
    },
    onPointerDown(event) {
      if (!this.shown) return;
      const side = paneSideOfElement(event.target);
      if (side) setActivePane(side);
    },
    startResize(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      const divider = event.currentTarget;
      divider.setPointerCapture?.(event.pointerId);
      const root = document.documentElement;
      root.classList.add("dual-pane-resizing");
      const sidebarPx = getters.isStickySidebar() && getters.isSidebarVisible()
        ? state.sidebar.width * parseFloat(getComputedStyle(root).fontSize)
        : 0;
      const move = (moveEvent) => {
        const available = window.innerWidth - sidebarPx;
        if (available <= 0) return;
        setPaneRatio((window.innerWidth - moveEvent.clientX) / available, { save: false });
      };
      const end = () => {
        divider.removeEventListener("pointermove", move);
        divider.removeEventListener("pointerup", end);
        divider.removeEventListener("pointercancel", end);
        root.classList.remove("dual-pane-resizing");
        setPaneRatio(dualPane.ratio);
        this.notifyResize();
      };
      divider.addEventListener("pointermove", move);
      divider.addEventListener("pointerup", end);
      divider.addEventListener("pointercancel", end);
    },
    resetRatio() {
      setPaneRatio(0.5);
    },
    stepRatio(delta) {
      setPaneRatio(dualPane.ratio + delta);
    },
  },
};
</script>
