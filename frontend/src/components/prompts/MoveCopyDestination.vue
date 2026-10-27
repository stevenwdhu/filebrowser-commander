<template>
  <div class="move-copy-summary-row move-copy-destination" data-testid="move-copy-destination">
    <span :id="labelId" class="move-copy-summary-muted">{{ $t("prompts.destinationPath") }}</span>
    <span v-if="canSwitchSource" class="move-copy-destination-source">
      <select
        :value="source"
        :aria-label="$t('sidebar.chooseSource')"
        :title="$t('sidebar.chooseSource')"
        data-testid="move-copy-destination-source"
        @change="switchSource"
        @keydown.enter.prevent
      >
        <option v-for="name in sourceOptions" :key="name" :value="name">{{ name }}</option>
      </select>
      <i class="material-symbols" aria-hidden="true">expand_more</i>
    </span>
    <span v-else-if="showSource && source" class="move-copy-summary-source">{{ source }}</span>
    <input
      v-if="editing"
      ref="input"
      v-model="draft"
      type="text"
      class="input move-copy-destination-input"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      :aria-label="$t('prompts.typeDestinationPath')"
      data-testid="move-copy-destination-input"
      @keydown="onInputKeydown"
      @blur="onInputBlur"
    />
    <span v-else-if="!interactive" class="move-copy-summary-text" :title="path">{{ path }}</span>
    <!-- Each folder is a button that opens it in the list below. Enter is handled on every control
         here (and prevented) because the prompt otherwise treats Enter as Copy/Move. -->
    <span
      v-else
      :ref="pinCrumbs"
      class="move-copy-destination-crumbs"
      role="group"
      :aria-labelledby="labelId"
      :title="path"
    >
      <button
        type="button"
        class="move-copy-destination-crumb"
        :aria-label="$t('general.home')"
        :aria-current="path === '/' ? 'location' : undefined"
        data-testid="move-copy-destination-crumb"
        @click="go('/')"
        @keydown.enter.prevent="go('/')"
      >{{ separator }}</button>
      <template v-for="segment in segments" :key="segment.path">
        <button
          type="button"
          class="move-copy-destination-crumb"
          :aria-current="segment.path === path ? 'location' : undefined"
          data-testid="move-copy-destination-crumb"
          @click="go(segment.path)"
          @keydown.enter.prevent="go(segment.path)"
        >{{ segment.name }}</button>
        <span class="move-copy-destination-separator" aria-hidden="true">{{ separator }}</span>
      </template>
    </span>
    <button
      v-if="interactive && !editing"
      ref="editButton"
      type="button"
      class="move-copy-destination-edit"
      :aria-label="$t('prompts.typeDestinationPath')"
      :title="$t('prompts.typeDestinationPath')"
      data-testid="move-copy-destination-edit"
      @click="startEditing"
      @keydown.enter.prevent="startEditing"
    >
      <i class="material-symbols" aria-hidden="true">edit</i>
    </button>
  </div>
</template>

<script>
import { parseTypedPath, pathSegments } from "@/utils/moveCopyDestinations";

let nextId = 0;

