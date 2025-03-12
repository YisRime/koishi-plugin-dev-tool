import { Context } from 'koishi'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { Config, logger } from './index'

/**
 * 数据库备份服务类
 * 提供数据库备份、恢复和管理功能
 */
export class BackupService {
  private ctx: Context
  private backupTimer: NodeJS.Timeout = null
  private config: Config

  /**
   * 构造函数
   * @param {Context} ctx - Koishi上下文
   * @param {Config} config - 备份配置
   */
  constructor(ctx: Context, config: Config = {}) {
    this.ctx = ctx
    this.config = config

    this.ensureBackupDir()
    if (this.config.autoBackup && this.config.interval > 0) {
      this.setupAutoBackup(this.config.interval)
    }
  }

  /**
   * 清理资源（停止定时任务）
   */
  dispose(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer)
      this.backupTimer = null
      logger.info('已停止定时备份')
    }
  }

  /**
   * 确保备份目录存在
   * @private
   */
  private ensureBackupDir(): void {
    if (!existsSync(this.config.dir)) {
      mkdirSync(this.config.dir, { recursive: true })
    }
  }

  /**
   * 设置定时备份
   * @param {number} intervalHours - 备份间隔（小时）
   * @private
   */
  private setupAutoBackup(intervalHours: number): void {
    this.backupTimer && clearInterval(this.backupTimer)
    const interval = intervalHours * 60 * 60 * 1000
    logger.info(`已开启定时备份（每 ${intervalHours} 小时）`)

    this.backupTimer = setInterval(async () => {
      logger.info('开始定时备份...')
      await this.performBackup()
    }, interval)
  }

  /**
   * 执行备份操作
   * @param {string[]} [specificTables] - 指定要备份的表
   * @returns {Promise<string>} 备份结果消息
   */
  async performBackup(specificTables?: string[]): Promise<string> {
    try {
      this.ensureBackupDir()
      const timestamp = this.getTimestamp()
      const tables = await this.getTablesForBackup(specificTables)

      if (tables.length === 0) {
        return '无可备份表'
      }

      const result = await this.backupTables(tables, timestamp);

      if (this.config.keepBackups > 0) {
        await this.cleanupOldBackups(this.config.keepBackups)
      }

      logger.info(result)
      return result
    } catch (e) {
      return `备份失败：${e.message}`
    }
  }

  /**
   * 执行备份表数据操作
   * @param {string[]} tables - 要备份的表列表
   * @param {string} timestamp - 时间戳标识
   * @returns {Promise<string>} 备份结果消息
   * @private
   */
  private async backupTables(tables: string[], timestamp: string): Promise<string> {
    if (this.config.singleFile) {
      // 单文件备份
      const allData: Record<string, any[]> = {}
      let successCount = 0
      let failedTables: string[] = []

      for (const table of tables) {
        try {
          const rows = await this.ctx.database.get(table as any, {})
          allData[table] = rows
          successCount++
        } catch (e) {
          failedTables.push(table)
          logger.warn(`备份表 ${table} 失败: ${e.message}`)
        }
      }

      const fileName = `backup_${timestamp}.json`
      const filePath = path.join(this.config.dir, fileName)
      await fs.writeFile(filePath, JSON.stringify(allData, null, 2))

      let result = `备份完成（${successCount}/${tables.length}）\n${timestamp}`
      if (failedTables.length > 0) {
        result += `\n失败表: ${failedTables.join(', ')}`
      }
      return result
    } else {
      // 多文件备份
      const successFiles: string[] = []
      const failedTables: string[] = []

      for (const table of tables) {
        try {
          const rows = await this.ctx.database.get(table as any, {})
          const fileName = `backup_${timestamp}_${table}.json`
          const filePath = path.join(this.config.dir, fileName)
          await fs.writeFile(filePath, JSON.stringify(rows, null, 2))
          successFiles.push(fileName)
        } catch (e) {
          failedTables.push(table)
          logger.warn(`备份表 ${table} 失败: ${e.message}`)
        }
      }

      let result = `备份完成（${successFiles.length}/${tables.length}）\n${timestamp}`
      if (failedTables.length > 0) {
        result += `\n失败表: ${failedTables.join(', ')}`
      }
      return result
    }
  }

  /**
   * 获取需要备份的表列表
   * @param {string[]} [specificTables] - 指定要备份的表
   * @returns {Promise<string[]>} 需要备份的表列表
   * @private
   */
  private async getTablesForBackup(specificTables?: string[]): Promise<string[]> {
    try {
      const dbStats = await this.ctx.database.stats()
      const existingTables = Object.keys(dbStats.tables || {})

      if (specificTables?.length) {
        return specificTables.filter(table => {
          const exists = existingTables.some(t => t.toLowerCase() === table.toLowerCase())
          !exists && logger.warn(`表 ${table} 不存在`)
          return exists
        })
      }

      const allTables = new Set(existingTables)

      if (this.config.tables?.length) {
        for (const customTable of this.config.tables) {
          const matchedTable = existingTables.find(t =>
            t.toLowerCase() === customTable.toLowerCase())
          matchedTable ? allTables.add(matchedTable) : allTables.add(customTable)
        }
      }

      return Array.from(allTables)
    } catch (e) {
      throw new Error(`获取表失败: ${e.message}`)
    }
  }

  /**
   * 恢复备份
   * @param {string} [index] - 备份序号
   * @param {string[]} [tableNames] - 指定要恢复的表
   * @returns {Promise<string>} 恢复结果消息
   */
  async performRestore(index?: string, tableNames?: string[]): Promise<string> {
    try {
      this.ensureBackupDir()
      const backups = await this.listBackups()

      if (backups.length === 0) {
        return '无可用备份'
      }

      if (!index) {
        return this.formatBackupsList(backups)
      }

      const backupIndex = parseInt(index) - 1
      if (isNaN(backupIndex) || backupIndex < 0 || backupIndex >= backups.length) {
        return `无效序号`
      }

      const targetBackup = backups[backupIndex]
      const restoredTables = await this.restoreBackup(targetBackup, tableNames)

      if (restoredTables.length === 0) {
        return tableNames?.length
          ? `未找到备份表 ${tableNames.join(', ')}`
          : '无有效数据'
      }

      const result = tableNames?.length
        ? `已恢复备份表 ${restoredTables.join(', ')}`
        : `已恢复备份（${restoredTables.length}/${targetBackup.tables?.length || 1}）`

      logger.info(result)
      return result
    } catch (e) {
      return `恢复失败：${e.message}`
    }
  }

  /**
   * 执行备份恢复
   * @param {Object} backup - 备份信息
   * @param {string} backup.timestamp - 备份时间戳
   * @param {string[]} [backup.tables] - 备份的表列表
   * @param {string[]} [tableNames] - 指定要恢复的表
   * @returns {Promise<string[]>} 恢复的表列表
   * @private
   */
  private async restoreBackup(backup: {timestamp: string, tables?: string[]}, tableNames?: string[]): Promise<string[]> {
    const timestamp = backup.timestamp

    if (this.config.singleFile) {
      const filePath = path.join(this.config.dir, `backup_${timestamp}.json`)
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const allData = this.parseJSONWithDates(content)

        if (tableNames?.length) {
          // 从单文件恢复特定表
          const restoredTables: string[] = []

          for (const tableName of tableNames) {
            if (!allData[tableName] || !Array.isArray(allData[tableName])) {
              continue
            }

            const data = allData[tableName]
            if (data.length > 0) {
              await this.ctx.database.upsert(tableName as any, data)
              restoredTables.push(tableName)
            }
          }
          return restoredTables
        } else {
          // 从单文件恢复所有表
          const restoredTables: string[] = []
          for (const [table, data] of Object.entries(allData)) {
            if (Array.isArray(data) && data.length > 0) {
              await this.ctx.database.upsert(table as any, data)
              restoredTables.push(table)
            }
          }
          return restoredTables
        }
      } catch (e) {
        logger.error(`恢复失败: ${e.message}`)
        return []
      }
    } else {
      // 多文件模式恢复
      const files = await fs.readdir(this.config.dir)
      const restoredTables: string[] = []

      if (tableNames?.length) {
        // 恢复特定表
        for (const tableName of tableNames) {
          const targetFile = files.find(file => file === `backup_${timestamp}_${tableName}.json`)
          if (!targetFile) {
            continue
          }

          try {
            const filePath = path.join(this.config.dir, targetFile)
            const content = await fs.readFile(filePath, 'utf-8')
            const data = this.parseJSONWithDates(content)

            if (Array.isArray(data) && data.length > 0) {
              await this.ctx.database.upsert(tableName as any, data)
              restoredTables.push(tableName)
            }
          } catch (e) {
            logger.warn(`恢复表 ${tableName} 失败: ${e.message}`)
          }
        }
        return restoredTables
      } else {
        // 恢复所有表
        const pattern = new RegExp(`^backup_${timestamp}_(.+)\\.json$`)
        const backupFiles = files.filter(file => file.match(pattern))

        for (const fileName of backupFiles) {
          try {
            const match = fileName.match(/^backup_\d+_(.+)\.json$/)
            if (!match) continue

            const tableName = match[1]
            const filePath = path.join(this.config.dir, fileName)
            const content = await fs.readFile(filePath, 'utf-8')
            const data = this.parseJSONWithDates(content)

            if (Array.isArray(data) && data.length > 0) {
              await this.ctx.database.upsert(tableName as any, data)
              restoredTables.push(tableName)
            }
          } catch (e) {
            logger.warn(`恢复文件 ${fileName} 失败: ${e.message}`)
          }
        }
        return restoredTables
      }
    }
  }

  /**
   * 格式化备份列表显示
   * @param {Object[]} backups - 备份列表
   * @param {string} backups.timestamp - 备份时间戳
   * @param {string[]} [backups.tables] - 备份的表列表
   * @returns {string} 格式化后的备份列表
   * @private
   */
  private formatBackupsList(backups: {timestamp: string, tables?: string[]}[]): string {
    let result = '可用备份（指定序号进行恢复）：\n'
    result += backups.map((backup, idx) => {
      const { date, time } = this.formatTimestamp(backup.timestamp)
      const count = this.config.singleFile ? 1 : (backup.tables?.length || 0)
      return `${idx + 1}. ${date} ${time}（${count}）`
    }).join('\n')

    return result
  }

  /**
   * 格式化时间戳为日期和时间
   * @param {string} timestamp - 时间戳
   * @returns {Object} 格式化后的日期和时间
   * @returns {string} date - 日期
   * @returns {string} time - 时间
   * @private
   */
  private formatTimestamp(timestamp: string): {date: string, time: string} {
    return {
      date: `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`,
      time: `${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}`
    }
  }

  /**
   * 注册备份相关命令
   * @param {any} db - 数据库实例
   */
  registerBackupCommands(db: any): void {
    db.subcommand('.backup', '备份数据库')
      .option('tables', '-t <tables:string> 备份指定表（逗号分隔）')
      .action(async ({ options }) => {
        const tables = options.tables ? options.tables.split(',').filter(Boolean) : undefined
        return this.performBackup(tables)
      })
    db.subcommand('.restore [index]', '恢复数据库')
      .option('tables', '-t <tables:string> 恢复指定表（逗号分隔）')
      .action(async ({ options }, index) => {
        const tables = options.tables ? options.tables.split(',').filter(Boolean) : undefined
        return this.performRestore(index, tables)
      })
  }

  /**
   * 获取备份时间戳
   * @returns {string} 时间戳
   * @private
   */
  private getTimestamp(): string {
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${
      String(now.getDate()).padStart(2, '0')}_${
      String(now.getHours()).padStart(2, '0')}${
      String(now.getMinutes()).padStart(2, '0')}${
      String(now.getSeconds()).padStart(2, '0')}`
  }

  /**
   * 清理旧备份
   * @param {number} keepCount - 保留的备份数量
   * @private
   */
  private async cleanupOldBackups(keepCount: number): Promise<void> {
    if (!keepCount) return
    try {
      const files = await fs.readdir(this.config.dir)
      const pattern = this.config.singleFile ? 'backup_' : 'backup_'

      const backupFiles = files
        .filter(file => file.startsWith(pattern))
        .sort((a, b) => b.localeCompare(a))

      if (backupFiles.length > keepCount) {
        for (let i = keepCount; i < backupFiles.length; i++) {
          await fs.unlink(path.join(this.config.dir, backupFiles[i]))
          logger.info(`已删除旧备份: ${backupFiles[i]}`)
        }
      }
    } catch (e) {
      logger.error(`删除旧备份失败: ${e.message}`)
    }
  }

  /**
   * JSON内容解析工具，可自动转换日期字符串为Date对象
   * @param {string} content - JSON内容
   * @returns {any} 解析后的对象
   * @private
   */
  private parseJSONWithDates(content: string): any {
    return JSON.parse(content, (key, value) => {
      return typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value) ?
        new Date(value) : value
    })
  }

  /**
   * 列出可用备份
   * @returns {Promise<Object[]>} 备份列表
   * @returns {string} backups.timestamp - 备份时间戳
   * @returns {string[]} [backups.tables] - 备份的表列表
   * @private
   */
  private async listBackups(): Promise<{timestamp: string, tables?: string[]}[]> {
    try {
      const files = await fs.readdir(this.config.dir)

      if (this.config.singleFile) {
        // 单文件备份模式
        return files
          .filter(file => file.match(/^backup_\d+\.json$/))
          .map(file => {
            const match = file.match(/^backup_(\d+)\.json$/);
            return match ? { timestamp: match[1] } : null;
          })
          .filter(Boolean)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
