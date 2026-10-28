<template>
  <!-- One per pane: the right pane's in its panel, the left pane's from DualPaneHost in place of the listing's breadcrumbs -->
  <div class="dual-pane-pathbar" :class="{ 'is-active': isActive }" @keydown="onKeydown">
    <button
      type="button"
      class="dual-pane-pathbar-source"
      :title="$t('sidebar.chooseSource')"
      :aria-label="sourceLabel"
      @click="openPicker"
    >
      <i class="material-symbols" aria-hidden="true">storage</i>
      <span>{{ location.source }}</span>
    </button>
    <!-- Crumbs carry their folder in data-path: drops on them go through the copy/move prompt (utils/dualPane/dragDrop.js) -->
    <nav ref="crumbs" class="dual-pane-pathbar-crumbs" :aria-label="$t('general.path', { suffix: '' })">
      <button
        type="button"
        class="dual-pane-pathbar-crumb"
        data-path="/"
        :title="rootLabel"
        :aria-label="rootLabel"
        :aria-current="location.path === '/' ? 'location' : undefined"
        @click="go('/')"
        @auxclick="onAuxClick('/', $event)"
      >
        <i class="material-symbols" aria-hidden="true">home</i>
      </button>
      <template v-for="segment in segments" :key="segment.path">
        <i class="material-symbols dual-pane-pathbar-separator" aria-hidden="true">chevron_right</i>
        <button
          type="button"
          class="dual-pane-pathbar-crumb"
          :class="{ 'has-update': hasUpdate && segment.path === location.path }"
          :data-path="segment.path"
          :aria-current="segment.path === location.path ? 'location' : undefined"
          @click="go(segment.path)"
          @auxclick="onAuxClick(segment.path, $event)"
        >{{ segment.name }}</button>
      </template>
    </nav>
    <div class="dual-pane-pathbar-actions">
      <button
        type="button"
        class="dual-pane-pathbar-action"
        :title="$t('buttons.refresh')"
        :aria-label="$t('buttons.refresh')"
        @click="refresh"
      >
        <i class="material-symbols" aria-hidden="true">autorenew</i>
      </button>
      <button
        type="button"
        class="dual-pane-pathbar-action"
        :title="showInOtherLabel"
        :aria-label="showInOtherLabel"
        @click="showInOther"
      >
        <i class="material-symbols" aria-hidden="true">dock_to_right</i>
      </button>
      <!-- On the right only: on the left it would read as closing that pane -->
      <button
        v-if="pane === 'right'"
        type="button"
        class="dual-pane-pathbar-action"
        :title="hideLabel"
        :aria-label="hideLabel"
        @click="run('toggleDual')"
      >
        <i class="material-symbols" aria-hidden="true">close</i>
      </button>
    </div>
  </div>
</template>

<script>
import { mutations, state } from "@/store";
import { eventBus } from "@/store/eventBus";
import { dualPane, openRight, paneLocation, refreshRight, setActivePane } from "@/store/dualPane.js";
import { dualPaneCommands, openFolderInNewTab, openLeft } from "@/utils/dualPane/commands.js";
import { breadcrumbSegments } from "@/utils/dualPane/paneModel.js";
import { invalidateDirMetadataCache } from "@/utils/metadataCache.js";

let pickerCount = 0;
// Keys a focused button handles itself; the left listing's window handler must not see them
const BUTTON_KEYS = new Set([" ", "Enter"]);

export default {
  name: "DualPanePathBar",
  props: {
    pane: {
      type: String,
      default: "right",
      validator: (value) => value === "left" || value === "right",
    },
  },
  data: () => ({
    pendingPickerId: null,
  }),
  computed: {
    location() {
      return paneLocation(this.pane);
    },
    segments() {
      return breadcrumbSegments(this.location.path);
    },
    isActive() {
      return dualPane.active === this.pane;
    },
    // The server said the left folder changed since it loaded, as the listing's breadcrumbs show it
    hasUpdate() {
      return this.pane === "left" && Boolean(state.req?.hasUpdate);
    },
    // Starts with the visible source name, so voice control can find it
    sourceLabel() {
      return `${this.location.source || ""}, ${this.$t("sidebar.chooseSource")}`;
    },
    rootLabel() {
      return this.location.source || this.$t("general.home", { suffix: "" });
    },
    showInOtherLabel() {
      return `${this.$t("dualPane.showInOtherPane")} (Alt+I)`;
    },
    hideLabel() {
      return `${this.$t("dualPane.hide")} (Ctrl+\\)`;
    },
  },
  watch: {
    // Also on mount: the left bar first appears on whatever folder the listing is in
    segments: {
      immediate: true,
      async handler() {
        await this.$nextTick();
        const crumbs = this.$refs.crumbs;
        if (crumbs) crumbs.scrollLeft = crumbs.scrollWidth;
      },
    },
  },
  created() {
    eventBus.on("pathSelected", this.onPathSelected);
    eventBus.on("pathPickerCancelled", this.onPathPickerCancelled);
  },
  beforeUnmount() {
    eventBus.off("pathSelected", this.onPathSelected);
    eventBus.off("pathPickerCancelled", this.onPathPickerCancelled);
  },
  methods: {
    run(command) {
      dualPaneCommands[command]({});
    },
    open(source, path) {
      if (this.pane === "right") {
        void openRight(source, path);
      } else {
        openLeft(source, path);
      }
    },
    go(path) {
      // The left pane's own folder doesn't reload by navigating to it
      if (this.pane === "left" && path === this.location.path) {
        this.refresh();
        return;
      }
      this.open(this.location.source, path);
    },
    onAuxClick(path, event) {
      if (event.button !== 1) return;
      event.preventDefault();
      openFolderInNewTab(this.location.source, path);
    },
    refresh() {
      if (this.pane === "right") {
        refreshRight();
        return;
      }
      // As F4 does
      invalidateDirMetadataCache();
      mutations.setReload(true);
    },
    showInOther() {
      // The button acts on this pane even when the other one is active
      setActivePane(this.pane);
      dualPaneCommands.showInOther();
    },
    onKeydown(event) {
      if (BUTTON_KEYS.has(event.key) && event.target?.closest?.("button")) event.stopPropagation();
    },
    openPicker() {
      pickerCount += 1;
      this.pendingPickerId = `dual-pane-picker-${pickerCount}`;
      mutations.showPrompt({
        name: "pathPicker",
        props: {
          currentPath: this.location.path,
          currentSource: this.location.source || state.sources.current,
          showFiles: false,
          showFolders: true,
          selectionContextId: this.pendingPickerId,
        },
      });
    },
    onPathSelected(data) {
      if (!data || !this.pendingPickerId || data.selectionContextId !== this.pendingPickerId) return;
      this.pendingPickerId = null;
      if (typeof data.source === "string" && typeof data.path === "string") {
        this.open(data.source, data.path);
      }
    },
    onPathPickerCancelled(data) {
      if (data?.selectionContextId === this.pendingPickerId) this.pendingPickerId = null;
    },
  },
};
</script>
