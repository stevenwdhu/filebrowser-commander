<template>
  <div class="card-content">
    <!-- Drag and drop prompts only show the spinner; the drop handler runs the operation -->
    <MoveCopySummary
      v-if="!operationInProgress"
      :items="localItems"
      :dest-source="resolvedDestSource"
      :dest-path="destPath"
      :show-source="showDestSource"
      :block-message="blockMessage"
      :block-message-id="blockMessageId"
      :progress="progress"
    />
    <!-- Loading spinner overlay -->
    <!-- changed to v-show (for keep the loading spinner), otherwise the path showed in the prompt will be always "/" -->
    <div v-show="isLoading && !progress" class="loading-content">
      <LoadingSpinner size="small" mode="placeholder" />
      <p class="loading-text">{{ $t("prompts.operationInProgress") }}</p>
    </div>
    <div v-show="!isLoading">
      <file-list
        ref="fileList"
        :browse-path="initialBrowsePath"
        :hide-path-chrome="!isShareContext"
        :sortable="true"
        v-model:filter-query="filterQuery"
        @update:selected="updateDestination"
      >
        <template #sticky>
          <PathPickerButton
            v-if="!isShareContext"
            v-model:path="destPath"
            v-model:source="destSource"
            class="move-copy-path-picker"
            :show-files="false"
            :show-folders="true"
            :placeholder="$t('sidebar.chooseSource')"
            @navigate="syncFileListFromPicker"
          />
          <MoveCopyQuickDestinations
            v-if="!isShareContext"
            :dest-source="destSource"
            :dest-path="destPath"
            @select="selectQuickDestination"
          />
        </template>
      </file-list>
    </div>
  </div>
  <div class="card-actions split-buttons" >
    <ListingFilter v-if="!showNewDirInput" v-model="filterQuery" :disabled="isLoading" />
    <button
      type="button"
      v-if="canCreateFolder && showNewDirInput"
      class="button button--flat button--grey"
      :disabled="isLoading"
      @click="cancelNewDir"
      :aria-label="$t('general.cancel')"
      :title="$t('general.cancel')"
    >
      {{ $t("general.cancel") }}
    </button>
    <button
      type="button"
      v-if="canCreateFolder && !showNewDirInput"
      class="button button--flat"
      :disabled="isLoading"
      @click="createNewDir"
      :aria-label="$t('files.newFolder')"
      :title="$t('files.newFolder')"
    >
      <span>{{ $t("files.newFolder") }}</span>
    </button>
    <input v-if="showNewDirInput" ref="newDirInput" class="input new-dir-input" :class="{ 'form-invalid': !isDirNameValid }"
    v-model.trim="newDirName" :placeholder="$t('files.newFolderMessage')" @keydown.enter="handleEnter" />
    <button
      type="button"
      v-else
      :disabled="isLoading"
      :aria-disabled="blockReason ? 'true' : undefined"
      class="button button--flat"
      @click="performOperation"
      :aria-label="operation === 'move' ? $t('general.move') : $t('general.copy')"
      :aria-describedby="blockReason ? blockMessageId : undefined"
      :title="blockMessage || (operation === 'move' ? $t('general.move') : $t('general.copy'))"
    >
      {{ operation === 'move' ? $t('general.move') : $t('general.copy') }}
    </button>
    <button
      type="button"
      v-if="showNewDirInput"
      class="button button--flat"
      @click="createDirectory"
      :disabled="isLoading || !newDirName || !isDirNameValid"
    >
      {{ $t("general.create") }}
    </button>
  </div>
</template>

<script>
import { mutations, state, getters } from "@/store";
import FileList from "../files/FileList.vue";
import { resourcesApi } from "@/api";
import buttons from "@/utils/buttons";
import { checkConflict } from "@/utils/upload";
import { url } from "@/utils";
import { notify } from "@/notify";
import {
  notifyMoveCopyComplete,
  notifyOperationError,
  notifyMoveCopyFailure,
  extractMoveCopyErrorMessage,
} from "@/utils/appNotifications";
import { goToItemNotificationButton } from "@/utils/notificationActions";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import PathPickerButton from "@/components/files/PathPickerButton.vue";
import ListingFilter from "@/components/files/ListingFilter.vue";
import MoveCopyQuickDestinations from "@/components/prompts/MoveCopyQuickDestinations.vue";
import MoveCopySummary from "@/components/prompts/MoveCopySummary.vue";
import { eventBus } from '@/store/eventBus';
import { normalizeDirPath, recordRecentDestination } from "@/utils/moveCopyDestinations";
import { blockReasonMessage, moveCopyBlockReason, runInBatches } from "@/utils/moveCopyPlan";

