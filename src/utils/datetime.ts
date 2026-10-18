const pad = (n: number): string => String(n).padStart(2, '0');

/** `<input type="datetime-local">` 的本地时间字符串 → UTC ISO（存储用） */
export function localInputToIsoUtc(value: string): string | null {
  if (!value) return null;
  const date = new Date(value); // "YYYY-MM-DDTHH:mm" 会按本地时区解析
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** UTC ISO → `datetime-local` 需要的本地时间字符串（编辑回填用） */
export function isoUtcToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 人类友好的截止时间展示：今天 18:00 / 明天 09:00 / 周五 14:30 / 3月8日 */
export function formatDue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((targetStart - todayStart) / 86_400_000);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `明天 ${time}`;
  if (diffDays === -1) return `昨天 ${time}`;
  if (diffDays > 1 && diffDays <= 6) return `${WEEKDAYS[date.getDay()]} ${time}`;

  const sameYear = date.getFullYear() === now.getFullYear();
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return sameYear ? `${md} ${time}` : `${date.getFullYear()}年${md}`;
}

/** 是否已逾期（已完成的任务不算） */
export function isOverdue(iso: string | null, done: boolean): boolean {
  if (!iso || done) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
}
