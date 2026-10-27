<template>
  <div
    ref="list"
    class="listing-items dual-pane-list"
    :class="viewMode"
    :style="itemStyles"
    tabindex="-1"
    @click="onListClick"
  >
    <!-- Grouped like the main listing so its layout styles apply; ".." leads the folders -->
    <template v-for="(group, groupIndex) in groups" :key="group.key">
      <div v-if="group.title">
        <h2>{{ group.title }}</h2>
      </div>
      <div
        :class="[group.key, { firstGroup: groupIndex === 0, lastGroup: groupIndex === groups.length - 1 }]"
        role="group"
        :aria-label="group.label"
      >
        <ListingItem
          v-for="{ entry, index } in group.items"
          :key="entry.path"
          :name="entry.name"
          :isDir="entry.type === 'directory'"
          :source="entry.source"
          :type="entry.type"
          :size="entry.size ?? 0"
          :modified="entry.modified || nowIso"
          :created="entry.created"
          :index="index"
          :path="entry.path"
          :hasPreview="entry.type !== 'directory' && entry.hasPreview"
          :metadata="entry.metadata"
          :pinned="entry.pinned"
          :reducedOpacity="entry.hidden"
          :updateGlobalState="false"
          :clickable="false"
          :isSelectedProp="selectedSet.has(entry.path)"
          :forceFilesApi="true"
          :showLimitedOptions="true"
          :class="{ 'zebra-row': (index - stripeOffset) % 2 === 1, 'dual-pane-cursor': entry.path === right.cursor }"
          :data-path="entry.path"
          @pointerdown="lastPointerType = $event.pointerType"
          @click.prevent="onRowClick(entry, $event)"
          @dblclick.prevent="openEntry(entry)"
          @auxclick="onAuxClick(entry, $event)"
        />
      </div>
    </template>
    <div v-if="right.loading && !right.loaded" class="dual-pane-message">
      <LoadingSpinner size="small" mode="placeholder" />
    </div>
    <h2 v-else-if="right.error" class="dual-pane-message">
      <i class="material-symbols" aria-hidden="true">error</i>
      <span>{{ $t("files.cannotAccesDir") }}</span>
    </h2>
    <h2 v-else-if="right.loaded && isEmpty" class="dual-pane-message">
      <i class="material-symbols" aria-hidden="true">sentiment_dissatisfied</i>
      <span>{{ $t("files.lonely") }}</span>
    </h2>
  </div>
</template>

<script>
import { state } from "@/store";
import ListingItem from "@/components/files/ListingItem.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import { dualPane, rightSelection, rightViewMode, setActivePane } from "@/store/dualPane.js";
import { openEntry } from "@/utils/dualPane/commands.js";
import { paneColumns, paneItemStyles } from "@/utils/dualPane/paneLayout.js";
import { isParentEntry } from "@/utils/dualPane/paneModel.js";

export default {
  name: "DualPaneList",
  components: { ListingItem, LoadingSpinner },
  data: () => ({
    lastPointerType: "mouse",
    nowIso: new Date().toISOString(),
    listWidth: 0,
  }),
  computed: {
    right() {
      return dualPane.right;
    },
    selectedSet() {
      return new Set(dualPane.right.selected);
    },
    isEmpty() {
      return !dualPane.right.entries.some((entry) => !isParentEntry(entry));
    },
    // Stripes start at the first entry after "..", as in the main listing, which has no ".."
    stripeOffset() {
      return isParentEntry(this.right.entries[0]) ? 1 : 0;
    },
    viewMode() {
      return rightViewMode();
    },
    gallerySize() {
      return state.user?.gallerySize ?? 5;
    },
    // A number, so resizing the pane re-renders the rows only when the column count changes
    columns() {
      return paneColumns(this.viewMode, this.listWidth, this.gallerySize);
    },
    itemStyles() {
      return paneItemStyles(this.viewMode, this.gallerySize, this.columns);
    },
    groups() {
      const folders = [];
      const files = [];
      this.right.entries.forEach((entry, index) => {
        (entry.type === "directory" ? folders : files).push({ entry, index });
      });
      const groups = [];
      if (folders.length > 0) {
        const label = this.$t("general.folders");
        // ".." on its own gets no heading
        const title = folders.some(({ entry }) => !isParentEntry(entry)) ? label : "";
        groups.push({ key: "folder-items", items: folders, label, title });
      }
      if (files.length > 0) {
        const label = this.$t("general.files");
        groups.push({ key: "file-items", items: files, label, title: label });
      }
      return groups;
    },
  },
  mounted() {
    // The normal layout's columns depend on the pane's width, which the divider changes
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(([entry]) => {
      this.listWidth = entry.contentRect.width;
    });
    this.resizeObserver.observe(this.$refs.list);
  },
  beforeUnmount() {
    this.resizeObserver?.disconnect();
  },
  watch: {
    async "right.cursor"() {
      await this.$nextTick();
      this.$el?.querySelector(".dual-pane-cursor")?.scrollIntoView?.({ block: "nearest" });
    },
  },
  methods: {
    openEntry,
    focus() {
      this.$refs.list?.focus({ preventScroll: true });
    },
    onRowClick(entry, event) {
      setActivePane("right");
      this.focus();
      const ctrl = event.ctrlKey || event.metaKey;
      const plain = !ctrl && !event.shiftKey;
      // Single-click users, and a tap on the row that already has the cursor, open it
      const tapOnCursor = this.lastPointerType === "touch" && entry.path === dualPane.right.cursor;
      if (plain && (state.user?.singleClick || tapOnCursor)) {
        rightSelection.setCursor(entry.path);
        openEntry(entry);
        return;
      }
      rightSelection.click(entry.path, { ctrl, shift: event.shiftKey });
    },
    onAuxClick(entry, event) {
      if (event.button !== 1) return;
      event.preventDefault();
      openEntry(entry, { newTab: true });
    },
    onListClick(event) {
      // Between the entries, not on one
      if (event.target.closest?.(".listing-item")) return;
      this.clearSelection();
    },
    clearSelection() {
      setActivePane("right");
      this.focus();
      rightSelection.clear();
    },
  },
};
</script>
