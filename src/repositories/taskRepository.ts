import { getDb } from '../db/connection';
import type { Task, TaskColor } from '../types/task';

/** 数据库行（snake_case，布尔值以 0/1 存储） */
interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  done: number;
  due_at: string | null;
  priority: number;
  color: string | null;
  pinned_at: string | null;
  sort_order: number | null;
  notified_at: string | null;
  recurrence: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DueTaskRow {
  id: string;
  title: string;
  due_at: string;
}

const COLUMNS =
  'id, title, notes, done, due_at, priority, color, pinned_at, sort_order, notified_at, recurrence, created_at, updated_at, deleted_at';

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    done: row.done !== 0,
    dueAt: row.due_at,
    priority: row.priority,
    color: (row.color as TaskColor | null) ?? 'default',
    pinnedAt: row.pinned_at,
    sortOrder: row.sort_order ?? 0,
    notifiedAt: row.notified_at,
    recurrence: row.recurrence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * 排序规则（全部在 SQL 里做，前端不再重排）：
 *   1. 置顶的永远在最前面
 *   2. 组内按手动顺序 sort_order 升序
 *   3. 兜底按创建时间倒序（sort_order 缺失时用，正常不会发生）
 *
 * 注意：这里不再按截止时间排序 —— 一旦用了手动拖拽，任何自动排序键都会让拖拽结果"弹回去"。
 * 新建/置顶/取消置顶时通过写入合适的 sort_order 决定它落在组的哪一端。
 */
const ORDER_BY = `
  (pinned_at IS NULL) ASC,
  COALESCE(sort_order, 1e9) ASC,
  created_at DESC
`;

/**
 * 仓储层：只做 SQL 与领域对象的互相转换，不含任何业务规则。
 * 换存储（比如以后上云同步）时，只需要替换这个文件。
 */
export const taskRepository = {
  async list(): Promise<Task[]> {
    const db = await getDb();
    const rows = await db.select<TaskRow[]>(
      `SELECT ${COLUMNS} FROM task WHERE deleted_at IS NULL ORDER BY ${ORDER_BY}`,
    );
    return rows.map(toTask);
  },

  async insert(task: Task): Promise<void> {
    const db = await getDb();
    await db.execute(
      `INSERT INTO task (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        task.id,
        task.title,
        task.notes,
        task.done ? 1 : 0,
        task.dueAt,
        task.priority,
        task.color,
        task.pinnedAt,
        task.sortOrder,
        task.notifiedAt,
        task.recurrence,
        task.createdAt,
        task.updatedAt,
        task.deletedAt,
      ],
    );
  },

  async update(task: Task): Promise<void> {
    const db = await getDb();
    await db.execute(
      `UPDATE task
          SET title = $2, notes = $3, done = $4, due_at = $5, priority = $6,
              color = $7, pinned_at = $8, sort_order = $9, notified_at = $10, recurrence = $11, updated_at = $12
        WHERE id = $1`,
      [
        task.id,
        task.title,
        task.notes,
        task.done ? 1 : 0,
        task.dueAt,
        task.priority,
        task.color,
        task.pinnedAt,
        task.sortOrder,
        task.notifiedAt,
        task.recurrence,
        task.updatedAt,
      ],
    );
  },

  /**
   * 批量写排序值。插件每次 execute 都是独立的一轮 IPC，
   * 所以只提交"真的变了"的行，拖动一条通常只影响 3~8 行。
   */
  async updateOrder(
    entries: ReadonlyArray<{ id: string; sortOrder: number; updatedAt: string }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const db = await getDb();
    for (const entry of entries) {
      await db.execute('UPDATE task SET sort_order = $2, updated_at = $3 WHERE id = $1', [
        entry.id,
        entry.sortOrder,
        entry.updatedAt,
      ]);
    }
  },

  /** 某个分组（置顶 / 非置顶）当前的 sort_order 极值，用来决定新条目插到哪一端 */
  async sortOrderBounds(pinned: boolean): Promise<{ min: number | null; max: number | null }> {
    const db = await getDb();
    const rows = await db.select<{ min: number | null; max: number | null }[]>(
      `SELECT MIN(sort_order) AS min, MAX(sort_order) AS max
         FROM task
        WHERE deleted_at IS NULL AND (pinned_at IS NOT NULL) = $1`,
      [pinned ? 1 : 0],
    );
    const row = rows[0];
    return { min: row?.min ?? null, max: row?.max ?? null };
  },

  /**
   * 到点该弹提醒的任务：没完成、有截止时间、还没提醒过、时间已到。
   * 一次最多取 limit 条 —— 积压太多时宁可分几轮弹，也不要一口气糊满屏幕。
   */
  async listDue(nowIso: string, limit: number): Promise<DueTaskRow[]> {
    const db = await getDb();
    return db.select<DueTaskRow[]>(
      `SELECT id, title, due_at FROM task
        WHERE deleted_at IS NULL
          AND done = 0
          AND due_at IS NOT NULL
          AND notified_at IS NULL
          AND due_at <= $1
        ORDER BY due_at ASC
        LIMIT $2`,
      [nowIso, limit],
    );
  },

  /** 标记"已提醒过"，避免下一次轮询重复打扰 */
  async markNotified(ids: string[], at: string): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    for (const id of ids) {
      await db.execute('UPDATE task SET notified_at = $2 WHERE id = $1', [id, at]);
    }
  },

  /** 软删除：留后悔药，也方便以后做「回收站 / 同步」 */
  async softDelete(id: string, deletedAt: string): Promise<void> {
    const db = await getDb();
    await db.execute('UPDATE task SET deleted_at = $2, updated_at = $2 WHERE id = $1', [
      id,
      deletedAt,
    ]);
  },

  async removeDone(deletedAt: string): Promise<number> {
    const db = await getDb();
    const result = await db.execute(
      'UPDATE task SET deleted_at = $1, updated_at = $1 WHERE done = 1 AND deleted_at IS NULL',
      [deletedAt],
    );
    return result.rowsAffected;
  },
};
