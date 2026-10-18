<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Task } from '../types/task';
import type { Subtask } from '../types/subtask';
import type { MenuAnchor } from '../types/ui';
import { colorCssVars } from '../theme/colors';
import { formatDue, isOverdue } from '../utils/datetime';
import {
  defaultRuleFor,
  describeRecurrence,
  parseRecurrence,
  serializeRecurrence,
  type RecurrenceKind,
} from '../utils/recurrence';

const props = defineProps<{
  task: Task;
  subtasks: Subtask[];
  expanded: boolean;
  dragging?: boolean;
  dropBefore?: boolean;
  dropAfter?: boolean;
}>();

const emit = defineEmits<{
  toggle: [task: Task];
  rename: [task: Task, title: string];
  remove: [task: Task];
  menu: [task: Task, anchor: MenuAnchor];
  grab: [event: PointerEvent, task: Task];
  expand: [task: Task];
  addSubtask: [task: Task, title: string];
  toggleSubtask: [subtask: Subtask];
  removeSubtask: [subtask: Subtask];
  notes: [task: Task, notes: string | null];
  recurrence: [task: Task, raw: string | null];
}>();

const RECURRENCE_OPTIONS: ReadonlyArray<{ kind: RecurrenceKind; label: string }> = [
  { kind: 'none', label: '不重复' },
  { kind: 'daily', label: '每天' },
  { kind: 'weekly', label: '每周' },
  { kind: 'monthly', label: '每月' },
];

const styleVars = computed(() => colorCssVars(props.task.color));
const overdue = computed(() => isOverdue(props.task.dueAt, props.task.done));
const dueLabel = computed(() => formatDue(props.task.dueAt));
const pinned = computed(() => props.task.pinnedAt !== null);
const progress = computed(() => ({
  done: props.subtasks.filter((item) => item.done).length,
  total: props.subtasks.length,
}));

/* ---------- 备注 ---------- */
const notePreview = computed(() => {
  const raw = props.task.notes;
  if (!raw) return '';
  const firstLine = raw.split('\n').find((line) => line.trim().length > 0) ?? '';
  return firstLine.trim();
});

const notesDraft = ref(props.task.notes ?? '');
watch(
  () => props.task.notes,
  (value) => {
    notesDraft.value = value ?? '';
  },
);

function commitNotes(): void {
  const value = notesDraft.value.trim();
  if (value === (props.task.notes ?? '')) return;
  emit('notes', props.task, value ? value : null);
}

/* ---------- 循环 ---------- */
const rule = computed(() => parseRecurrence(props.task.recurrence));
const currentKind = computed<RecurrenceKind>(() => rule.value?.kind ?? 'none');
const recurrenceLabel = computed(() => describeRecurrence(rule.value));
const recurrenceHint = computed(() => {
  if (currentKind.value === 'none') return '';
  if (!props.task.dueAt) return '先设置截止时间';
  return describeRecurrence(defaultRuleFor(currentKind.value, props.task.dueAt));
});

function pickRecurrence(kind: RecurrenceKind): void {
  if (kind !== 'none' && !props.task.dueAt) return;
  const next = defaultRuleFor(kind, props.task.dueAt);
  emit('recurrence', props.task, serializeRecurrence(next));
}

/* ---------- 改名 ---------- */
const editing = ref(false);
const draft = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

async function startEdit(): Promise<void> {
  editing.value = true;
  draft.value = props.task.title;
  await nextTick();
  inputRef.value?.focus();
  inputRef.value?.select();
}

function commitEdit(): void {
  if (!editing.value) return;
  const value = draft.value.trim();
  editing.value = false;
  if (value && value !== props.task.title) emit('rename', props.task, value);
}

function cancelEdit(): void {
  editing.value = false;
  draft.value = '';
}

/**
 * 勾选完成。
 *
 * 循环任务不会真的变成"已完成"（只是顺延到下一次），所以 task.done 前后都是 false，
 * Vue 的 :checked 认为没变化、不会回写 DOM —— 浏览器里那个勾会一直挂着。
 * 这里在发完事件后手动把 DOM 状态拉回和数据一致。
 */
function onCheck(event: Event): void {
  const input = event.target as HTMLInputElement;
  const willRoll = !props.task.done && rule.value !== null && props.task.dueAt !== null;
  emit('toggle', props.task);
  if (willRoll) input.checked = false;
}

/* ---------- 子任务输入 ---------- */
const subtaskDraft = ref('');

function submitSubtask(): void {
  const value = subtaskDraft.value.trim();
  if (!value) return;
  emit('addSubtask', props.task, value);
  subtaskDraft.value = '';
}

/* ---------- 选项栏 ---------- */
function openFromButton(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  emit('menu', props.task, { x: rect.right, y: rect.bottom + 6, align: 'right' });
}

