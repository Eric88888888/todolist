<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { storeToRefs } from 'pinia';
import TaskComposer from './components/TaskComposer.vue';
import TaskItem from './components/TaskItem.vue';
import TaskMenu from './components/TaskMenu.vue';
import { useTaskStore } from './stores/taskStore';
import { runDailyBackup } from './services/backupService';
import { useDragSort } from './composables/useDragSort';
import { useReminders } from './composables/useReminders';
import { localInputToIsoUtc } from './utils/datetime';
import type { Task, TaskColor, TaskFilter } from './types/task';
import type { Subtask } from './types/subtask';
import type { MenuAnchor } from './types/ui';

const store = useTaskStore();
const {
  visibleTasks,
  filter,
  query,
  loading,
  errorMessage,
  activeCount,
  doneCount,
  totalCount,
  pinnedCount,
  overdueCount,
  progress,
} = storeToRefs(store);

const FILTERS: ReadonlyArray<{ key: TaskFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'done', label: '已完成' },
];

const filterCounts = computed<Record<TaskFilter, number>>(() => ({
  all: totalCount.value,
  active: activeCount.value,
  done: doneCount.value,
}));

const ringStyle = computed<Record<string, string>>(() => ({ '--p': String(progress.value) }));

/* ---------- 拖拽排序 ----------
   只在「全部」视图下启用：过滤视图里可见的只是子集，
   在子集上重排会把它和隐藏条目之间的相对顺序打乱。 */
const listRef = ref<HTMLElement | null>(null);
const dragEnabled = computed(() => filter.value === 'all' && !query.value.trim());

const { draggingId, dropSlot, startDrag } = useDragSort({
  items: visibleTasks,
  listRef,
  enabled: dragEnabled,
  onDrop: (ordered) => {
    void store.reorder(ordered);
  },
});

function handleGrab(event: PointerEvent, task: Task): void {
  startDrag(event, task);
}

/* ---------- 子任务展开状态 ---------- */
const expandedIds = ref<Record<string, boolean>>({});

function toggleExpand(task: Task): void {
  expandedIds.value = { ...expandedIds.value, [task.id]: !expandedIds.value[task.id] };
}

function handleAddSubtask(task: Task, title: string): void {
  void store.addSubtask(task.id, title);
}

function handleToggleSubtask(subtask: Subtask): void {
  void store.toggleSubtask(subtask);
}

function handleRemoveSubtask(subtask: Subtask): void {
  void store.removeSubtask(subtask);
}

function handleNotes(task: Task, notes: string | null): void {
  void store.setNotes(task, notes);
}

function handleRecurrence(task: Task, raw: string | null): void {
  void store.setRecurrence(task, raw);
}

/* ---------- 到期提醒（常驻托盘时也继续跑） ---------- */
useReminders();

/* ---------- 首次运行提示（关闭到托盘这件事得让人知道） ---------- */
const TRAY_HINT_KEY = 'todolist.tray-hint-seen';
const showTrayHint = ref(false);

function dismissTrayHint(): void {
  showTrayHint.value = false;
  try {
    localStorage.setItem(TRAY_HINT_KEY, '1');
  } catch {
    // 隐私模式下写不了就算了，下次再提示一次不影响使用
  }
}

/* ---------- 选项栏 ---------- */
const menu = ref<{ task: Task; anchor: MenuAnchor } | null>(null);

function openMenu(task: Task, anchor: MenuAnchor): void {
  menu.value = { task, anchor };
}

function closeMenu(): void {
  menu.value = null;
}

function pickColor(color: TaskColor): void {
  const target = menu.value?.task;
  closeMenu();
  if (target) void store.setColor(target, color);
}

function togglePin(): void {
  const target = menu.value?.task;
  closeMenu();
  if (target) void store.togglePin(target);
}

/* ---------- 全局快捷键唤出的「快速记一笔」模式 ---------- */
const composerRef = ref<InstanceType<typeof TaskComposer> | null>(null);
const quickMode = ref(false);
let unlistenQuickAdd: (() => void) | undefined;

async function hideWindow(): Promise<void> {
  await invoke('hide_main_window').catch(() => undefined);
}

function onQuickKeydown(event: KeyboardEvent): void {
  // 选项栏开着的时候 Esc 先关选项栏
  if (event.key === 'Escape' && quickMode.value && !menu.value) {
    quickMode.value = false;
    void hideWindow();
  }
}

function onWindowBlur(): void {
  // 窗口失焦说明用户干别的去了，退出快捷模式，免得下次正常添加时窗口莫名消失
  quickMode.value = false;
}

/* ---------- 提示条 ---------- */
const notice = ref('');
let noticeTimer: number | undefined;

function showNotice(text: string): void {
  notice.value = text;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.value = '';
  }, 4200);
}

/* ---------- 启动 ---------- */
onMounted(async () => {
  try {
    if (!localStorage.getItem(TRAY_HINT_KEY)) showTrayHint.value = true;
  } catch {
    showTrayHint.value = true;
  }

  unlistenQuickAdd = await listen('quick-add', () => {
    quickMode.value = true;
    void nextTick(() => {
      // 窗口刚被 Rust 显示出来，等一帧再聚焦，否则焦点会被系统抢走
      window.setTimeout(() => composerRef.value?.focusTitle(), 60);
    });
  });
  window.addEventListener('keydown', onQuickKeydown);
  window.addEventListener('blur', onWindowBlur);

  await store.load();
  // 备份放在加载之后：此刻数据库已经打开、迁移也跑完了
  const backup = await runDailyBackup();
  if (backup.created) showNotice('已自动备份今天的数据库');
});

