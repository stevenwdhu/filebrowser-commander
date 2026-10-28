<template>
  <div class="move-copy-summary">
    <div class="move-copy-summary-row" data-testid="move-copy-items">
      <i class="material-symbols move-copy-summary-icon" aria-hidden="true">{{ itemIcon }}</i>
      <span class="move-copy-summary-text">{{ itemsLabel }}</span>
      <span v-if="sizeLabel" class="move-copy-summary-muted">{{ sizeLabel }}</span>
    </div>
    <MoveCopyDestination
      :source="destSource"
      :path="destPath"
      :show-source="showSource"
      :sources="sources"
      :interactive="interactive"
      @navigate="$emit('navigate', $event)"
    />
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
        aria-valuemax="100"
        :aria-valuenow="determinate ? percent : undefined"
      >
        <div
          class="move-copy-progress-fill"
          :class="{ indeterminate: !determinate }"
          :style="determinate ? { width: `${percent}%` } : null"
        ></div>
      </div>
      <div class="move-copy-summary-row move-copy-progress-status">
        <span v-if="!determinate || countLabel" class="move-copy-summary-muted">{{ determinate ? countLabel : progressLabel }}</span>
        <span v-if="determinate && progress.current" class="move-copy-summary-text move-copy-progress-current">{{ progress.current }}</span>
        <span v-if="bytesLabel" class="move-copy-summary-muted move-copy-progress-bytes">{{ bytesLabel }}</span>
        <span v-if="speedLabel" class="move-copy-summary-muted move-copy-progress-speed">{{ speedLabel }}</span>
      </div>
      <div v-if="timed" class="move-copy-summary-row move-copy-progress-status" data-testid="move-copy-timing">
        <span class="move-copy-summary-muted">{{ elapsedLabel }}</span>
        <span v-if="timeLeftLabel" class="move-copy-summary-muted move-copy-progress-left">{{ timeLeftLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import MoveCopyDestination from "@/components/prompts/MoveCopyDestination.vue";
import { toStandardLocale } from "@/i18n/index.ts";
import { state } from "@/store";
import { getHumanReadableFilesize } from "@/utils/filesizes";
import { summarizeItems } from "@/utils/moveCopyPlan";
import { formatElapsed, formatTimeLeft } from "@/utils/transferTiming.js";

export default {
  name: "MoveCopySummary",
  components: { MoveCopyDestination },
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
    // Sources the destination can switch to
    sources: {
      type: Array,
      default: () => [],
    },
    // Lets the destination row change the folder; off inside shares and while the operation runs
    interactive: {
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
    // { done, total, current } while the operation runs, done and total counting items; with
    // copied and size, the current item's bytes, when the server reports them; and with startedAt,
    // now, fraction, bytesPerSecond, remainingMs, estimating and finishing from utils/transferTiming.js
    progress: {
      type: Object,
      default: null,
    },
  },
  emits: ["navigate"],
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
    byBytes() {
      return this.progress?.size > 0;
    },
    // Counting items, a single one can only show that something is happening
    determinate() {
      return this.byBytes || this.progress?.total > 1;
    },
    // Finished items plus how far the current one is, weighted by size when the timing has sizes
    percent() {
      const { done, total, fraction } = this.progress;
      if (!total) return 0;
      const current = this.byBytes ? Math.min(this.progress.copied / this.progress.size, 1) : 0;
      const value = Math.floor((fraction ?? (done + current) / total) * 100);
      // Full only once every item is through: a move still deletes the source after copying it
      return done < total ? Math.min(value, 99) : 100;
    },
    countLabel() {
      if (!(this.progress?.total > 1)) return "";
      return this.$t("prompts.moveCopyProgress", { done: this.progress.done, total: this.progress.total });
    },
    bytesLabel() {
      if (!this.byBytes) return "";
      return this.$t("prompts.moveCopyBytesProgress", {
        done: getHumanReadableFilesize(this.progress.copied),
        total: getHumanReadableFilesize(this.progress.size),
      });
    },
    progressLabel() {
      if (!this.determinate) {
        return this.$t("prompts.operationInProgress");
      }
      return [this.countLabel, this.progress.current, this.bytesLabel].filter(Boolean).join(", ");
    },
    speedLabel() {
      const rate = this.progress?.bytesPerSecond;
      return rate > 0 ? `${getHumanReadableFilesize(rate)}/s` : "";
    },
    timed() {
      return Number.isFinite(this.progress?.startedAt) && Number.isFinite(this.progress?.now);
    },
    elapsedLabel() {
      return this.$t("prompts.moveCopyElapsed", { time: formatElapsed(this.progress.now - this.progress.startedAt) });
    },
    timeLeftLabel() {
      const { remainingMs, estimating, finishing } = this.progress;
      if (Number.isFinite(remainingMs)) {
        const locale = toStandardLocale(state.user?.locale || "en");
        return this.$t("prompts.moveCopyTimeLeft", { time: formatTimeLeft(remainingMs, locale) });
      }
      if (finishing) return this.$t("prompts.moveCopyFinishing");
      return estimating ? this.$t("prompts.moveCopyEstimating") : "";
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

/* :deep() so these also style the destination row, a child component */
.move-copy-summary :deep(.move-copy-summary-text) {
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-copy-summary :deep(.move-copy-summary-muted) {
  flex: 0 0 auto;
  color: var(--textSecondary);
}

.move-copy-summary :deep(.move-copy-summary-source) {
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

/* Long names and longer languages wrap rather than push the rest out of view */
.move-copy-progress-status {
  flex-wrap: wrap;
  row-gap: 0.2em;
}

.move-copy-progress-status .move-copy-progress-current {
  flex: 0 1 auto;
}

/* Between the count, the item and its bytes, whichever are shown */
.move-copy-progress-status > * + *::before {
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
