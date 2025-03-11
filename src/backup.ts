import { Context, Logger } from 'koishi'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'

export const logger = new Logger('dev-tool')

/**
 * 备份服务类
 */
export class BackupService {
  private ctx: Context;
  private backupDirPath: string;
  private isSingleFile: boolean;
  private keepBackups: number;
  private backupTimer: NodeJS.Timeout = null;
  private tables: string[];

  /**
   * 创建备份服务
   * @param ctx Koishi上下文
   * @param backupDirPath 备份目录路径
   * @param isSingleFile 是否使用单文件备份
   * @param keepBackups 保留备份数量
   * @param customTables 自定义表名
   */
  constructor(ctx: Context, backupDirPath: string, isSingleFile: boolean, keepBackups: number, customTables: string[] = []) {
    this.ctx = ctx;
    this.backupDirPath = backupDirPath;
    this.isSingleFile = isSingleFile;
    this.keepBackups = keepBackups;
    this.tables = customTables || [];
    this.ensureBackupDir();
  }

  /**
   * 设置定时备份
   * @param intervalHours 备份间隔（小时）
   */
  setupSchedule(intervalHours: number): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
    const interval = intervalHours * 60 * 60 * 1000;
    if (interval > 0) {
      logger.info(`定时备份已启用，间隔：${intervalHours} 小时`);
      this.backupTimer = setInterval(async () => {
        logger.info('开始执行定时备份...');
        await this.performBackup();
      }, interval);
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
  }

  /**
   * 执行备份操作
   */
  async performBackup(): Promise<string> {
    try {
      this.ensureBackupDir();
      const timestamp = backupUtils.getTimestamp();
      const dbStats = await this.ctx.database.stats();
      const allTables = [...Object.keys(dbStats.tables), ...this.tables];
      if (allTables.length === 0) {
        return '没有找到可备份的表';
      }
      let result: string;
      if (this.isSingleFile) {
        const fileName = await backupUtils.backupToSingleFile(this.ctx, this.backupDirPath, allTables, timestamp);
        result = `备份完成: ${fileName}（${allTables.length}个表）`;
        if (this.keepBackups > 0) {
          await backupUtils.cleanupOldBackups(this.backupDirPath, 'backup_', this.keepBackups);
        }
      } else {
        const fileNames = await backupUtils.backupToMultipleFiles(this.ctx, this.backupDirPath, allTables, timestamp);
        result = `备份完成: 时间戳${timestamp}，${fileNames.length}个表`;
        if (this.keepBackups > 0) {
          await backupUtils.cleanupOldBackups(this.backupDirPath, `backup_${timestamp}_`, this.keepBackups);
        }
      }
      logger.info(result);
      return result;
    } catch (e) {
      const message = `备份失败: ${e.message}`;
      logger.error(message);
      return message;
    }
  }

  /**
   * 恢复数据库
   * 优化逻辑：默认显示备份列表，通过序号选择要恢复的备份
   * @param index 备份序号（从1开始）
   * @param tableName 指定要恢复的表名（多文件备份模式有效）
   */
  async performRestore(index?: string, tableName?: string): Promise<string> {
    try {
      this.ensureBackupDir();
      const backups = await backupUtils.listBackups(this.backupDirPath, this.isSingleFile);
      if (backups.length === 0) {
        return '没有找到可用的备份';
      }

      if (!index) {
        let result = '可用备份列表：\n\n';
        result += backups.map((backup, idx) => {
          const date = `${backup.timestamp.slice(0, 4)}-${backup.timestamp.slice(4, 6)}-${backup.timestamp.slice(6, 8)}`;
          const time = `${backup.timestamp.slice(9, 11)}:${backup.timestamp.slice(11, 13)}:${backup.timestamp.slice(13, 15)}`;
          if (this.isSingleFile) {
            return `${idx + 1}. ${date} ${time}（单文件备份）`;
          } else {
            return `${idx + 1}. ${date} ${time}（包含 ${backup.tables?.length || 0} 个表）`;
          }
        }).join('\n');

        result += '\n\n使用 db.restore <序号> 恢复指定备份';
        return result;
      }

      const backupIndex = parseInt(index) - 1;
      if (isNaN(backupIndex) || backupIndex < 0 || backupIndex >= backups.length) {
        return `无效序号，应在 1-${backups.length} 之间`;
      }

      const targetBackup = backups[backupIndex];
      let restoredTables: string[] = [];

      if (this.isSingleFile) {
        const filePath = path.join(this.backupDirPath, `backup_${targetBackup.timestamp}.json`);
        // 只恢复单表
        if (tableName) {
          restoredTables = await backupUtils.restoreSpecificTableFromSingleFile(
            this.ctx, filePath, tableName
          );
        } else {
          // 恢复全部表
          restoredTables = await backupUtils.restoreFromSingleFile(this.ctx, filePath);
        }
      }
      else {
        const timestamp = targetBackup.timestamp;
        if (tableName) {
          // 只恢复单表
          restoredTables = await backupUtils.restoreSpecificTable(
            this.ctx, this.backupDirPath, timestamp, tableName
          );
        } else {
          // 恢复所有表
          restoredTables = await backupUtils.restoreFromMultipleFiles(
            this.ctx, this.backupDirPath, timestamp
          );
        }
      }

      if (restoredTables.length === 0) {
        return tableName
          ? `未找到表 ${tableName} 的有效备份数据`
          : '没有恢复任何数据，请检查文件是否有效';
      }

      const result = tableName
        ? `已恢复表 ${tableName}`
        : `已恢复备份 #${backupIndex + 1}，共 ${restoredTables.length} 个表`;

      logger.info(result);
      return result;
    } catch (e) {
      const message = `恢复操作失败: ${e.message}`;
      logger.error(message);
      return message;
    }
  }

