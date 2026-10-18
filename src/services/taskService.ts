import { taskRepository } from '../repositories/taskRepository';
import { nextOccurrence, parseRecurrence } from '../utils/recurrence';
import type { Task, TaskColor } from '../types/task';

/** 业务规则：标题长度上限（按字符计，够宽松也不至于撑爆界面） */
const MAX_TITLE_LENGTH = 120;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `t_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 校验并规范化标题，不合法直接抛错，由上层展示 */
function normalizeTitle(raw: string): string {
  const title = raw.trim().replace(/\s+/g, ' ');
  if (!title) throw new Error('任务内容不能为空');
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`任务内容最多 ${MAX_TITLE_LENGTH} 个字`);
  }
  return title;
}

/**
 * 取"插到组最前面"用的排序值。
 * 组内还没条目时返回 0，否则返回当前最小值 - 1（负数是允许的，排序不受影响）。
 */
async function topOfGroup(pinned: boolean): Promise<number> {
  const { min } = await taskRepository.sortOrderBounds(pinned);
  return (min ?? 1) - 1;
}

/**
 * 服务层：业务规则集中在这里（校验、默认值、状态流转）。
 * UI 和 Store 不得直接碰仓储，以免规则散落各处。
 */
export const taskService = {
  list(): Promise<Task[]> {
    return taskRepository.list();
  },

  async add(rawTitle: string, dueAt: string | null): Promise<Task> {
    const timestamp = nowIso();
    const task: Task = {
      id: newId(),
      title: normalizeTitle(rawTitle),
      notes: null,
      done: false,
      dueAt,
      priority: 0,
      color: 'default',
      pinnedAt: null,
      // 新任务插到非置顶组的最前面：就在输入框下面，加完立刻能看见
      sortOrder: await topOfGroup(false),
      notifiedAt: null,
      recurrence: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await taskRepository.insert(task);
    return task;
  },

  /**
   * 勾选完成。
   *
   * 循环任务不"留在已完成"，而是把截止时间顺延到下一次并重置提醒标记 —— 这才是
   * "每周五写周报"该有的行为：勾掉这一周，下一周自动排上。
   */
  async toggle(task: Task): Promise<Task> {
    const completing = !task.done;
    const rule = parseRecurrence(task.recurrence);

    if (completing && rule && task.dueAt) {
      const next: Task = {
        ...task,
        done: false,
        dueAt: nextOccurrence(task.dueAt, rule),
        notifiedAt: null,
        updatedAt: nowIso(),
      };
      await taskRepository.update(next);
      return next;
    }

    // 普通任务：只改状态，不动顺序 —— 列表是手动排的，勾一下不该让它突然跳走
    const next: Task = { ...task, done: !task.done, updatedAt: nowIso() };
    await taskRepository.update(next);
    return next;
  },

  async setNotes(task: Task, notes: string | null): Promise<Task> {
    const trimmed = notes?.trim() ? notes.trim() : null;
    if (trimmed === task.notes) return task;
    const next: Task = { ...task, notes: trimmed, updatedAt: nowIso() };
    await taskRepository.update(next);
    return next;
  },

  async setRecurrence(task: Task, raw: string | null): Promise<Task> {
    if (raw === task.recurrence) return task;
    const next: Task = { ...task, recurrence: raw, updatedAt: nowIso() };
    await taskRepository.update(next);
    return next;
  },

  async rename(task: Task, rawTitle: string): Promise<Task> {
    const next: Task = { ...task, title: normalizeTitle(rawTitle), updatedAt: nowIso() };
    if (next.title === task.title) return task;
    await taskRepository.update(next);
    return next;
  },

  async setDue(task: Task, dueAt: string | null): Promise<Task> {
    const next: Task = { ...task, dueAt, updatedAt: nowIso() };
    await taskRepository.update(next);
    return next;
  },

  async setColor(task: Task, color: TaskColor): Promise<Task> {
    if (task.color === color) return task;
    const next: Task = { ...task, color, updatedAt: nowIso() };
    await taskRepository.update(next);
    return next;
  },

  /**
   * 置顶 / 取消置顶。置顶时插到置顶组最前，取消时插到非置顶组最前
   * （取消置顶后它会紧贴置顶区下方，位置变化最小）。
   */
  async togglePin(task: Task): Promise<Task> {
    const pinning = !task.pinnedAt;
    const next: Task = {
      ...task,
      pinnedAt: pinning ? nowIso() : null,
      sortOrder: await topOfGroup(pinning),
      updatedAt: nowIso(),
    };
    await taskRepository.update(next);
    return next;
  },

  /**
   * 拖拽后重排：按传入顺序把整张列表重新编号，只提交真正变了的行。
   * 调用方负责保证顺序里置顶项都在前面（拖拽层已经做了分组约束）。
   */
  async reorder(ordered: Task[]): Promise<void> {
    const stamp = nowIso();
    const changes = ordered
      .map((task, index) => ({ task, sortOrder: index }))
      .filter(({ task, sortOrder }) => task.sortOrder !== sortOrder)
      .map(({ task, sortOrder }) => ({ id: task.id, sortOrder, updatedAt: stamp }));

    await taskRepository.updateOrder(changes);
  },

  async remove(task: Task): Promise<void> {
    await taskRepository.softDelete(task.id, nowIso());
  },

  clearDone(): Promise<number> {
    return taskRepository.removeDone(nowIso());
  },
};
