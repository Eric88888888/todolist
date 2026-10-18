import { subtaskRepository } from '../repositories/subtaskRepository';
import type { Subtask } from '../types/subtask';

const MAX_TITLE_LENGTH = 120;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTitle(raw: string): string {
  const title = raw.trim().replace(/\s+/g, ' ');
  if (!title) throw new Error('子任务内容不能为空');
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`子任务内容最多 ${MAX_TITLE_LENGTH} 个字`);
  }
  return title;
}

export const subtaskService = {
  listAll(): Promise<Subtask[]> {
    return subtaskRepository.listAll();
  },

  /** 新子任务追加到该任务的末尾 */
  async add(taskId: string, rawTitle: string): Promise<Subtask> {
    const stamp = nowIso();
    const max = await subtaskRepository.maxSortOrder(taskId);
    const subtask: Subtask = {
      id: newId(),
      taskId,
      title: normalizeTitle(rawTitle),
      done: false,
      sortOrder: (max ?? -1) + 1,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await subtaskRepository.insert(subtask);
    return subtask;
  },

  async toggle(subtask: Subtask): Promise<Subtask> {
    const next: Subtask = { ...subtask, done: !subtask.done, updatedAt: nowIso() };
    await subtaskRepository.update(next);
    return next;
  },

  async remove(subtask: Subtask): Promise<void> {
    await subtaskRepository.remove(subtask.id);
  },
};