  /**
   * 列出所有备份
   */
  async listAllBackups(): Promise<string> {
    const backups = await backupUtils.listBackups(this.backupDirPath, this.isSingleFile);
    if (backups.length === 0) {
      return '没有找到任何备份';
    }
    return '可用备份列表：\n' + backups.map(backup => {
      const date = `${backup.timestamp.slice(0, 4)}-${backup.timestamp.slice(4, 6)}-${backup.timestamp.slice(6, 8)}`;
      const time = `${backup.timestamp.slice(9, 11)}:${backup.timestamp.slice(11, 13)}:${backup.timestamp.slice(13, 15)}`;
      if (this.isSingleFile) {
        return `- ${date} ${time} [${backup.timestamp}]（单文件备份）`;
      } else {
        return `- ${date} ${time} [${backup.timestamp}]（包含 ${backup.tables.length} 个表）`;
      }
    }).join('\n');
  }

  /**
   * 确保备份目录存在
   */
  private ensureBackupDir(): void {
    backupUtils.ensureDir(this.backupDirPath);
  }
}

/**
 * 文件操作工具集合
 */
export const backupUtils = {
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
   * 从单个文件恢复特定表
   */
  async restoreSpecificTableFromSingleFile(ctx: Context, filePath: string, tableName: string): Promise<string[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const allData = JSON.parse(content, (key, value) => {
        return typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value) ?
          new Date(value) : value;
      });

      // 检查表是否存在于备份中
      if (!allData[tableName] || !Array.isArray(allData[tableName])) {
        logger.warn(`备份中不包含表 ${tableName} 的数据`);
        return [];
      }

      // 恢复指定的表
      const data = allData[tableName];
      if (data.length > 0) {
        await ctx.database.upsert(tableName as any, data);
        return [tableName];
      }
      return [];
    } catch (e) {
      logger.error(`从文件 ${filePath} 恢复表 ${tableName} 失败: ${e.message}`);
      return [];
    }
  },

  /**
   * 从多个文件恢复数据
   * @param timestamp 指定的时间戳，用于过滤特定备份
   */
  async restoreFromMultipleFiles(ctx: Context, dirPath: string, timestamp?: string): Promise<string[]> {
    const files = await fs.readdir(dirPath);
    const pattern = timestamp ?
      new RegExp(`^backup_${timestamp}_(.+)\\.json$`) :
      /^backup_\d+_(.+)\.json$/;

    const backupFiles = files.filter(file => file.match(pattern));
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
   * 从多文件备份中恢复特定表
   */
  async restoreSpecificTable(ctx: Context, dirPath: string, timestamp: string, tableName: string): Promise<string[]> {
    const files = await fs.readdir(dirPath);
    const targetFile = files.find(file => file === `backup_${timestamp}_${tableName}.json`);

    if (!targetFile) {
      logger.warn(`未找到表 ${tableName} 的备份文件`);
      return [];
    }

    try {
      const filePath = path.join(dirPath, targetFile);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content, (key, value) => {
        return typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value) ?
          new Date(value) : value;
      });

      if (Array.isArray(data) && data.length > 0) {
        await ctx.database.upsert(tableName as any, data);
        return [tableName];
      }
      return [];
    } catch (e) {
      logger.warn(`恢复表 ${tableName} 失败: ${e.message}`);
      return [];
    }
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
