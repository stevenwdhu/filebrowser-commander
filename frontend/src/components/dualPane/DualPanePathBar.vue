<template>
  <div class="dual-pane-pathbar">
    <button
      type="button"
      class="dual-pane-pathbar-source"
      :title="$t('sidebar.chooseSource')"
      :aria-label="sourceLabel"
      @click="openPicker"
    >
      <i class="material-symbols" aria-hidden="true">storage</i>
      <span>{{ right.source }}</span>
    </button>
    <nav ref="crumbs" class="dual-pane-pathbar-crumbs" :aria-label="$t('general.path', { suffix: '' })">
      <button type="button" class="dual-pane-pathbar-crumb" :title="rootLabel" :aria-label="rootLabel" @click="go('/')">
        <i class="material-symbols" aria-hidden="true">home</i>
      </button>
      <template v-for="segment in segments" :key="segment.path">
        <i class="material-symbols dual-pane-pathbar-separator" aria-hidden="true">chevron_right</i>
        <button
          type="button"
          class="dual-pane-pathbar-crumb"
          :aria-current="segment.path === right.path ? 'location' : undefined"
          @click="go(segment.path)"
        >{{ segment.name }}</button>
      </template>
    </nav>
    <div class="dual-pane-pathbar-actions">
      <button
        type="button"
        class="dual-pane-pathbar-action"
        :disabled="right.path === '/'"
        :title="$t('buttons.openParentFolder')"
        :aria-label="$t('buttons.openParentFolder')"
        @click="run('parent')"
      >
        <i class="material-symbols" aria-hidden="true">arrow_upward</i>
      </button>
      <button
        type="button"
        class="dual-pane-pathbar-action"
        :title="$t('buttons.refresh')"
        :aria-label="$t('buttons.refresh')"
        @click="run('refresh')"
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
      <button
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
import { dualPane, openRight, setActivePane } from "@/store/dualPane.js";
import { dualPaneCommands } from "@/utils/dualPane/commands.js";
import { breadcrumbSegments } from "@/utils/dualPane/paneModel.js";

let pickerCount = 0;

export default {
  name: "DualPanePathBar",
  data: () => ({
    pendingPickerId: null,
  }),
  computed: {
    right() {
      return dualPane.right;
    },
    segments() {
      return breadcrumbSegments(dualPane.right.path);
    },
    // Starts with the visible source name, so voice control can find it
    sourceLabel() {
      return `${this.right.source || ""}, ${this.$t("sidebar.chooseSource")}`;
    },
    rootLabel() {
      return this.right.source || this.$t("general.home", { suffix: "" });
    },
    showInOtherLabel() {
      return `${this.$t("dualPane.showInOtherPane")} (Alt+I)`;
    },
    hideLabel() {
      return `${this.$t("dualPane.hide")} (Ctrl+\\)`;
    },
  },
  watch: {
    async segments() {
      await this.$nextTick();
      const crumbs = this.$refs.crumbs;
      if (crumbs) crumbs.scrollLeft = crumbs.scrollWidth;
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
    go(path) {
      void openRight(this.right.source, path);
    },
    showInOther() {
      // The button acts on this pane even when the left one is active
      setActivePane("right");
      dualPaneCommands.showInOther();
    },
    openPicker() {
      pickerCount += 1;
      this.pendingPickerId = `dual-pane-picker-${pickerCount}`;
      mutations.showPrompt({
        name: "pathPicker",
        props: {
          currentPath: this.right.path,
          currentSource: this.right.source || state.sources.current,
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
        void openRight(data.source, data.path);
      }
    },
    onPathPickerCancelled(data) {
      if (data?.selectionContextId === this.pendingPickerId) this.pendingPickerId = null;
    },
  },
};
</script>
