import { taskRepository } from '../repositories/taskRepository';

export interface DueReminder {
  id: string;
  title: string;
}

/**
 * 到期提醒。
 *
 * 取任务和"标记已提醒"放在同一步里完成：先把行标记掉再弹窗，
 * 这样即使弹窗那一步失败，也不会每 20 秒重复骚扰同一条任务。
 */
export const reminderService = {
  async takeDue(limit = 3): Promise<DueReminder[]> {
    const now = new Date().toISOString();
    const rows = await taskRepository.listDue(now, limit);
    if (rows.length === 0) return [];
    await taskRepository.markNotified(
      rows.map((row) => row.id),
      now,
    );
    return rows.map((row) => ({ id: row.id, title: row.title }));
  },
};
