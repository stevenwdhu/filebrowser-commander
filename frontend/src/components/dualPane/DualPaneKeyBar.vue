<template>
  <!-- Commander function keys, in the bottom bar under both panes; they act on the active pane, like
       the keys themselves -->
  <div ref="bar" class="dual-pane-keybar" role="toolbar" :aria-label="$t('help.functionKeys')">
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
</template>

<script>
import { getters } from "@/store";
import { dualPane } from "@/store/dualPane.js";
import { dualPaneCommands } from "@/utils/dualPane/commands.js";

export default {
  name: "DualPaneKeyBar",
  computed: {
    functionKeys() {
      const t = (key) => this.$t(key, { suffix: "" });
      return [
        { key: "F5", command: "copyToOther", label: t("general.copy") },
        { key: "F6", command: "moveToOther", label: t("general.move") },
        { key: "F7", command: "newFolderInActive", label: t("files.newFolder") },
        { key: "F8", command: "deleteInActive", label: t("general.delete") },
      ].map((entry) => ({ ...entry, title: `${entry.key} ${entry.label}` }));
    },
  },
  // The bar these keys are in, the app's status bar, is under both panes: a click or key there, on
  // these keys or the size slider, is no click or key in the left listing, whose window handlers
  // would clear its selection or move it
  mounted() {
    this.statusBar = this.$refs.bar.closest("#status-bar");
    this.statusBar?.addEventListener("click", this.keepClickFromListing);
    this.statusBar?.addEventListener("keydown", this.keepKeyFromListing);
  },
  beforeUnmount() {
    this.statusBar?.removeEventListener("click", this.keepClickFromListing);
    this.statusBar?.removeEventListener("keydown", this.keepKeyFromListing);
  },
  methods: {
    runKey(command) {
      if (getters.currentPromptName()) return;
      dualPaneCommands[command]({});
    },
    keepClickFromListing(event) {
      if (dualPane.shown) event.stopPropagation();
    },
    // An open prompt handles Enter itself (Prompts.vue), so then keys go on to it
    keepKeyFromListing(event) {
      if (dualPane.shown && !getters.currentPromptName()) event.stopPropagation();
    },
  },
};
</script>
