<template>
  <div class="move-copy-summary">
    <div class="move-copy-summary-row" data-testid="move-copy-items">
      <i class="material-symbols move-copy-summary-icon" aria-hidden="true">{{ itemIcon }}</i>
      <span class="move-copy-summary-text">{{ itemsLabel }}</span>
      <span v-if="sizeLabel" class="move-copy-summary-muted">{{ sizeLabel }}</span>
    </div>
    <div class="move-copy-summary-row" data-testid="move-copy-destination">
      <span class="move-copy-summary-muted">{{ $t("prompts.destinationPath") }}</span>
      <span v-if="showSource && destSource" class="move-copy-summary-source">{{ destSource }}</span>
      <span class="move-copy-summary-text" :title="destPath">{{ destPath }}</span>
    </div>
    <!-- Always rendered so screen readers announce the reason when it appears -->
    <div role="status" aria-atomic="true">
      <p
        v-if="blockMessage"
        :id="blockMessageId"
        class="move-copy-summary-row move-copy-summary-blocked"
        data-testid="move-copy-blocked"
      >
        <i class="material-symbols move-copy-summary-icon" aria-hidden="true">warning</i>
        <span>{{ blockMessage }}</span>
      </p>
    </div>
    <div v-if="progress" class="move-copy-progress" data-testid="move-copy-progress">
      <div
        class="move-copy-progress-track"
        role="progressbar"
        :aria-label="progressLabel"
        aria-valuemin="0"
        :aria-valuemax="progress.total"
        :aria-valuenow="determinate ? progress.done : undefined"
      >
        <div
          class="move-copy-progress-fill"
          :class="{ indeterminate: !determinate }"
          :style="determinate ? { width: `${percent}%` } : null"
        ></div>
      </div>
      <div class="move-copy-summary-row">
        <span class="move-copy-summary-muted">{{ progressLabel }}</span>
        <span v-if="determinate && progress.current" class="move-copy-summary-text move-copy-progress-current">{{ progress.current }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { getHumanReadableFilesize } from "@/utils/filesizes";
import { summarizeItems } from "@/utils/moveCopyPlan";

export default {
  name: "MoveCopySummary",
  props: {
    // Prompt items: { from, fromSource, name, type?, size? }
    items: {
      type: Array,
      required: true,
    },
    destSource: {
      type: String,
      default: null,
    },
    destPath: {
      type: String,
      default: "/",
    },
    // Name the destination source (off inside shares and with a single source)
    showSource: {
      type: Boolean,
      default: false,
    },
    blockMessage: {
      type: String,
      default: "",
    },
    blockMessageId: {
      type: String,
      default: null,
    },
    // { done, total, current } while the operation runs
    progress: {
      type: Object,
      default: null,
    },
  },
  computed: {
    summary() {
      return summarizeItems(this.items);
    },
    itemIcon() {
      if (this.summary.count === 1) {
        return this.summary.folders === 1 ? "folder" : "insert_drive_file";
      }
      return "file_copy";
    },
    itemsLabel() {
      if (this.summary.count === 1) {
        return this.items[0].name;
      }
      const parts = [];
      if (this.summary.folders > 0) {
        const label = this.summary.folders === 1 ? this.$t("general.folder") : this.$t("general.folders");
        parts.push(`${this.summary.folders} ${label}`);
      }
      if (this.summary.files > 0) {
        const label = this.summary.files === 1 ? this.$t("general.file") : this.$t("general.files");
        parts.push(`${this.summary.files} ${label}`);
      }
      return parts.join(", ");
    },
    sizeLabel() {
      return this.summary.size ? getHumanReadableFilesize(this.summary.size) : "";
    },
    // A single item can only show that something is happening
    determinate() {
      return this.progress?.total > 1;
    },
    percent() {
      return Math.round((this.progress.done / this.progress.total) * 100);
    },
    progressLabel() {
      if (!this.determinate) {
        return this.$t("prompts.operationInProgress");
      }
      return this.$t("prompts.moveCopyProgress", { done: this.progress.done, total: this.progress.total });
    },
  },
};
</script>

<style scoped>
.move-copy-summary {
  display: flex;
  flex-direction: column;
  margin-bottom: 0.75em;
  font-size: 0.9em;
}

.move-copy-summary-row {
  display: flex;
  align-items: center;
  gap: 0.4em;
  min-width: 0;
}

/* Margins rather than gap, so the empty status region takes no space */
.move-copy-summary-row + .move-copy-summary-row {
  margin-top: 0.3em;
}

.move-copy-summary-icon {
  flex: 0 0 auto;
  font-size: 1.2em;
  color: var(--primaryColor);
}

.move-copy-summary-text {
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-copy-summary-muted {
  flex: 0 0 auto;
  color: var(--textSecondary);
}

.move-copy-summary-source {
  flex: 0 0 auto;
  padding: 0 0.4em;
  border: 1px solid var(--divider);
  border-radius: var(--borderRadius);
}

.move-copy-summary-blocked {
  margin: 0.3em 0 0;
  color: var(--textPrimary);
}

.move-copy-summary-blocked .move-copy-summary-icon {
  color: var(--icon-orange);
}

.move-copy-progress {
  display: flex;
  flex-direction: column;
  gap: 0.4em;
  margin-top: 0.5em;
}

.move-copy-progress-current::before {
  content: "·";
  margin-right: 0.4em;
  color: var(--textSecondary);
  font-weight: normal;
}

.move-copy-progress-track {
  position: relative;
  height: 0.5em;
  overflow: hidden;
  border-radius: 1em;
  background: var(--divider);
}

.move-copy-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--primaryColor);
  transition: width 0.3s ease;
}

.move-copy-progress-fill.indeterminate {
  position: absolute;
  width: 35%;
  animation: move-copy-progress-slide 1.2s ease-in-out infinite;
}

@keyframes move-copy-progress-slide {
  from {
    left: -35%;
  }

  to {
    left: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .move-copy-progress-fill.indeterminate {
    left: 0;
    width: 100%;
    animation: none;
    opacity: 0.5;
  }
}
</style>