export default {
  name: "MoveCopyDestination",
  props: {
    source: {
      type: String,
      default: null,
    },
    path: {
      type: String,
      default: "/",
    },
    // Name the source (off inside shares and with a single source)
    showSource: {
      type: Boolean,
      default: false,
    },
    // Sources the destination can switch to
    sources: {
      type: Array,
      default: () => [],
    },
    // Off inside shares and while the operation runs: the path is plain text then
    interactive: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["navigate"],
  data: () => ({
    labelId: `move-copy-destination-${++nextId}`,
    separator: "/", // Not a word, so not translated
    editing: false,
    draft: "",
  }),
  computed: {
    segments() {
      return pathSegments(this.path);
    },
    sourceOptions() {
      if (!this.source || this.sources.includes(this.source)) return this.sources;
      return [this.source, ...this.sources];
    },
    canSwitchSource() {
      return this.interactive && this.showSource && this.sourceOptions.length > 1;
    },
  },
  watch: {
    async path() {
      await this.$nextTick();
      this.pinCrumbs(this.crumbsElement);
    },
    interactive(now) {
      if (!now) this.editing = false;
    },
  },
  methods: {
    go(path) {
      this.$emit("navigate", { source: this.source, path });
    },
    // Keep the deepest folder in view when the path is too long for the row: when the crumbs appear
    // (again after editing or an operation) and when the path changes
    pinCrumbs(element) {
      this.crumbsElement = element;
      if (element) element.scrollLeft = element.scrollWidth;
    },
    switchSource(event) {
      const source = event.target.value;
      // The prompt decides; the select shows the new source once it comes back as the prop
      event.target.value = this.source;
      if (source && source !== this.source) {
        // No path: the prompt picks the folder to show in that source
        this.$emit("navigate", { source, path: null });
      }
    },
    async startEditing() {
      this.draft = this.path;
      this.editing = true;
      await this.$nextTick();
      this.$refs.input?.focus();
      this.$refs.input?.select();
    },
    onInputKeydown(event) {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      // Keep the prompt from confirming (Enter) or closing (Escape)
      event.stopPropagation();
      // The key belongs to an input method (IME) composing text, e.g. choosing a candidate
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      void this.finishEditing({ commit: event.key === "Enter", refocus: true });
    },
    onInputBlur() {
      // Switching to another window or tab leaves the field focused for when the user returns: keep editing
      if (document.activeElement === this.$refs.input) return;
      void this.finishEditing({ commit: true });
    },
    async finishEditing({ commit, refocus = false }) {
      if (!this.editing) return;
      this.editing = false;
      const path = commit ? parseTypedPath(this.draft) : null;
      if (path && path !== this.path) {
        this.$emit("navigate", { source: this.source, path });
      }
      if (refocus) {
        await this.$nextTick();
        this.$refs.editButton?.focus();
      }
    },
  },
};
</script>

<style scoped>
/* Shrinks before the path does, e.g. a long source name on a phone */
.move-copy-destination-source {
  position: relative;
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  min-width: 0;
  max-width: 40%;
}

.move-copy-destination-source select {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  appearance: none;
  padding: 0 1.5em 0 0.4em;
  border: 1px solid var(--divider);
  border-radius: var(--borderRadius);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.move-copy-destination-source select:hover,
.move-copy-destination-source select:focus-visible {
  border-color: var(--primaryColor);
}

.move-copy-destination-source i {
  position: absolute;
  right: 0.2em;
  font-size: 1.2em;
  pointer-events: none;
}

/* Paths read left to right in every language */
.move-copy-destination-crumbs,
.move-copy-destination-input {
  direction: ltr;
}

.move-copy-destination-crumbs {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow-x: auto;
  font-weight: 500;
  white-space: nowrap;
  scrollbar-width: none;
}

.move-copy-destination-crumbs::-webkit-scrollbar {
  display: none;
}

/* Narrower than the global 2em button minimum, so the path reads as text */
.move-copy-destination-crumb {
  flex: 0 0 auto;
  min-width: 0;
  padding: 0 0.2em;
  border: 0;
  border-radius: 0.25em;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.move-copy-destination-crumb:hover,
.move-copy-destination-crumb:focus-visible {
  color: var(--primaryColor);
  text-decoration: underline;
}

.move-copy-destination-separator {
  flex: 0 0 auto;
}

.move-copy-destination-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0.1em 0.4em;
  font: inherit;
}

.move-copy-destination-edit {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 0.1em;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--textSecondary);
  cursor: pointer;
}

.move-copy-destination-edit:hover,
.move-copy-destination-edit:focus-visible {
  color: var(--primaryColor);
}

.move-copy-destination-edit i {
  font-size: 1.1em;
}

/* Outlines are off app-wide, so keyboard focus needs a cue that isn't only a color change */
.move-copy-destination-source select:focus-visible,
.move-copy-destination-edit:focus-visible {
  outline: 2px solid var(--primaryColor);
  outline-offset: 1px;
}
</style>
