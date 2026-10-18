import { computed, onBeforeUnmount, ref, type Ref } from 'vue';
import type { Task } from '../types/task';

/** 移动超过这个距离才算拖拽，否则当作点击（避免和双击改名抢手势） */
const DRAG_THRESHOLD_PX = 4;
/** 靠近列表上下边缘多少像素内开始自动滚动 */
const EDGE_PX = 48;
const SCROLL_STEP_PX = 12;

const isPinned = (task: Task): boolean => task.pinnedAt !== null;

export interface DragSortOptions {
  /** 当前渲染出来的列表（顺序即数据库顺序） */
  items: Ref<Task[]>;
  /** 列表容器，用来量每张卡片的位置 */
  listRef: Ref<HTMLElement | null>;
  enabled: Ref<boolean>;
  onDrop: (ordered: Task[]) => void;
}

/**
 * 指针拖拽排序。
 *
 * 约束：置顶和非置顶是两个互不穿越的分组 —— 非置顶项不能落到任何置顶项上方，
 * 置顶项也不落到非置顶项下方。做法是每次算插入位后，把它夹在本组的 [first, last + 1] 区间内。
 */
export function useDragSort({ items, listRef, enabled, onDrop }: DragSortOptions) {
  const draggingId = ref<string | null>(null);
  /** 原始数组坐标里的插入位（含"插到末尾"= length） */
  const slot = ref<number | null>(null);

  let pendingId: string | null = null;
  let startX = 0;
  let startY = 0;
  let active = false;

  /** 真正会改变顺序的插入位；落回原位或原位下一格都算没变 */
  const dropSlot = computed<number | null>(() => {
    const id = draggingId.value;
    const current = slot.value;
    if (!id || current === null) return null;
    const from = items.value.findIndex((task) => task.id === id);
    if (from < 0) return null;
    if (current === from || current === from + 1) return null;
    return current;
  });

  /** 某个分组在数组里的首尾下标 */
  function groupRange(pinned: boolean): { first: number; last: number } {
    let first = Number.POSITIVE_INFINITY;
    let last = -1;
    items.value.forEach((task, index) => {
      if (isPinned(task) !== pinned) return;
      if (index < first) first = index;
      if (index > last) last = index;
    });
    return { first: Number.isFinite(first) ? first : 0, last };
  }

  function computeSlot(clientY: number): void {
    const list = listRef.value;
    const id = draggingId.value;
    if (!list || !id) return;

    const nodes = Array.from(list.querySelectorAll<HTMLElement>('[data-task-id]'));
    let target = nodes.length;
    for (let index = 0; index < nodes.length; index += 1) {
      const rect = nodes[index].getBoundingClientRect();
      // 越过中线就当作插到这个位置之前
      if (clientY < rect.top + rect.height / 2) {
        target = index;
        break;
      }
    }

    const dragged = items.value.find((task) => task.id === id);
    if (!dragged) return;

    const { first, last } = groupRange(isPinned(dragged));
    slot.value = Math.min(Math.max(target, first), last + 1);
  }

  function autoScroll(clientY: number): void {
    const list = listRef.value;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    if (clientY < rect.top + EDGE_PX) list.scrollTop -= SCROLL_STEP_PX;
    else if (clientY > rect.bottom - EDGE_PX) list.scrollTop += SCROLL_STEP_PX;
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pendingId) return;

    if (!active) {
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (moved < DRAG_THRESHOLD_PX) return;
      active = true;
      draggingId.value = pendingId;
      slot.value = null;
      document.body.classList.add('is-dragging');
    }

    computeSlot(event.clientY);
    autoScroll(event.clientY);
  }

  function cleanup(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('mouseup', onPointerUp);
    window.removeEventListener('blur', onPointerUp);
    document.body.classList.remove('is-dragging');
    pendingId = null;
    active = false;
  }

  function onPointerUp(): void {
    const id = draggingId.value;
    const target = dropSlot.value;
    cleanup();
    draggingId.value = null;
    slot.value = null;

    if (!id || target === null) return;
    const from = items.value.findIndex((task) => task.id === id);
    if (from < 0) return;

    const moved = items.value[from];
    const rest = items.value.filter((task) => task.id !== id);
    // 目标位是在"含自己"的数组里的坐标，去掉自己后要往前挪一格
    const insertAt = target > from ? target - 1 : target;
    onDrop([...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)]);
  }

  /** 挂在每张卡片的 pointerdown 上 */
  function startDrag(event: PointerEvent, task: Task): void {
    if (!enabled.value || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, button, textarea, .task__edit')) return;

    pendingId = task.id;
    startX = event.clientX;
    startY = event.clientY;
    active = false;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    // 兜底：鼠标在窗口外松开、或者窗口失焦时，pointerup 有可能收不到，
    // 那样就会卡在"拖拽中"的状态里，所以再挂一层 mouseup / blur。
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('blur', onPointerUp);
  }

  onBeforeUnmount(cleanup);

  return { draggingId, dropSlot, startDrag };
}
