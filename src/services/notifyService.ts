import { invoke } from '@tauri-apps/api/core';

/**
 * 系统通知（Windows Toast）。
 *
 * 为什么不用 `@tauri-apps/plugin-notification` 的 `sendNotification()`：
 * 那个版本里它是用浏览器的 `new window.Notification()` 实现的，而 WebView2 里
 * 这个 API 是**静默空操作** —— 不报错、也没有任何弹窗。必须直接调插件的 IPC 命令。
 */
const CMD_IS_GRANTED = 'plugin:notification|is_permission_granted';
const CMD_REQUEST = 'plugin:notification|request_permission';
const CMD_NOTIFY = 'plugin:notification|notify';

export interface NotifyOptions {
  title: string;
  body?: string;
}

/** 桌面上通常直接返回 true；移动端才会真的弹权限框 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (await invoke<boolean>(CMD_IS_GRANTED)) return true;
    const state = await invoke<string>(CMD_REQUEST);
    return state === 'granted';
  } catch (error) {
    console.warn('通知权限检查失败', error);
    return false;
  }
}

export function notify(options: NotifyOptions): Promise<void> {
  return invoke<void>(CMD_NOTIFY, { options });
}
