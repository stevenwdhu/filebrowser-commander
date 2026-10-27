<template>
  <div v-if="favorites.length > 0 || recents.length > 0" class="quick-destinations">
    <div v-if="favorites.length > 0" class="quick-destinations-group">
      <span class="quick-destinations-label">{{ $t("prompts.favoriteDestinations") }}</span>
      <div
        class="quick-destinations-row"
        role="group"
        :aria-label="$t('prompts.favoriteDestinations')"
        @wheel="scrollRow"
      >
        <button
          v-for="dest in favorites"
          :key="dest.key"
          type="button"
          class="quick-destination"
          :class="{ active: dest.key === activeKey }"
          :aria-current="dest.key === activeKey || undefined"
          :title="describe(dest)"
          data-testid="move-copy-favorite"
          @click="select(dest)"
          @keydown.enter="onEnter($event, dest)"
        >
          <i v-if="dest.icon" class="material-symbols quick-destination-icon" aria-hidden="true">{{ dest.icon }}</i>
          <i v-else-if="dest.path === '/'" class="material-symbols quick-destination-icon" aria-hidden="true">storage</i>
          <i v-else class="material-symbols quick-destination-icon" aria-hidden="true">folder</i>
          <span class="quick-destination-name">{{ dest.name }}</span>
        </button>
      </div>
    </div>
    <div v-if="recents.length > 0" class="quick-destinations-group">
      <span class="quick-destinations-label">{{ $t("prompts.recentDestinations") }}</span>
      <div
        class="quick-destinations-row"
        role="group"
        :aria-label="$t('prompts.recentDestinations')"
        @wheel="scrollRow"
      >
        <button
          v-for="dest in recents"
          :key="dest.key"
          type="button"
          class="quick-destination"
          :class="{ active: dest.key === activeKey }"
          :aria-current="dest.key === activeKey || undefined"
          :title="describe(dest)"
          data-testid="move-copy-recent"
          @click="select(dest)"
          @keydown.enter="onEnter($event, dest)"
        >
          <i class="material-symbols quick-destination-icon" aria-hidden="true">folder</i>
          <span class="quick-destination-name">{{ dest.name }}</span>
          <span v-if="showSource" class="quick-destination-source">{{ dest.source }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { getters, state } from "@/store";
import {
  buildFavoriteDestinations,
  destinationKey,
  loadRecentDestinations,
} from "@/utils/moveCopyDestinations";

/** Last `depth` path segments, e.g. depth 2 of "/photos/2024/" is "photos/2024". */
function trailingSegments(path, depth) {
  return path.split("/").filter(Boolean).slice(-depth).join("/");
}

export default {
  name: "MoveCopyQuickDestinations",
  props: {
    // Current destination of the prompt, used to highlight the matching chip
    destSource: {
      type: String,
      default: null,
    },
    destPath: {
      type: String,
      default: "/",
    },
  },
  emits: ["select"],
  data: () => ({
    storedRecents: [], // Read once when the prompt opens
  }),
  computed: {
    favorites() {
      return buildFavoriteDestinations(state.user?.sidebarLinks, state.sources?.info, state.user?.scopes)
        .filter((dest) => getters.canCreateInSource(dest.source));
    },
    recents() {
      // Favorites already have a chip, so don't repeat them as recents
      const favoriteKeys = new Set(this.favorites.map((dest) => dest.key));
      const recents = this.storedRecents.filter(
        (dest) => !favoriteKeys.has(dest.key) && getters.canCreateInSource(dest.source),
      );
      // Label with the folder name, adding its parent when two recents in one source share it
      const label = (dest, depth) => trailingSegments(dest.path, depth) || dest.source;
      const counts = new Map();
      for (const dest of recents) {
        const id = `${dest.source}::${label(dest, 1)}`;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      return recents.map((dest) => ({
        ...dest,
        name: counts.get(`${dest.source}::${label(dest, 1)}`) > 1 ? label(dest, 2) : label(dest, 1),
      }));
    },
    activeKey() {
      return this.destSource ? destinationKey(this.destSource, this.destPath) : "";
    },
    // Recents show their source name when there is more than one source
    showSource() {
      return Object.keys(state.sources?.info || {}).length > 1;
    },
  },
  created() {
    this.storedRecents = loadRecentDestinations(state.user?.username, state.sources?.info);
  },
  methods: {
    select(dest) {
      this.$emit("select", { source: dest.source, path: dest.path });
    },
    onEnter(event, dest) {
      // Enter on the current destination falls through to the prompt's Copy/Move
      if (dest.key === this.activeKey) return;
      event.preventDefault();
      this.select(dest);
    },
    describe(dest) {
      return `${dest.path} (${dest.source})`;
    },
    // Rows scroll horizontally with a hidden scrollbar; let a vertical mouse wheel scroll them too,
    // but hand the wheel back to the prompt once the row can't move any further
    scrollRow(event) {
      const row = event.currentTarget;
      if (!row || event.deltaX !== 0 || event.deltaY === 0) return;
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 1) return;
      const atStart = row.scrollLeft <= 0;
      const atEnd = Math.ceil(row.scrollLeft) >= max - 1;
      if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) return;
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    },
  },
};
</script>

<style scoped>
.quick-destinations {
  display: flex;
  flex-direction: column;
  gap: 0.25em;
}

.quick-destinations-group {
  display: flex;
  align-items: center;
  gap: 0.5em;
  min-width: 0;
}

.quick-destinations-label {
  flex: 0 0 auto;
  font-size: 0.8em;
  font-weight: 500;
  color: var(--textSecondary);
}

.quick-destinations-row {
  display: flex;
  flex: 1 1 auto;
  gap: 0.4em;
  min-width: 0;
  padding: 2px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}

.quick-destinations-row::-webkit-scrollbar {
  display: none;
}

.quick-destination {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.3em;
  max-width: 14em;
  min-height: 2em;
  padding: 0.2em 0.75em;
  border: 1px solid var(--divider);
  border-radius: var(--borderRadius);
  background: var(--surfacePrimary);
  color: var(--textPrimary);
  font-size: 0.9em;
  white-space: nowrap;
  cursor: pointer;
}

/* The global button hover scale would be clipped by the scrolling row */
.quick-destination:hover {
  transform: none;
}

.quick-destination:focus-visible {
  outline: 2px solid var(--primaryColor);
  outline-offset: -2px;
}

.quick-destination.active {
  border-color: var(--primaryColor);
  background: color-mix(in srgb, var(--primaryColor) 25%, transparent);
}

.quick-destination-icon {
  font-size: 1.15em;
  color: var(--primaryColor);
}

.quick-destination-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-destination-source {
  color: var(--textSecondary);
  font-size: 0.85em;
}
</style>