onUnmounted(() => {
  window.clearTimeout(noticeTimer);
  window.removeEventListener('keydown', onQuickKeydown);
  window.removeEventListener('blur', onWindowBlur);
  unlistenQuickAdd?.();
});

/* ---------- 交互 ---------- */
async function handleAdd(payload: { title: string; dueAt: string }): Promise<void> {
  const quick = quickMode.value;
  quickMode.value = false;
  await store.add(payload.title, localInputToIsoUtc(payload.dueAt));
  // 快捷记录模式：记完就把窗口收回托盘，不打断当前工作
  if (quick) await hideWindow();
}

function handleToggle(task: Task): void {
  void store.toggle(task);
}

function handleRename(task: Task, title: string): void {
  void store.rename(task, title);
}

function handleRemove(task: Task): void {
  void store.remove(task);
}

function handleClearDone(): void {
  void store.clearDone();
}

const emptyText = computed(() => {
  const needle = query.value.trim();
  if (needle) return `没有匹配「${needle}」的任务`;
  if (filter.value === 'done') return '还没有已完成的任务';
  if (filter.value === 'active') return '没有待完成的任务 —— 全部清空了';
  return '列表是空的，添加第一条待办吧';
});
</script>

<template>
  <div class="app">
    <div class="backdrop" aria-hidden="true"></div>

    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 13 4.5 4.5L19 7" />
          </svg>
        </span>
        <div class="brand__text">
          <h1 class="brand__title">待办清单</h1>
          <p class="brand__subtitle">
            <template v-if="totalCount">
              {{ activeCount }} 项待完成 · {{ doneCount }} 项已完成
              <span v-if="overdueCount" class="is-danger"> · {{ overdueCount }} 项逾期</span>
            </template>
            <template v-else>还没有任务，从下面添加第一条</template>
          </p>
        </div>
      </div>

      <div class="topbar__side">
        <div class="ring" :style="ringStyle" :title="`完成度 ${progress}%`">
          <span class="ring__label">{{ progress }}%</span>
        </div>
        <button v-if="doneCount" class="ghost-btn" type="button" @click="handleClearDone">
          清除已完成
        </button>
      </div>
    </header>

    <TaskComposer ref="composerRef" :quick="quickMode" @submit="handleAdd" />

    <div class="toolbar">
      <nav class="filters" aria-label="筛选">
        <button
          v-for="item in FILTERS"
          :key="item.key"
          class="filter-btn"
          :class="{ 'filter-btn--active': filter === item.key }"
          type="button"
          @click="store.setFilter(item.key)"
        >
          {{ item.label }}
          <span class="filter-btn__count">{{ filterCounts[item.key] }}</span>
        </button>
        <span v-if="query.trim()" class="filters__note">匹配 {{ visibleTasks.length }} 条</span>
        <span v-else-if="filter !== 'all'" class="filters__note">拖动排序请在「全部」下使用</span>
        <span v-else-if="pinnedCount" class="filters__note">另有 {{ pinnedCount }} 项置顶</span>
      </nav>

      <label class="search">
        <svg class="search__icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          v-model="query"
          class="search__input"
          type="text"
          placeholder="搜索标题 / 备注 / 子任务"
          maxlength="60"
          autocomplete="off"
        />
        <button
          v-if="query"
          class="search__clear"
          type="button"
          title="清空搜索"
          @click="query = ''"
        >
          ×
        </button>
      </label>
    </div>

    <p v-if="errorMessage" class="error" @click="store.clearError()">{{ errorMessage }}</p>

    <p v-if="showTrayHint" class="hint" @click="dismissTrayHint">
      关闭窗口不会退出，应用会留在系统托盘；按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> 可随时唤出快速记一条 · 点此收起
    </p>

    <main class="list">
      <p v-if="loading" class="list__hint">加载中…</p>

      <div v-else-if="visibleTasks.length === 0" class="empty">
        <span class="empty__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 11l3 3 8-8" />
            <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
          </svg>
        </span>
        <p class="empty__text">{{ emptyText }}</p>
      </div>

      <ul v-else ref="listRef" class="list__items" :class="{ 'list__items--static': !dragEnabled }">
        <TaskItem
          v-for="(task, index) in visibleTasks"
          :key="task.id"
          :task="task"
          :subtasks="store.subtasksOf(task.id)"
          :expanded="Boolean(expandedIds[task.id])"
          :dragging="draggingId === task.id"
          :drop-before="dropSlot !== null && dropSlot === index"
          :drop-after="
            dropSlot !== null && dropSlot === visibleTasks.length && index === visibleTasks.length - 1
          "
          @toggle="handleToggle"
          @rename="handleRename"
          @remove="handleRemove"
          @menu="openMenu"
          @grab="handleGrab"
          @expand="toggleExpand"
          @add-subtask="handleAddSubtask"
          @toggle-subtask="handleToggleSubtask"
          @remove-subtask="handleRemoveSubtask"
          @notes="handleNotes"
          @recurrence="handleRecurrence"
        />
      </ul>
    </main>

    <TaskMenu
      v-if="menu"
      :task="menu.task"
      :anchor="menu.anchor"
      @close="closeMenu"
      @color="pickColor"
      @pin="togglePin"
    />

    <div v-if="notice" class="toast">{{ notice }}</div>
  </div>
</template>