export default {
  name: "move-copy",
  components: { FileList, LoadingSpinner, PathPickerButton, ListingFilter, MoveCopyQuickDestinations, MoveCopySummary },
  props: {
    promptId: {
      type: [String, Number],
      default: null,
    },
    operation: {
      type: String,
      required: true,
      validator: (value) => ["move", "copy"].includes(value),
    },
    // When true, immediately shows loading state (for drag and drop operations)
    operationInProgress: {
      type: Boolean,
      default: false,
    },
    items: {
      type: Array,
      default: null,
    },
  },
  data: () => ({
    current: window.location.pathname,
    destPath: "/", // Start at root of selected source
    destSource: null, // Will be set by FileList component
    destError: false, // The destination listing failed to load
    localItems: [], // Will hold the items to operate on
    isLoading: false, // Track loading state for spinner
    showNewDirInput: false, // When true will replace the new folder button with a input field
    newDirName: "",
    filterQuery: "",
    progress: null, // { done, total, current } while items are being copied/moved
  }),
  computed: {
    // From a file preview, start in the file's folder rather than at the file itself
    initialBrowsePath() {
      const req = state.req;
      if (!req?.type || req.type === "directory" || !req.path) {
        return null;
      }
      return normalizeDirPath(url.removeLastDir(req.path));
    },
    resolvedDestSource() {
      return this.destSource || this.localItems[0]?.fromSource || state.req?.source;
    },
    // Mirrors the server: a share only needs modify; otherwise copy needs create on the destination
    // and a move to another source needs modify
    canWriteDestination() {
      const perms = getters.sourcePermissions(this.resolvedDestSource);
      if (getters.isShare()) {
        return Boolean(perms?.modify);
      }
      if (this.operation === "copy") {
        return Boolean(perms?.create);
      }
      return this.resolvedDestSource === this.localItems[0]?.fromSource || Boolean(perms?.modify);
    },
    blockReason() {
      if (this.operationInProgress) {
        return null;
      }
      return moveCopyBlockReason({
        operation: this.operation,
        items: this.localItems,
        destSource: this.resolvedDestSource,
        destPath: this.destPath,
        destError: this.destError,
        canWrite: this.canWriteDestination,
      });
    },
    blockMessage() {
      return blockReasonMessage(this.blockReason, (key) => this.$t(key));
    },
    showDestSource() {
      return !this.isShareContext && Object.keys(state.sources?.info || {}).length > 1;
    },
    blockMessageId() {
      return `move-copy-blocked-${this.promptId ?? "prompt"}`;
    },
    canCreateFolder() {
      const destSource =
        this.destSource || this.localItems[0]?.fromSource || state.req?.source;
      return getters.canCreateInSource(destSource);
    },
    isDirNameValid() {
      return this.validateDirName(this.newDirName);
    },
    isShareContext() {
      return getters.isShare();
    },
  },
  mounted() {
    // If props.items is provided, use it. Otherwise use state
    if (this.items && this.items.length > 0) {
      this.localItems = this.items.map(item => ({
        from: item.path,
        fromSource: item.source,
        name: item.name,
        type: item.type,
        size: item.size,
      }));
    } else if (state.isSearchActive) {
      // Add null checks to prevent undefined values
      if (state.selected[0]?.path) {
        this.localItems = [
          {
            from: state.selected[0].path,
            fromSource: state.selected[0].source,
            name: state.selected[0].name,
            type: state.selected[0].type,
            size: state.selected[0].size,
          },
        ];
      }
    } else {
      if (state.selected && state.req?.items) {
        for (const item of state.selected) {
          const reqItem = state.req.items.at(item);
          if (reqItem?.path) {
            this.localItems.push({
              from: reqItem.path,
              fromSource: state.req.source,
              name: reqItem.name,
              type: reqItem.type,
              size: reqItem.size,
            });
          }
        }
      }
    }
    if (this.operationInProgress) {
      this.isLoading = true;
    }
  },
  methods: {
    selectQuickDestination({ source, path }) {
      if (!source || this.isLoading) return;
      this.destSource = source;
      this.destPath = normalizeDirPath(path);
      void this.syncFileListFromPicker();
    },
    async syncFileListFromPicker() {
      this.destError = false; // FileList reports again once the new listing loads
      await this.$nextTick();
      if (this.$refs.fileList && this.destSource && this.destPath) {
        this.$refs.fileList.jumpTo(this.destSource, this.destPath);
      }
    },
    async createNewDir() {
      this.showNewDirInput = true;
      this.newDirName = "";
      // Focus the new dir input automatically
      await this.$nextTick();
      this.$refs.newDirInput.focus();
    },
    validateDirName(value) {
      // Check if a folder with the same name already exists in current directory
      if (this.$refs.fileList?.items) {
        const currentItems = this.$refs.fileList.items.filter(item => item.name !== '..');
        return !currentItems.some(item => item.name.toLowerCase() === value.toLowerCase());
      }
      return true;
    },
    cancelNewDir() {
      // Clicking cancel will return the buttons to their normal state
      this.showNewDirInput = false;
      this.newDirName = "";
    },
    handleEnter(event) {
      // Trigger create if you press enter instead of move/copy
      event.stopPropagation();
      event.preventDefault();
      if (this.newDirName && this.isDirNameValid) {
        void this.createDirectory();
      }
    },
    async createDirectory() {
      if (!this.newDirName || !this.isDirNameValid) return;
      try {
        this.isLoading = true;
        // Get current navigation from FileList
        const currentPath = this.$refs.fileList.path;
        const currentSource = this.$refs.fileList.source;
        const fullPath = currentPath.endsWith('/') ? `${currentPath + this.newDirName}/` : `${currentPath}/${this.newDirName}/`;
        if (getters.isShare()) {
          await resourcesApi.postPublic(state.shareInfo?.hash, fullPath, "", false, undefined, {}, true);
        } else {
          await resourcesApi.post(currentSource, fullPath, "", false, undefined, {}, true);
        }
        // Refresh the file list while keeping the current navigation that we did in the prompt
        if (getters.isShare()) {
          await resourcesApi.fetchFilesPublic(currentPath, state.shareInfo.hash)
            .then((req) => this.$refs.fileList.fillOptions(req, true));
        } else {
          await resourcesApi.fetchFiles(currentSource, currentPath)
            .then((req) => this.$refs.fileList.fillOptions(req, true));
        }
        // Clicking create will also return the buttons to their normal state
        mutations.setReload(true);
        this.showNewDirInput = false;
        this.newDirName = "";
      } catch (error) {
        console.error('Error creating directory:', error);
      } finally {
        this.isLoading = false;
      }
    },
    updateDestination(pathOrData) {
      // Handle both old format (just path) and new format (object with path and source)
      if (typeof pathOrData === 'string') {
        this.destPath = pathOrData;
        // For backward compatibility, keep the current source
        // This will be updated when FileList is modified to emit both
      } else if (pathOrData?.path) {
        this.destPath = pathOrData.path;
        // Update destSource from FileList's selection
        this.destSource = pathOrData.source;
        this.destError = Boolean(pathOrData.error);
      }
    },
    async performOperation(event) {
      event.preventDefault();
      if (this.isLoading || this.blockReason) {
        return;
      }
      this.isLoading = true; // Show loading spinner
      try {
        // Ensure destination source is set
        if (!this.destSource) {
          // If no destination source yet, use the source from the first item (or current source)
          this.destSource = this.localItems[0]?.fromSource || state.req.source;
        }
        // Build items with destination paths
        const itemsToProcess = this.localItems.map(item => {
          // Ensure proper path construction without double slashes
          const destPath = this.destPath.endsWith('/') ? this.destPath : `${this.destPath}/`;
          return {
            ...item,
            to: destPath + item.name,
            toSource: this.destSource,
          };
        });
        // Define the action function
        // Items go in batches so the prompt can show progress; the results are merged
        const action = async (overwrite, rename) => {
          buttons.loading(this.operation);
          const runBatch = (batch) => (getters.isShare()
            ? resourcesApi.moveCopyPublic(state.shareInfo.hash, batch, this.operation, overwrite, rename)
            : resourcesApi.moveCopy(batch, this.operation, overwrite, rename));
          return runInBatches(itemsToProcess, runBatch, (progress) => {
            this.progress = progress;
          });
        };
        let conflict = false;
        let dstResp = null;
        if (getters.isShare()) {
          dstResp = await resourcesApi.fetchFilesPublic(this.destPath, state.shareInfo?.hash);
        } else {
          dstResp = await resourcesApi.fetchFiles(this.destSource, this.destPath);
        }
        conflict = checkConflict(itemsToProcess, dstResp.items);
        let overwrite = false;
        let rename = false;
        let result = null;

        if (conflict) {
          this.isLoading = false;
          // Check if any item is being copied/moved to itself
          const isSameFile = itemsToProcess.some(item => {
            const destPath = this.destPath.endsWith('/') ? this.destPath : `${this.destPath}/`;
            const targetPath = destPath + item.name;
            return item.from === targetPath && item.fromSource === this.destSource;
          });

          await new Promise((resolve, reject) => {
            mutations.showPrompt({
              name: "replace-rename",
              pinned: true,
              props: {
                isSameFile: isSameFile,
                operation: this.operation,
                destSource: this.destSource,
              },
              confirm: async (event, option) => {
                overwrite = option === "overwrite";
                rename = option === "rename";
                event.preventDefault();
                try {
                  this.isLoading = true;
                  result = await action(overwrite, rename);
                  resolve(); // Resolve the promise if action succeeds
                } catch (e) {
                  reject(e); // Reject the promise if an error occurs
                } finally {
                  this.isLoading = false;
                  this.progress = null;
                }
              },
            });
          });
        } else {
          // Await the action call for non-conflicting cases
          result = await action(overwrite, rename);
        }

        // Check if there were any failures in the result
        const hasFailures = result?.failed && result.failed.length > 0;
        const hasSuccesses = result?.succeeded && result.succeeded.length > 0;

        if (hasFailures && !hasSuccesses) {
          const errorMessage = extractMoveCopyErrorMessage(
            { failed: result.failed },
            this.$t("prompts.operationFailed"),
          );
          notify.showError(errorMessage);
          notifyOperationError(errorMessage);
          return;
        } else if (hasFailures && hasSuccesses) {
          // Partial failure - show warning and continue
          const failedCount = result.failed.length;
          const succeededCount = result.succeeded.length;
          notify.showError(
            this.$t("prompts.partialSuccess", { succeeded: succeededCount, failed: failedCount })
          );
        }

        if (!getters.isShare()) {
          recordRecentDestination(state.user?.username, this.destSource, this.destPath);
        }

        // Determine if we should navigate (we can move items with fileTree context menu in previews)
        const shouldNavigate = getters.isPreviewView() && this.operation === 'move';
        let currentItemMoved = false;

        if (shouldNavigate) {
          currentItemMoved = this.localItems.some(item =>
            item.from === state.req?.path && item.fromSource === state.req?.source
          );
        }

        if (shouldNavigate && currentItemMoved) {
          eventBus.emit('itemsMoved');
          mutations.closeTopPrompt(); // close conflict prompt
          mutations.closeTopPrompt(); // close moveCopy prompt

          if (!hasFailures || hasSuccesses) {
            notify.showSuccessToast(this.$t("prompts.moveSuccess"));
            notifyMoveCopyComplete("move", this.localItems.length);
          }

          // Navigate next, previous or parent dir (like when deleting)
          const next = state.navigation.nextItem;
          const prev = state.navigation.previousItem;
          if (next) {
            url.goToItem(next.source, next.path, undefined, false, getters.isShare());
          } else if (prev) {
            url.goToItem(prev.source, prev.path, undefined, false, getters.isShare());
          } else {
            url.goToItem(state.req.source, url.removeLastDir(state.req.path), {}, false, getters.isShare());
          }
        } else {

          // Only close prompts and reload on success (or partial success)
          mutations.setReload(true);
          mutations.closeTopPrompt(); // close conflict prompt
          mutations.closeTopPrompt(); // close moveCopy prompt after conflict is resolved and file copied/moved
          mutations.setSearch(false); // close search if open

          // Only show success notification if there were no failures (or partial success was already shown)
          if (!hasFailures || hasSuccesses) {
            // Store destination info for the button action
            const destSource = this.destSource;
            const destPath = this.destPath;

            const buttonProps = {
              icon: "folder",
              buttons: destPath
                ? [
                    goToItemNotificationButton(
                      this.$t("buttons.goToItem"),
                      destSource || state.shareInfo?.hash,
                      destPath,
                      getters.isShare()
                    ),
                  ]
                : undefined,
            };
            if (this.operation === "move") {
              notify.showSuccess(this.$t("prompts.moveSuccess"), buttonProps);
              notifyMoveCopyComplete("move", this.localItems.length);
            } else {
              notify.showSuccess(this.$t("prompts.copySuccess"), buttonProps);
              notifyMoveCopyComplete("copy", this.localItems.length);
            }
          }
        }
      } catch (error) {
        notifyMoveCopyFailure(error, this.$t("prompts.operationFailed"));
      } finally {
        this.isLoading = false; // Hide loading spinner
        this.progress = null;
      }
    },
  },
};
</script>

<style scoped>
.loading-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding-top: 2em;
}

.loading-text {
  padding: 1em;
  margin: 0;
  font-size: 1em;
  font-weight: 500;
}

/* Make card-content position relative for absolute positioning of overlay */
.card-content {
  position: relative;
}

.new-dir-input {
  justify-self: left
}

.split-buttons {
  justify-content: space-between;
}

/* Blocked but still focusable, so the reason is read out */
.button[aria-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
}

</style>
