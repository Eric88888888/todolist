import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { taskService } from '../services/taskService';
import { subtaskService } from '../services/subtaskService';
import { isOverdue } from '../utils/datetime';
import type { Task, TaskColor, TaskFilter } from '../types/task';
import type { Subtask, SubtaskProgress } from '../types/subtask';

function groupSubtasks(list: Subtask[]): Record<string, Subtask[]> {
  const grouped: Record<string, Subtask[]> = {};
  for (const subtask of list) {
    (grouped[subtask.taskId] ??= []).push(subtask);
  }
  return grouped;
}

/**
 * 状态层：内存中的唯一数据源，UI 只读这里、只调这里的 action。
 *
 * 规模说明：本地待办量级在几百条以内，所以每次变更后直接把任务和子任务一起重读
 * （亚毫秒级），换来「内存与数据库永不漂移」；等数据量真的上去了再改成乐观更新。
 * 排序完全由数据库负责，前端不再维护第二份排序逻辑。
 */
export const useTaskStore = defineStore('task', () => {
  const tasks = ref<Task[]>([]);
  const subtasksByTask = ref<Record<string, Subtask[]>>({});
  const filter = ref<TaskFilter>('all');
  const query = ref('');
  const loading = ref(false);
  const errorMessage = ref<string | null>(null);

  const activeTasks = computed(() => tasks.value.filter((task) => !task.done));
  const doneTasks = computed(() => tasks.value.filter((task) => task.done));
  const pinnedTasks = computed(() => tasks.value.filter((task) => task.pinnedAt !== null));

  /** 搜索命中的范围：标题、备注、子任务标题 */
  function matchesQuery(task: Task, needle: string): boolean {
    if (task.title.toLowerCase().includes(needle)) return true;
    if (task.notes && task.notes.toLowerCase().includes(needle)) return true;
    return (subtasksByTask.value[task.id] ?? []).some((item) =>
      item.title.toLowerCase().includes(needle),
    );
  }

  const visibleTasks = computed(() => {
    const filtered =
      filter.value === 'active'
        ? activeTasks.value
        : filter.value === 'done'
          ? doneTasks.value
          : tasks.value;

    const needle = query.value.trim().toLowerCase();
    if (!needle) return filtered;
    return filtered.filter((task) => matchesQuery(task, needle));
  });

  const activeCount = computed(() => activeTasks.value.length);
  const doneCount = computed(() => doneTasks.value.length);
  const totalCount = computed(() => tasks.value.length);
  const pinnedCount = computed(() => pinnedTasks.value.length);
  const overdueCount = computed(
    () => activeTasks.value.filter((task) => isOverdue(task.dueAt, task.done)).length,
  );
  const progress = computed(() =>
    totalCount.value === 0 ? 0 : Math.round((doneCount.value / totalCount.value) * 100),
  );

  function reportError(error: unknown): void {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }

  function clearError(): void {
    errorMessage.value = null;
  }

  /** 一次性把任务和子任务读回内存（子任务总量很小，一条 SQL 全取） */
  async function refresh(): Promise<void> {
    const [taskList, subtaskList] = await Promise.all([
      taskService.list(),
      subtaskService.listAll(),
    ]);
    tasks.value = taskList;
    subtasksByTask.value = groupSubtasks(subtaskList);
  }

  /** 所有写操作都走这里：执行 → 报错兜底 → 重新同步内存状态 */
  async function mutate(action: () => Promise<unknown>): Promise<void> {
    clearError();
    try {
      await action();
      await refresh();
    } catch (error) {
      reportError(error);
    }
  }

  async function load(): Promise<void> {
    loading.value = true;
    clearError();
    try {
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      loading.value = false;
    }
  }

  function subtasksOf(taskId: string): Subtask[] {
    return subtasksByTask.value[taskId] ?? [];
  }

  function progressOf(taskId: string): SubtaskProgress {
    const list = subtasksOf(taskId);
    return { done: list.filter((item) => item.done).length, total: list.length };
  }

  function add(title: string, dueAt: string | null): Promise<void> {
    return mutate(() => taskService.add(title, dueAt));
  }

  function toggle(task: Task): Promise<void> {
    return mutate(() => taskService.toggle(task));
  }

  function rename(task: Task, title: string): Promise<void> {
    return mutate(() => taskService.rename(task, title));
  }

  function setDue(task: Task, dueAt: string | null): Promise<void> {
    return mutate(() => taskService.setDue(task, dueAt));
  }

  function setNotes(task: Task, notes: string | null): Promise<void> {
    return mutate(() => taskService.setNotes(task, notes));
  }

  function setRecurrence(task: Task, raw: string | null): Promise<void> {
    return mutate(() => taskService.setRecurrence(task, raw));
  }

  function setColor(task: Task, color: TaskColor): Promise<void> {
    return mutate(() => taskService.setColor(task, color));
  }

  function togglePin(task: Task): Promise<void> {
    return mutate(() => taskService.togglePin(task));
  }

  /** 拖拽排序：传入整张列表拖完之后的顺序 */
  function reorder(ordered: Task[]): Promise<void> {
    return mutate(() => taskService.reorder(ordered));
  }

  function remove(task: Task): Promise<void> {
    return mutate(() => taskService.remove(task));
  }

  function clearDone(): Promise<void> {
    return mutate(() => taskService.clearDone());
  }

  function addSubtask(taskId: string, title: string): Promise<void> {
    return mutate(() => subtaskService.add(taskId, title));
  }

  function toggleSubtask(subtask: Subtask): Promise<void> {
    return mutate(() => subtaskService.toggle(subtask));
  }

  function removeSubtask(subtask: Subtask): Promise<void> {
    return mutate(() => subtaskService.remove(subtask));
  }

  function setQuery(value: string): void {
    query.value = value;
  }

  function setFilter(next: TaskFilter): void {
    filter.value = next;
  }

  return {
    tasks,
    filter,
    query,
    loading,
    errorMessage,
    visibleTasks,
    activeCount,
    doneCount,
    totalCount,
    pinnedCount,
    overdueCount,
    progress,
    load,
    add,
    toggle,
    rename,
    setDue,
    setNotes,
    setRecurrence,
    setColor,
    togglePin,
    reorder,
    remove,
    clearDone,
    addSubtask,
    toggleSubtask,
    removeSubtask,
    subtasksOf,
    progressOf,
    setQuery,
    setFilter,
    clearError,
  };
});
