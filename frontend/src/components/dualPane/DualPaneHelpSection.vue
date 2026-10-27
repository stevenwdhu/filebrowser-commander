<template>
  <div v-if="visible" class="shortcut-section">
    <h3 class="section-title">{{ $t("dualPane.shortcuts") }}</h3>
    <div v-for="shortcut in shortcuts" :key="shortcut.keys" class="shortcut-item">
      <kbd>{{ shortcut.keys }}</kbd>
      <span>{{ shortcut.label }}</span>
    </div>
  </div>
</template>

<script>
import { getters } from "@/store";

// The dual-pane keys, for the Help prompt; styled like its own sections
export default {
  name: "DualPaneHelpSection",
  computed: {
    visible() {
      return !getters.isShare() && !getters.isMobile();
    },
    shortcuts() {
      const t = (key) => this.$t(key, { suffix: "" });
      return [
        { keys: "CTRL + \\", label: t("dualPane.toggle") },
        { keys: "TAB", label: t("dualPane.switchPane") },
        { keys: "F5", label: t("dualPane.copyToOtherPane") },
        { keys: "F6", label: t("dualPane.moveToOtherPane") },
        { keys: "F7", label: t("files.newFolder") },
        { keys: "F8", label: t("help.del") },
        // Only the second pane has a cursor to mark with
        { keys: "INSERT", label: `${t("dualPane.markItem")} (${t("dualPane.pane")})` },
        { keys: "ALT + O", label: t("dualPane.openInOtherPane") },
        { keys: "ALT + I", label: t("dualPane.showInOtherPane") },
        { keys: "CTRL + U", label: t("dualPane.swapPanes") },
      ];
    },
  },
};
</script>

<style scoped>
.shortcut-section {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
}

.section-title {
  margin: 0 0 0.75em;
  padding-bottom: 0.5em;
  border-bottom: 1px solid var(--divider);
  color: var(--textPrimary);
  font-size: 0.95em;
  font-weight: 600;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 0.75em;
  padding: 0.5em;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.shortcut-item:hover {
  background-color: var(--hoverOverlay);
}

.shortcut-item kbd {
  display: inline-block;
  min-width: 80px;
  padding: 0.35em 0.65em;
  border: 1px solid var(--divider);
  border-radius: 4px;
  background-color: var(--surfaceSecondary);
  box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
  color: var(--textPrimary);
  font-family: monospace;
  font-size: 0.85em;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
}

.shortcut-item span {
  flex: 1;
  color: var(--textSecondary);
  font-size: 0.9em;
}
</style>
