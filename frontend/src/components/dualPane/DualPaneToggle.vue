<template>
  <button
    v-if="visible"
    type="button"
    class="action no-select dual-pane-toggle"
    :class="{ 'dual-pane-toggle--on': enabled }"
    :aria-pressed="String(enabled)"
    :aria-label="$t('dualPane.pane')"
    :title="title"
    @click="toggle"
  >
    <i class="material-symbols" aria-hidden="true">vertical_split</i>
  </button>
</template>

<script>
import { getters, state } from "@/store";
import { globalVars } from "@/utils/constants";
import { dualPane, toggleDualPane } from "@/store/dualPane.js";

export default {
  name: "DualPaneToggle",
  computed: {
    enabled() {
      return dualPane.enabled;
    },
    visible() {
      return (
        getters.currentView() === "listingView" &&
        Boolean(state.user?.username) &&
        !getters.isShare() &&
        !getters.isMobile() &&
        dualPane.wideEnough &&
        !globalVars.disableNavButtons
      );
    },
    // A toggle keeps one name; the tooltip says what a click does
    title() {
      const action = this.enabled ? this.$t("dualPane.hide") : this.$t("dualPane.show");
      return `${action} (Ctrl+\\)`;
    },
  },
  methods: {
    toggle() {
      toggleDualPane();
    },
  },
};
</script>
