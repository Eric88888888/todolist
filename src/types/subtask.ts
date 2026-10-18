/** 子任务：挂在某条主任务下面的一小步 */
export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 主卡片上显示的完成进度，如 2/5 */
export interface SubtaskProgress {
  done: number;
  total: number;
}
