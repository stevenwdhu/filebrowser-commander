<template>
  <div class="dual-pane-menu-backdrop" @click.stop="close" @contextmenu.prevent.stop="close"></div>
  <div
    ref="menu"
    class="dual-pane-menu"
    role="menu"
    :aria-label="$t('dualPane.pane')"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    @keydown.stop
    @keydown.down.prevent="focusItem(1)"
    @keydown.up.prevent="focusItem(-1)"
  >
    <button
      v-for="entry in entries"
      :key="entry.id"
      type="button"
      role="menuitem"
      class="dual-pane-menu-item"
      @click="choose(entry)"
    >
      <i class="material-symbols" aria-hidden="true">{{ entry.icon }}</i>
      <span>{{ entry.label }}</span>
      <kbd v-if="entry.shortcut" class="dual-pane-menu-shortcut">{{ entry.shortcut }}</kbd>
    </button>
  </div>
</template>

<script>
import { getters } from "@/store";
import { dualPane, rightSelection, setActivePane } from "@/store/dualPane.js";
import { dualPaneCommands } from "@/utils/dualPane/commands.js";
import { operationTargets } from "@/utils/dualPane/paneModel.js";

export default {
  name: "DualPaneMenu",
  data: () => ({
    position: { x: 0, y: 0 },
  }),
  computed: {
    menu() {
      return dualPane.menu;
    },
    permissions() {
      return getters.sourcePermissions(dualPane.right.source) || {};
    },
    entries() {
      const t = (key) => this.$t(key, { suffix: "" });
      if (!this.menu?.onEntry) {
        return [
          this.permissions.create && { id: "newFolder", icon: "create_new_folder", label: t("files.newFolder") },
          { id: "refresh", icon: "autorenew", label: t("buttons.refresh") },
          { id: "selectAll", icon: "select_all", label: t("buttons.selectAll") },
          { id: "showInOther", icon: "dock_to_right", label: t("dualPane.showInOtherPane") },
          { id: "swapPanes", icon: "vertical_split", label: t("dualPane.swapPanes") },
        ].filter(Boolean);
      }
      const targets = operationTargets(dualPane.right);
      const single = targets.length === 1 ? targets[0] : null;
      const isDir = single?.type === "directory";
      return [
        single && { id: "open", icon: isDir ? "folder_open" : "open_in_new", label: t("dualPane.open") },
        isDir && { id: "openInOther", icon: "dock_to_right", label: t("dualPane.openInOtherPane") },
        targets.length > 0 && this.permissions.download && { id: "copyToOther", icon: "content_copy", label: t("dualPane.copyToOtherPane"), shortcut: "F5" },
        targets.length > 0 && this.permissions.modify && { id: "moveToOther", icon: "move", label: t("dualPane.moveToOtherPane"), shortcut: "F6" },
        single && this.permissions.modify && { id: "rename", icon: "edit", label: t("general.rename") },
        targets.length > 0 && this.permissions.delete && { id: "delete", icon: "delete", label: t("general.delete") },
        targets.length > 0 && this.permissions.download && { id: "download", icon: "file_download", label: t("general.download") },
        single && { id: "info", icon: "info", label: t("general.info") },
      ].filter(Boolean);
    },
  },
  watch: {
    menu(menu) {
      if (menu) void this.place();
    },
  },
  mounted() {
    void this.place();
  },
  methods: {
    // Keep the menu on screen, then focus its first entry for keyboard use
    async place() {
      await this.$nextTick();
      if (!this.menu || !this.$refs.menu) return;
      const { innerWidth, innerHeight } = window;
      const rect = this.$refs.menu.getBoundingClientRect();
      this.position = {
        x: Math.max(8, Math.min(this.menu.x, innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(this.menu.y, innerHeight - rect.height - 8)),
      };
      this.$refs.menu.querySelector("button")?.focus({ preventScroll: true });
    },
    close() {
      dualPaneCommands.closeMenu();
    },
    choose(entry) {
      const targets = operationTargets(dualPane.right);
      this.close();
      setActivePane("right");
      // Open acts on the cursor row; point it at the item this menu was built for
      if ((entry.id === "open" || entry.id === "openInOther") && targets.length === 1) {
        rightSelection.setCursor(targets[0].path);
      }
      dualPaneCommands[entry.id]({});
    },
    focusItem(step) {
      const buttons = [...this.$refs.menu.querySelectorAll("button")];
      const index = buttons.indexOf(document.activeElement);
      buttons.at((index + step) % buttons.length)?.focus();
    },
  },
};
</script>