function openFromContext(event: MouseEvent): void {
  emit('menu', props.task, { x: event.clientX, y: event.clientY, align: 'left' });
}
</script>

<template>
  <li
    class="task"
    :class="{
      'task--done': task.done,
      'task--pinned': pinned,
      'task--expanded': expanded,
      'task--dragging': dragging,
      'task--drop-before': dropBefore,
      'task--drop-after': dropAfter,
    }"
    :data-task-id="task.id"
    :style="styleVars"
    @pointerdown="emit('grab', $event, task)"
    @contextmenu.prevent="openFromContext"
  >
    <!-- 置顶标记：等腰直角三角形，两条直角边正好贴在卡片的上边和左边 -->
    <span v-if="pinned" class="task__pin" title="已置顶" aria-hidden="true"></span>

    <div class="task__row">
      <input
        class="task__check"
        type="checkbox"
        :checked="task.done"
        :aria-label="task.done ? '标记为未完成' : '标记为已完成'"
        @change="onCheck"
      />

      <div class="task__body">
        <input
          v-if="editing"
          ref="inputRef"
          v-model="draft"
          class="task__edit"
          type="text"
          maxlength="120"
          @keydown.enter.prevent="commitEdit"
          @keydown.esc.prevent="cancelEdit"
          @blur="commitEdit"
        />
        <span v-else class="task__title" title="双击改名" @dblclick="startEdit">
          {{ task.title }}
        </span>

        <p v-if="notePreview && !expanded" class="task__note">{{ notePreview }}</p>

        <div v-if="dueLabel || progress.total || recurrenceLabel" class="task__meta">
          <span v-if="dueLabel" class="due" :class="{ 'due--overdue': overdue }">
            {{ dueLabel }}
          </span>
          <button
            v-if="progress.total"
            class="task__progress"
            type="button"
            :title="`子任务 ${progress.done}/${progress.total}，点击展开`"
            @click.stop="emit('expand', task)"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m5 13 4.5 4.5L19 7" />
            </svg>
            {{ progress.done }}/{{ progress.total }}
          </button>
          <span v-if="recurrenceLabel" class="task__repeat" :title="recurrenceLabel">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M17 2l4 4-4 4" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 22l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            {{ recurrenceLabel }}
          </span>
        </div>
      </div>

      <button
        class="task__chevron"
        :class="{ 'task__chevron--open': expanded }"
        type="button"
        :aria-expanded="expanded"
        title="展开详情"
        @click.stop="emit('expand', task)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>

      <button class="task__tool" type="button" title="更多选项" @click.stop="openFromButton">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      <button class="task__tool" type="button" title="删除" @click.stop="emit('remove', task)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13h8l1-13" />
        </svg>
      </button>
    </div>

    <!-- 详情面板：备注 / 重复 / 子任务，就地展开 -->
    <div v-if="expanded" class="details">
      <textarea
        v-model="notesDraft"
        class="notes"
        rows="2"
        maxlength="2000"
        placeholder="备注：补充链接、上下文…（失焦自动保存）"
        @blur="commitNotes"
      ></textarea>

      <div class="recurrence">
        <span class="recurrence__label">重复</span>
        <div class="segmented">
          <button
            v-for="option in RECURRENCE_OPTIONS"
            :key="option.kind"
            class="segmented__btn"
            :class="{ 'segmented__btn--active': currentKind === option.kind }"
            type="button"
            :disabled="option.kind !== 'none' && !task.dueAt"
            :title="option.kind !== 'none' && !task.dueAt ? '先给任务设置截止时间' : option.label"
            @click="pickRecurrence(option.kind)"
          >
            {{ option.label }}
          </button>
        </div>
        <span v-if="recurrenceHint" class="recurrence__hint">{{ recurrenceHint }}</span>
      </div>

      <ul v-if="subtasks.length" class="subtasks__list">
        <li v-for="item in subtasks" :key="item.id" class="subtask">
          <input
            class="subtask__check"
            type="checkbox"
            :checked="item.done"
            :aria-label="item.done ? '标记子任务未完成' : '标记子任务完成'"
            @change="emit('toggleSubtask', item)"
          />
          <span class="subtask__title" :class="{ 'subtask__title--done': item.done }">
            {{ item.title }}
          </span>
          <button
            class="subtask__remove"
            type="button"
            title="删除子任务"
            @click="emit('removeSubtask', item)"
          >
            ×
          </button>
        </li>
      </ul>

      <form class="subtask-add" @submit.prevent="submitSubtask">
        <input
          v-model="subtaskDraft"
          class="subtask-add__input"
          type="text"
          placeholder="拆一步：添加子任务，回车确认"
          maxlength="120"
        />
      </form>
    </div>
  </li>
</template>
