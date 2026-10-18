import { onBeforeUnmount, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { reminderService } from '../services/reminderService';
import { ensureNotificationPermission, notify } from '../services/notifyService';

/** 轮询间隔。定时器在最小化/托盘状态下会被系统节流，实际可能慢到一分钟，够用 */
const POLL_INTERVAL_MS = 20_000;
/** 每轮最多弹几条，防止积压任务一次性糊满屏幕 */
const MAX_PER_TICK = 3;

function log(message: string): void {
  void invoke('log_line', { message }).catch(() => undefined);
}

/**
 * 到期提醒调度。
 *
 * 应用常驻托盘，所以这个定时器在"窗口关掉"之后依然在跑 —— 这正是本地程序的优势。
 * 发送链路：闹钟 → 数据库标记 → 插件 IPC → Windows Toast。中间任何一步失败都写进 app.log。
 */
export function useReminders() {
  let timer: number | undefined;
  let running = false;
  let permission: boolean | null = null;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      if (permission === null) {
        permission = await ensureNotificationPermission();
        log(`通知权限: ${permission}`);
      }
      // 没权限就不去动数据，等下次还能再试
      if (!permission) return;

      const due = await reminderService.takeDue(MAX_PER_TICK);
      if (due.length > 0) log(`到期任务 ${due.length} 条`);
      for (const task of due) {
        try {
          await notify({ title: '待办到期', body: task.title });
          log(`已发送提醒: ${task.title}`);
        } catch (error) {
          // 单条失败不影响后面的；已经标记过 notified_at，所以不会反复重试打扰
          log(`通知发送失败: ${String(error)}`);
        }
      }
    } catch (error) {
      log(`提醒轮询失败: ${String(error)}`);
    } finally {
      running = false;
    }
  }

  onMounted(() => {
    void tick();
    timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
  });

  onBeforeUnmount(() => {
    window.clearInterval(timer);
  });

  return { checkNow: tick };
}
