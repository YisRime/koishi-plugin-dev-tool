import { Context, Schema, h, Logger } from 'koishi'
import { inspect } from 'util'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'

/**
 * 插件名称
 * @type {string}
 */
export const name = 'dev-tool'

/**
 * 插件专用日志记录器
 * @type {Logger}
 */
export const logger = new Logger(name)

/**
 * 插件配置接口
 * @interface Config
 */
export interface Config {
  tables?: string[]
  backupInterval?: number
  backupDir?: string
  keepBackups?: number
  singleFile?: boolean
}

/**
 * 插件配置Schema定义
 */
export const Config: Schema<Config> = Schema.object({
  tables: Schema.array(String).description('数据库特殊表名（例如大写）请填写于此').default([]),
  backupInterval: Schema.number().description('数据库自动备份时间间隔（小时）').default(0).min(0),
  backupDir: Schema.string().description('备份文件存储目录').default('./data/backups'),
  keepBackups: Schema.number().description('保留最近几次备份（设置为 0 关闭限制）').default(0).min(0),
  singleFile: Schema.boolean().description('是否以单文件形式存储').default(false),
})

/**
 * 文件操作工具集合
 */
const backupUtils = {
  /**
   * 确保目录存在
   */
  ensureDir: (dirPath: string) => {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
  },

  /**
   * 获取备份时间戳
   */
  getTimestamp: () => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${
      String(now.getDate()).padStart(2, '0')}_${
      String(now.getHours()).padStart(2, '0')}${
      String(now.getMinutes()).padStart(2, '0')}${
      String(now.getSeconds()).padStart(2, '0')}`;
  },

  /**
   * 清理旧备份
   */
  async cleanupOldBackups(dirPath: string, pattern: string, keepCount: number): Promise<void> {
    if (!keepCount) return;

    try {
      const files = await fs.readdir(dirPath);
      const backupFiles = files
        .filter(file => file.startsWith(pattern))
        .sort((a, b) => b.localeCompare(a));

      if (backupFiles.length > keepCount) {
        for (let i = keepCount; i < backupFiles.length; i++) {
          await fs.unlink(path.join(dirPath, backupFiles[i]));
          logger.info(`已删除旧备份: ${backupFiles[i]}`);
        }
      }
    } catch (e) {
      logger.error(`清理旧备份失败: ${e.message}`);
    }
  },

  /**
   * 备份所有表到单个文件
   */
  async backupToSingleFile(ctx: Context, dirPath: string, tables: string[], timestamp: string): Promise<string> {
    const allData: Record<string, any[]> = {};

    for (const table of tables) {
      try {
        const rows = await ctx.database.get(table as any, {});
        allData[table] = rows;
      } catch (e) {
        logger.warn(`获取表 ${table} 数据失败: ${e.message}`);
      }
    }

    const fileName = `backup_${timestamp}.json`;
    const filePath = path.join(dirPath, fileName);
    await fs.writeFile(filePath, JSON.stringify(allData, null, 2));
    return fileName;
  },

  /**
   * 备份每个表到独立文件
   */
  async backupToMultipleFiles(ctx: Context, dirPath: string, tables: string[], timestamp: string): Promise<string[]> {
    const fileNames: string[] = [];

    for (const table of tables) {
      try {
        const rows = await ctx.database.get(table as any, {});
        const fileName = `backup_${timestamp}_${table}.json`;
        const filePath = path.join(dirPath, fileName);
        await fs.writeFile(filePath, JSON.stringify(rows, null, 2));
        fileNames.push(fileName);
      } catch (e) {
        logger.warn(`备份表 ${table} 失败: ${e.message}`);
      }
    }

    return fileNames;
  },

  /**
   * 从单个文件恢复数据
   */
  async restoreFromSingleFile(ctx: Context, filePath: string): Promise<string[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const allData = JSON.parse(content, (key, value) => {
        return typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value) ?
          new Date(value) : value;
      });

      const restoredTables: string[] = [];

      for (const [table, data] of Object.entries(allData)) {
        if (Array.isArray(data) && data.length > 0) {
          await ctx.database.upsert(table as any, data);
          restoredTables.push(table);
        }
      }

      return restoredTables;
    } catch (e) {
      logger.error(`从文件 ${filePath} 恢复失败: ${e.message}`);
      return [];
    }
  },

  /**
   * 从多个文件恢复数据
   */
  async restoreFromMultipleFiles(ctx: Context, dirPath: string): Promise<string[]> {
    const files = await fs.readdir(dirPath);
    const backupFiles = files.filter(file => file.match(/^backup_\d+_(.+)\.json$/));
    const restoredTables: string[] = [];

    for (const fileName of backupFiles) {
      try {
        const match = fileName.match(/^backup_\d+_(.+)\.json$/);
        if (!match) continue;

        const tableName = match[1];
        const filePath = path.join(dirPath, fileName);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content, (key, value) => {
          return typeof value === 'string' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value) ?
            new Date(value) : value;
        });

        if (Array.isArray(data) && data.length > 0) {
          await ctx.database.upsert(tableName as any, data);
          restoredTables.push(tableName);
        }
      } catch (e) {
        logger.warn(`恢复文件 ${fileName} 失败: ${e.message}`);
      }
    }

    return restoredTables;
  },

  /**
   * 列出可用备份
   */
  async listBackups(dirPath: string, isSingleFile: boolean): Promise<{timestamp: string, tables?: string[]}[]> {
    try {
      const files = await fs.readdir(dirPath);

      if (isSingleFile) {
        // 单文件备份模式
        const backups = files
          .filter(file => file.match(/^backup_\d+\.json$/))
          .map(file => {
            const match = file.match(/^backup_(\d+)\.json$/);
            return match ? { timestamp: match[1] } : null;
          })
          .filter(Boolean)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        return backups;
      } else {
        // 多文件备份模式
        const fileMap = new Map<string, string[]>();

        files.filter(file => file.match(/^backup_\d+_(.+)\.json$/))
          .forEach(file => {
            const match = file.match(/^backup_(\d+)_(.+)\.json$/);
            if (match) {
              const [_, timestamp, table] = match;
              if (!fileMap.has(timestamp)) {
                fileMap.set(timestamp, []);
              }
              fileMap.get(timestamp).push(table);
            }
          });

        return Array.from(fileMap.entries())
          .map(([timestamp, tables]) => ({ timestamp, tables }))
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      }
    } catch (e) {
      logger.error(`列出备份失败: ${e.message}`);
      return [];
    }
  }
}

/**
 * 格式化检查数据，用于输出可读性更好的对象表示
 * @param {any} data - 要格式化的数据
 * @param {object} options - 格式化选项
 * @param {number} [options.depth] - 检查深度，默认为无限
 * @returns {string} 格式化后的字符串
 */
function formatInspect(data: any, options: { depth?: number } = {}) {
  return inspect(data, { depth: options.depth || Infinity })
}

/**
 * 错误处理助手，统一处理和记录错误
 * @param {string} operation - 操作名称
 * @param {Error} error - 错误对象
 * @returns {string} 格式化的错误信息
 */
function handleError(operation: string, error: Error) {
  const message = `${operation}失败：${error.message}`
  logger.warn(message)
  return message
}

/**
 * 插件主函数，注册命令和功能
 * @param {Context} ctx - Koishi上下文
 * @param {Config} config - 插件配置
 */
export function apply(ctx: Context, config: Config = {}) {
  const backupDirPath = config.backupDir || './data/backups';
  const isSingleFile = config.singleFile ?? false;
  let backupTimer: NodeJS.Timeout = null;

  /**
   * 执行备份操作
   */
  const performBackup = async (): Promise<string> => {
    try {
      backupUtils.ensureDir(backupDirPath);
      const timestamp = backupUtils.getTimestamp();
      const dbStats = await ctx.database.stats();
      const tables = [...Object.keys(dbStats.tables), ...(config.tables || [])];

      if (tables.length === 0) {
        return '没有找到可备份的表';
      }

      let result: string;

      if (isSingleFile) {
        const fileName = await backupUtils.backupToSingleFile(ctx, backupDirPath, tables, timestamp);
        result = `已创建备份: ${fileName}（包含${tables.length}个表）`;

        if (config.keepBackups > 0) {
          await backupUtils.cleanupOldBackups(backupDirPath, 'backup_', config.keepBackups);
        }
      } else {
        const fileNames = await backupUtils.backupToMultipleFiles(ctx, backupDirPath, tables, timestamp);
        result = `已备份${fileNames.length}个表到${fileNames.length}个文件（时间戳: ${timestamp}）`;

        if (config.keepBackups > 0) {
          await backupUtils.cleanupOldBackups(backupDirPath, `backup_${timestamp}_`, config.keepBackups);
        }
      }

      logger.info(result);
      return result;
    } catch (e) {
      const message = `备份操作失败: ${e.message}`;
      logger.error(message);
      return message;
    }
  };

  /**
   * 执行恢复操作
   */
  const performRestore = async (timestamp?: string): Promise<string> => {
    try {
      backupUtils.ensureDir(backupDirPath);

      const backups = await backupUtils.listBackups(backupDirPath, isSingleFile);

      if (backups.length === 0) {
        return '没有找到可用的备份';
      }

      const targetTimestamp = timestamp || backups[0].timestamp;
      const targetBackup = backups.find(b => b.timestamp === targetTimestamp);

      if (!targetBackup) {
        return `找不到时间戳为 ${targetTimestamp} 的备份`;
      }

      let restoredTables: string[] = [];

      if (isSingleFile) {
        const filePath = path.join(backupDirPath, `backup_${targetTimestamp}.json`);
        restoredTables = await backupUtils.restoreFromSingleFile(ctx, filePath);
      } else {
        restoredTables = await backupUtils.restoreFromMultipleFiles(ctx, backupDirPath);
      }

      if (restoredTables.length === 0) {
        return '没有恢复任何数据，请检查备份文件是否有效';
      }

      const result = `已恢复 ${restoredTables.length} 个表: ${restoredTables.join(', ')}`;
      logger.info(result);
      return result;
    } catch (e) {
      const message = `恢复操作失败: ${e.message}`;
      logger.error(message);
      return message;
    }
  };

  /**
   * 设置定时备份任务
   */
  function setupBackupSchedule() {
    if (backupTimer) {
      clearInterval(backupTimer);
      backupTimer = null;
    }

    const interval = (config.backupInterval || 0) * 60 * 60 * 1000;

    if (interval > 0) {
      logger.info(`定时备份已启用，间隔：${config.backupInterval} 小时`);

      backupTimer = setInterval(async () => {
        logger.info('开始执行定时备份...');
        await performBackup();
      }, interval);
    }
  }

  setupBackupSchedule();

  ctx.on('dispose', () => {
    if (backupTimer) {
      clearInterval(backupTimer);
      backupTimer = null;
    }
  });

  const ins = ctx.command('inspect')

  /**
   * 检查消息元素命令
   * 用于解析和显示消息中的元素结构
   */
  ins.subcommand('elements', '检查消息元素')
    .action(({ session }) => {
      let { elements, quote } = session
      if (quote) elements = quote.elements

      const jsons = []
      elements = elements.map((element) => {
        if (element.type === 'json') {
          jsons.push(JSON.parse(element.attrs.data))
          element.attrs.data = `[JSON ${jsons.length}]`
        }
        return element
      })

      let result = inspect(elements, { depth: Infinity })
      if (jsons.length) {
        result += '\n\n' + jsons.map((data, index) =>
          `[JSON ${index + 1}]: ${inspect(data, { depth: Infinity })}`
        ).join('\n\n')
      }

      return h.text(result)
    })

  /**
   * 获取消息ID命令
   * 显示当前消息或引用消息的ID和相关信息
   */
  ins.subcommand('msgid', '获取消息ID')
    .action(({ session }) => {
      const messageId = session.quote?.id || session.messageId
      const idInfo = {
        messageId,
        platform: session.platform,
        channelId: session.channelId,
        userId: session.userId,
        timestamp: new Date().toISOString()
      }
      return h.text(formatInspect(idInfo))
    })

  /**
   * 数据库管理命令组
   * 提供数据库备份、恢复和查询功能
   */
  const db = ctx.command('db', '数据库管理', { authority: 4 })
    .action(async () => {
      try {
        const stats = await ctx.database.stats();
        return h.text(formatInspect(stats));
      } catch (e) {
        return handleError('获取数据库统计信息', e);
      }
    });

  db.subcommand('.backup', '立即备份数据库')
    .action(() => performBackup());

  db.subcommand('.restore [timestamp]', '恢复数据库')
    .option('list', '-l 列出所有备份')
    .action(async ({ options }, timestamp) => {
      if (options.list) {
        const backups = await backupUtils.listBackups(backupDirPath, isSingleFile);

        if (backups.length === 0) {
          return '没有找到任何备份';
        }

        return '可用备份列表：\n' + backups.map(backup => {
          const date = `${backup.timestamp.slice(0, 4)}-${backup.timestamp.slice(4, 6)}-${backup.timestamp.slice(6, 8)}`;
          const time = `${backup.timestamp.slice(9, 11)}:${backup.timestamp.slice(11, 13)}:${backup.timestamp.slice(13, 15)}`;

          if (isSingleFile) {
            return `- ${date} ${time} [${backup.timestamp}]（单文件备份）`;
          } else {
            return `- ${date} ${time} [${backup.timestamp}]（包含 ${backup.tables.length} 个表）`;
          }
        }).join('\n');
      }

      return performRestore(timestamp);
    });

  db.subcommand('.query <table>', '查询特定表的数据')
    .option('filter', '-f <filter:string>', { fallback: '{}' })
    .option('depth', '-d <depth:number>', { fallback: 3 })
    .action(async ({ options }, table) => {
      if (!table) return '请指定要查询的表名'

      try {
        const filter = JSON.parse(options.filter)
        const depth = options.depth || 3
        const rows = await ctx.database.get(table as any, filter)

        if (rows.length === 0) {
          return `表 ${table} 中没有匹配的数据`
        }

        return h.text(`表 ${table} 查询结果 (${rows.length}):\n${formatInspect(rows, { depth })}`)
      } catch (e) {
        return handleError(`查询表 ${table}`, e)
      }
    })
}
