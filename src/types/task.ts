/**
 * 领域模型：一个任务。
 * 注意：时间一律以 UTC ISO8601 字符串存储，展示时才转成本地时区。
 */

/** 待办项底色（对应一组对比度达标的文字颜色，见 src/theme/colors.ts） */
export type TaskColor =
  | 'default'
  | 'white'
  | 'black'
  | 'navy'
  | 'crimson'
  | 'orange'
  | 'indigo';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  done: boolean;
  /** UTC ISO8601，如 2025-01-31T10:00:00.000Z */
  dueAt: string | null;
  priority: number;
  color: TaskColor;
  /** 置顶时间；null 表示未置顶 */
  pinnedAt: string | null;
  /** 手动排序用。置顶组和非置顶组各自独立，越小越靠前 */
  sortOrder: number;
  /** 到期提醒弹过的时间；null 表示还没提醒过 */
  notifiedAt: string | null;
  /** 循环规则的 JSON 串（见 src/utils/recurrence.ts）；null 表示不重复 */
  recurrence: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type TaskFilter = 'all' | 'active' | 'done';
