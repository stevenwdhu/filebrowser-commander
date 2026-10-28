<template>
  <!-- A pane's folders, files and size, or its selection's, the same in both panes and level with
       each other above the bottom bar. click.stop keeps ListingView's window click handler from
       clearing the left selection, as the right pane does for its own. -->
  <div class="dual-pane-status" @click.stop @contextmenu.prevent.stop>
    <span class="dual-pane-status-text">{{ text }}</span>
  </div>
</template>

<script>
import { paneSelectionTotals, paneTotals } from "@/store/dualPane.js";
import { getHumanReadableFilesize } from "@/utils/filesizes";

export default {
  name: "DualPaneStatusLine",
  props: {
    pane: {
      type: String,
      required: true,
      validator: (side) => side === "left" || side === "right",
    },
  },
  computed: {
    totals() {
      return paneTotals(this.pane);
    },
    selection() {
      return paneSelectionTotals(this.pane);
    },
    text() {
      const { count, bytes } = this.selection;
      if (count > 0) {
        const label = count === 1 ? this.$t("general.selectionSingle") : this.$t("general.selectionMultiple");
        return `${count} ${label} (${getHumanReadableFilesize(bytes)})`;
      }
      const { dirs, files } = this.totals;
      if (dirs === 0 && files === 0) {
        return "";
      }
      const parts = [];
      if (dirs > 0) {
        parts.push(`${dirs} ${dirs === 1 ? this.$t("general.folder") : this.$t("general.folders")}`);
      }
      if (files > 0) {
        parts.push(`${files} ${files === 1 ? this.$t("general.file") : this.$t("general.files")}`);
      }
      return `${parts.join(" | ")} (${getHumanReadableFilesize(this.totals.bytes)})`;
    },
  },
};
</script>
