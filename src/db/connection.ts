import Database from '@tauri-apps/plugin-sql';

/**
 * 存储层入口（最底层，只负责拿到一个数据库连接）。
 *
 * 数据库文件位置由 Tauri 决定：`%APPDATA%\<identifier>\todolist.db`
 * —— 故意不放在 exe 旁边，否则装到 Program Files 后没有写权限。
 * 表结构由 Rust 侧的迁移（src-tauri/src/lib.rs）负责创建。
 */
const DB_URL = 'sqlite:todolist.db';

let connection: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!connection) {
    connection = Database.load(DB_URL).catch((err: unknown) => {
      // 失败后不要缓存坏掉的 Promise，允许下次重试
      connection = null;
      throw err;
    });
  }
  return connection;
}
