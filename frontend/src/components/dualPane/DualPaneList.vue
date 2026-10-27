<template>
  <div
    ref="list"
    class="listing-items list dual-pane-list"
    tabindex="-1"
    @click.self="clearSelection"
  >
    <ListingItem
      v-for="(entry, index) in right.entries"
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
      :inlinePin="true"
      :class="{ 'zebra-row': index % 2 === 1, 'dual-pane-cursor': entry.path === right.cursor }"
      :data-path="entry.path"
      @pointerdown="lastPointerType = $event.pointerType"
      @click.prevent="onRowClick(entry, $event)"
      @dblclick.prevent="openEntry(entry)"
      @auxclick="onAuxClick(entry, $event)"
    />
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
import { dualPane, rightSelection, setActivePane } from "@/store/dualPane.js";
import { openEntry } from "@/utils/dualPane/commands.js";
import { isParentEntry } from "@/utils/dualPane/paneModel.js";

export default {
  name: "DualPaneList",
  components: { ListingItem, LoadingSpinner },
  data: () => ({
    lastPointerType: "mouse",
    nowIso: new Date().toISOString(),
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
    clearSelection() {
      setActivePane("right");
      this.focus();
      rightSelection.clear();
    },
  },
};
</script>
