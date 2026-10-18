import type { TaskColor } from '../types/task';

/**
 * 可选的待办项底色，以及配套的文字颜色。
 *
 * 对比度（正文 vs 底色）：
 *   白 #FFFFFF / #111827 ≈ 17.8:1
 *   黑 #000000 / #F8FAFC ≈ 19:1
 *   深蓝 #000080 / #FFFFFF ≈ 16:1
 *   深红 #8B0000 / #FFFFFF ≈ 10:1
 *   深橙 #C2410C / #FFFFFF ≈ 5.2:1
 *   靛蓝 #4B0082 / #FFFFFF ≈ 13:1
 *
 * 除背景和正文色外，每个主题还要给出「次级文字 / 描边 / 悬停 / 勾选框 / 勾号 / 逾期」六组颜色，
 * 否则换个底色就会出现看不清的灰字、或者蓝勾和深红底色糊在一起。
 */
export interface TaskColorTokens {
  id: TaskColor;
  /** 选项栏里的名字 */
  label: string;
  bg: string;
  fg: string;
  /** 截止时间等次级文字 */
  muted: string;
  /** 卡片描边 */
  line: string;
  /** 悬停底色 */
  hover: string;
  /** 勾选框选中时的填充色 */
  check: string;
  /** 勾号的颜色（要和 check 形成反差） */
  mark: string;
  /** 逾期文字颜色（在深色底上不能用深红） */
  overdue: string;
}

export const TASK_COLORS: readonly TaskColorTokens[] = [
  {
    id: 'default',
    label: '默认',
    bg: 'var(--surface)',
    fg: 'var(--text)',
    muted: 'var(--muted)',
    line: 'var(--border)',
    hover: 'var(--surface-2)',
    check: 'var(--accent)',
    mark: '#ffffff',
    overdue: 'var(--danger)',
  },
  {
    // 浅色卡片在深色主题下纯白会刺眼，所以底色走主题变量：
    // 浅色主题 #FFFFFF，深色主题 #F3F4F6（文字 #111827 仍然有 15:1 以上对比度）
    id: 'white',
    label: '浅灰',
    bg: 'var(--card-white-bg)',
    fg: '#111827',
    muted: '#6B7280',
    line: 'var(--card-white-line)',
    hover: 'var(--card-white-hover)',
    check: '#111827',
    mark: 'var(--card-white-bg)',
    overdue: '#B91C1C',
  },
  {
    id: 'black',
    label: '黑色',
    bg: '#000000',
    fg: 'rgba(255, 255, 255, 0.9)',
    muted: '#9CA3AF',
    line: '#26262B',
    hover: '#101014',
    check: '#F8FAFC',
    mark: '#000000',
    overdue: '#FCA5A5',
  },
  {
    id: 'navy',
    label: '深蓝',
    bg: '#000080',
    fg: 'rgba(255, 255, 255, 0.92)',
    muted: '#C3C3F0',
    line: '#2A2AA8',
    hover: '#00006B',
    check: '#FFFFFF',
    mark: '#000080',
    overdue: '#FECACA',
  },
  {
    id: 'crimson',
    label: '深红',
    bg: '#8B0000',
    fg: 'rgba(255, 255, 255, 0.92)',
    muted: '#F0C8C8',
    line: '#A61B1B',
    hover: '#780000',
    check: '#FFFFFF',
    mark: '#8B0000',
    overdue: '#FFD9D9',
  },
  {
    id: 'orange',
    label: '橙色',
    bg: '#C2410C',
    fg: 'rgba(255, 255, 255, 0.92)',
    muted: '#FFF1E9',
    line: '#E0601F',
    hover: '#A9380A',
    check: '#FFFFFF',
    mark: '#C2410C',
    overdue: '#FFF3C4',
  },
  {
    id: 'indigo',
    label: '靛蓝',
    bg: '#4B0082',
    fg: 'rgba(255, 255, 255, 0.92)',
    muted: '#D3C1E8',
    line: '#6520A8',
    hover: '#3F006E',
    check: '#FFFFFF',
    mark: '#4B0082',
    overdue: '#FECACA',
  },
];

export function colorTokens(color: TaskColor): TaskColorTokens {
  return TASK_COLORS.find((item) => item.id === color) ?? TASK_COLORS[0];
}

/** 把主题展开成 CSS 变量，直接绑在任务卡片上 */
export function colorCssVars(color: TaskColor): Record<string, string> {
  const tokens = colorTokens(color);
  return {
    '--task-bg': tokens.bg,
    '--task-fg': tokens.fg,
    '--task-muted': tokens.muted,
    '--task-line': tokens.line,
    '--task-hover': tokens.hover,
    '--task-check': tokens.check,
    '--task-mark': tokens.mark,
    '--task-overdue': tokens.overdue,
  };
}
