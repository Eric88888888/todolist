import { invoke } from '@tauri-apps/api/core';
import { getDb } from '../db/connection';

export interface BackupOutcome {
  /** 本次新建的备份文件路径；没做备份则为 null */
  created: string | null;
}

/**
 * 每日自动备份。
 *
 * 步骤：Rust 侧决定「今天该不该备份、备份到哪」（顺带清理超过 7 份的旧备份），
 * 真正的一致性快照交给 SQLite 的 `VACUUM INTO` 来做 —— 直接复制 db 文件在 WAL
 * 模式下可能漏掉还在 -wal 里的事务，VACUUM INTO 读到的一定是一个完整快照。
 *
 * 备份失败不应该影响使用，所以这里不抛错。
 */
export async function runDailyBackup(): Promise<BackupOutcome> {
  let target: string | null = null;
  try {
    target = await invoke<string | null>('prepare_daily_backup');
  } catch (error) {
    console.warn('准备备份失败，跳过本次备份', error);
    return { created: null };
  }

  if (!target) return { created: null };

  try {
    const db = await getDb();
    await db.execute('VACUUM INTO $1', [target]);
    return { created: target };
  } catch (error) {
    console.warn('备份失败', error);
    // 清掉可能写了一半的文件，否则明天会被误判成"今天已备份"
    await invoke('discard_backup', { path: target }).catch(() => undefined);
    return { created: null };
  }
}
