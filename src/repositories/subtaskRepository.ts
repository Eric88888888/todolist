import { getDb } from '../db/connection';
import type { Subtask } from '../types/subtask';

interface SubtaskRow {
  id: string;
  task_id: string;
  title: string;
  done: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, task_id, title, done, sort_order, created_at, updated_at';

function toSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    done: row.done !== 0,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 子任务仓储。一次全量读出（待办场景下子任务总量很小），
 * 由 Store 按 task_id 分组，避免每张卡片各发一次查询。
 */
export const subtaskRepository = {
  async listAll(): Promise<Subtask[]> {
    const db = await getDb();
    const rows = await db.select<SubtaskRow[]>(
      `SELECT ${COLUMNS} FROM subtask ORDER BY sort_order ASC, created_at ASC`,
    );
    return rows.map(toSubtask);
  },

  async insert(subtask: Subtask): Promise<void> {
    const db = await getDb();
    await db.execute(
      `INSERT INTO subtask (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        subtask.id,
        subtask.taskId,
        subtask.title,
        subtask.done ? 1 : 0,
        subtask.sortOrder,
        subtask.createdAt,
        subtask.updatedAt,
      ],
    );
  },

  async update(subtask: Subtask): Promise<void> {
    const db = await getDb();
    await db.execute(
      'UPDATE subtask SET title = $2, done = $3, sort_order = $4, updated_at = $5 WHERE id = $1',
      [subtask.id, subtask.title, subtask.done ? 1 : 0, subtask.sortOrder, subtask.updatedAt],
    );
  },

  /** 子任务没有"后悔药"的必要，直接删 */
  async remove(id: string): Promise<void> {
    const db = await getDb();
    await db.execute('DELETE FROM subtask WHERE id = $1', [id]);
  },

  async maxSortOrder(taskId: string): Promise<number | null> {
    const db = await getDb();
    const rows = await db.select<{ max: number | null }[]>(
      'SELECT MAX(sort_order) AS max FROM subtask WHERE task_id = $1',
      [taskId],
    );
    return rows[0]?.max ?? null;
  },
};
