<template>
  <!-- The left listing's "..", while both panes are shown. A group of its own ahead of the
       listing's, so its indexes, selection and counts never include it; folder-items gives it the
       folders' layout in every view mode. -->
  <div v-if="visible" class="folder-items dual-pane-parent-group firstGroup" :class="{ lastGroup: empty }">
    <!-- No index, so the listing's arrow keys, type-ahead, rectangle and Ctrl+A skip it, and no
         data-name, which the listing's scroll indicator would show as "." -->
    <ListingItem
      name=".."
      :isDir="true"
      type="directory"
      :source="location.source"
      :path="parentPath"
      :size="0"
      :modified="nowIso"
      :updateGlobalState="false"
      :clickable="false"
      :isSelectedProp="false"
      :data-name="null"
      data-parent="true"
      :data-path="parentPath"
      :class="{ 'dual-pane-cursor': onParent }"
      @pointerdown="lastPointerType = $event.pointerType"
      @click.prevent="onClick"
      @dblclick.prevent="open"
      @auxclick="onAuxClick"
      @contextmenu.capture="onContextMenu"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="cancelLongPress"
    />
  </div>
</template>

<script>
import { getters, mutations, state } from "@/store";
import ListingItem from "@/components/files/ListingItem.vue";
import { dualPane, paneLocation, setActivePane } from "@/store/dualPane.js";
import { dualPaneCommands, openLeftParent } from "@/utils/dualPane/commands.js";
import { parentDir } from "@/utils/dualPane/paneModel.js";

// As the listing's own long press (ListingView.openContextForSafari)
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

export default {
  name: "LeftParentRow",
  components: { ListingItem },
  props: {
    // The listing shows its empty message instead of any group
    empty: {
      type: Boolean,
      default: false,
    },
  },
  data: () => ({
    lastPointerType: "mouse",
    nowIso: new Date().toISOString(),
    longPress: null, // { timer, x, y } while a touch is held on the row
    longPressed: false, // The held touch opened the menu: its click mustn't go up
  }),
  computed: {
    location() {
      return paneLocation("left");
    },
    visible() {
      return dualPane.shown && !getters.isShare() && Boolean(this.location.source) && this.location.path !== "/";
    },
    parentPath() {
      return parentDir(this.location.path);
    },
    onParent() {
      return dualPane.leftOnParent;
    },
  },
  beforeUnmount() {
    this.cancelLongPress();
  },
  methods: {
    open() {
      openLeftParent();
    },
    onClick(event) {
      if (this.longPressed) {
        this.longPressed = false;
        return;
      }
      setActivePane("left");
      if (event.shiftKey) return;
      if (event.ctrlKey || event.metaKey) {
        // The cursor moves here and the selection stays, as on the right
        dualPane.leftOnParent = true;
        return;
      }
      // Single-click users, and a tap on ".." once the cursor is on it, go up
      const tapOnCursor = this.lastPointerType !== "mouse" && this.onParent;
      if (state.user?.singleClick || tapOnCursor) {
        this.open();
        return;
      }
      dualPaneCommands.leftParentFocus();
    },
    onAuxClick(event) {
      if (event.button !== 1) return;
      event.preventDefault();
      openLeftParent({ newTab: true });
    },
    // Ahead of the row's own handler, which would put ".." into the selection and open the item
    // menu for it
    onContextMenu(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.openFolderMenu(event.clientX, event.clientY);
    },
    // Touch screens that send no contextmenu (iPad Safari) get the listing's own long press, which
    // would open the item menu for the selection. This timer is set first, so it fires first; the
    // listing's then finds the menu open and leaves it.
    onTouchStart(event) {
      const touch = event.touches?.[0];
      this.cancelLongPress();
      this.longPressed = false;
      if (!touch) return;
      const timer = setTimeout(() => {
        this.longPress = null;
        this.longPressed = true;
        this.openFolderMenu(touch.clientX, touch.clientY);
      }, LONG_PRESS_MS);
      this.longPress = { timer, x: touch.clientX, y: touch.clientY };
    },
    onTouchMove(event) {
      const touch = event.touches?.[0];
      if (!touch || !this.longPress) return;
      const moved = Math.max(Math.abs(touch.clientX - this.longPress.x), Math.abs(touch.clientY - this.longPress.y));
      if (moved > LONG_PRESS_SLOP_PX) this.cancelLongPress();
    },
    onTouchEnd(event) {
      this.cancelLongPress();
      // With the cursor now on "..", the click this touch would make counts as a tap that goes up
      if (this.longPressed) event.preventDefault();
    },
    cancelLongPress() {
      if (this.longPress) clearTimeout(this.longPress.timer);
      this.longPress = null;
    },
    // The folder's menu. The app's menu acts on the selection whenever there is one, so the cursor
    // moves here first, which clears it, as a click does.
    openFolderMenu(x, y) {
      setActivePane("left");
      if (getters.currentPromptName() === "ContextMenu") return;
      dualPaneCommands.leftParentFocus();
      mutations.showPrompt({
        name: "ContextMenu",
        props: { showCentered: getters.isMobile(), posX: x, posY: y, createOnly: true },
      });
    },
  },
};
</script>
