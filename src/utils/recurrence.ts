/**
 * 循环规则。
 *
 * 只做三种最常见的形态，不做完整 RRULE：
 *   - 每天
 *   - 每周某几天（0=周日 … 6=周六）
 *   - 每月某一天（遇到小月自动落到当月最后一天）
 * 存库时序列化成 JSON 字符串，读的时候解析失败就当"不重复"，不让坏数据炸掉整个列表。
 */
export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] }
  | { kind: 'monthly'; day: number };

export type RecurrenceKind = 'none' | Recurrence['kind'];

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export function parseRecurrence(raw: string | null): Recurrence | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Recurrence;
    if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) return null;
    if (parsed.kind === 'daily') return { kind: 'daily' };
    if (parsed.kind === 'weekly' && Array.isArray(parsed.weekdays)) {
      return { kind: 'weekly', weekdays: parsed.weekdays.filter((d) => d >= 0 && d <= 6) };
    }
    if (parsed.kind === 'monthly' && typeof parsed.day === 'number') {
      return { kind: 'monthly', day: Math.min(Math.max(Math.trunc(parsed.day), 1), 31) };
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeRecurrence(rule: Recurrence | null): string | null {
  return rule ? JSON.stringify(rule) : null;
}

export function describeRecurrence(rule: Recurrence | null): string {
  if (!rule) return '';
  if (rule.kind === 'daily') return '每天';
  if (rule.kind === 'weekly') {
    const days = rule.weekdays.length ? rule.weekdays : [0];
    return `每周${days.map((d) => WEEKDAY_LABELS[d] ?? '').join('、')}`;
  }
  return `每月 ${rule.day} 号`;
}

/** 把一个月加到 from 上，并把日期夹到目标月的最后一天（1/31 → 2/28 这种） */
function addMonthClamped(from: Date, day: number): Date {
  const next = new Date(from);
  next.setDate(1);
  next.setMonth(next.getMonth() + 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

/**
 * 算出「下一次」的时间点，保证返回值严格晚于 now。
 *
 * 用的是本地时间做日期推进（用户心里的"每周五 9 点"就是本地时间），
 * 最后再转回 UTC ISO 存储，和库里其它时间保持同一套约定。
 */
export function nextOccurrence(dueIso: string, rule: Recurrence, now: Date = new Date()): string {
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return dueIso;

  let cursor = new Date(due);
  // 防止脏数据把循环卡死（比如 weekdays 全被过滤空了）
  let guard = 0;
  const LIMIT = 4000;

  if (rule.kind === 'daily') {
    while (cursor.getTime() <= now.getTime() && guard < LIMIT) {
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  } else if (rule.kind === 'weekly') {
    const days = rule.weekdays.length ? rule.weekdays : [due.getDay()];
    do {
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    } while (
      guard < LIMIT &&
      (cursor.getTime() <= now.getTime() || !days.includes(cursor.getDay()))
    );
  } else {
    do {
      cursor = addMonthClamped(cursor, rule.day);
      guard += 1;
    } while (cursor.getTime() <= now.getTime() && guard < 200);
  }

  return cursor.toISOString();
}

/** 根据当前截止时间推导"默认"的循环规则（切换下拉时用） */
export function defaultRuleFor(kind: RecurrenceKind, dueAt: string | null): Recurrence | null {
  if (kind === 'none') return null;
  const base = dueAt ? new Date(dueAt) : new Date();
  const anchor = Number.isNaN(base.getTime()) ? new Date() : base;
  if (kind === 'daily') return { kind: 'daily' };
  if (kind === 'weekly') return { kind: 'weekly', weekdays: [anchor.getDay()] };
  return { kind: 'monthly', day: anchor.getDate() };
}
