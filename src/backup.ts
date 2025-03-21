import { Context } from 'koishi'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { Config, logger, getTimestamp, formatTimestamp, parseJSONWithDates } from './index'

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
   * @param ctx - Koishi上下文
   * @param config - 备份配置
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
   * @param intervalHours - 备份间隔（小时）
   * @private
   */
  private setupAutoBackup(intervalHours: number): void {
    this.backupTimer && clearInterval(this.backupTimer)
    const interval = intervalHours * 60 * 60 * 1000
    logger.info(`已启用定时备份（${intervalHours} 小时）`)

    this.backupTimer = setInterval(async () => {
      logger.info('执行定时备份...')

      try {
        this.ensureBackupDir()
        const timestamp = getTimestamp()
        const tables = await this.getTablesForBackup()

        if (tables.length === 0) {
          logger.info('无可备份的表')
          return
        }

        const result = await this.backupTables(tables, timestamp);

        if (this.config.keepBackups > 0) {
          await this.cleanupOldBackups(this.config.keepBackups)
        }

        logger.info(result)
      } catch (e) {
        logger.error(`定时备份失败: ${e.message}`)
      }
    }, interval)
  }

  /**
   * 执行备份表数据操作
   * @param tables - 要备份的表列表
   * @param timestamp - 时间戳标识
   * @returns 备份结果消息
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
          logger.warn(`备份表失败: ${table} (${e.message})`)
        }
      }

      const fileName = `backup_${timestamp}.json`
      const filePath = path.join(this.config.dir, fileName)
      await fs.writeFile(filePath, JSON.stringify(allData, null, 2))

      let result = `备份完成 (${successCount}/${tables.length}) ${timestamp}`
      if (failedTables.length > 0) {
        result += `\n未成功: ${failedTables.join(', ')}`
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
          logger.warn(`备份表失败: ${table} (${e.message})`)
        }
      }

      let result = `备份完成 (${successFiles.length}/${tables.length}) ${timestamp}`
      if (failedTables.length > 0) {
        result += `\n未成功: ${failedTables.join(', ')}`
      }
      return result
    }
  }

  /**
   * 获取需要备份的表列表
   * @param specificTables - 指定要备份的表
   * @returns 需要备份的表列表
   * @private
   */
  private async getTablesForBackup(specificTables?: string[]): Promise<string[]> {
    try {
      const dbStats = await this.ctx.database.stats()
      const existingTables = Object.keys(dbStats.tables || {})

      if (specificTables?.length) {
        return specificTables.filter(table => {
          const exists = existingTables.some(t => t.toLowerCase() === table.toLowerCase())
          !exists && logger.warn(`表不存在: ${table}`)
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
   * 执行备份恢复
   * @param backup - 备份信息
   * @param backup.timestamp - 备份时间戳
   * @param backup.tables - 备份的表列表
   * @param tableNames - 指定要恢复的表
   * @returns 恢复的表列表
   * @private
   */
  private async restoreBackup(backup: {timestamp: string, tables?: string[]}, tableNames?: string[]): Promise<string[]> {
    const timestamp = backup.timestamp

    if (this.config.singleFile) {
      const filePath = path.join(this.config.dir, `backup_${timestamp}.json`)
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const allData = parseJSONWithDates(content)

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
            const data = parseJSONWithDates(content)

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
            const data = parseJSONWithDates(content)

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
   * @param backups - 备份列表
   * @returns 格式化后的备份列表
   * @private
   */
  private formatBackupsList(backups: {timestamp: string, tables?: string[]}[]): string {
    let result = '可用备份（输入序号恢复）:\n'
    result += backups.map((backup, idx) => {
      const { date, time } = formatTimestamp(backup.timestamp)
      const count = this.config.singleFile ? 1 : (backup.tables?.length || 0)
      return `${idx + 1}. ${date} ${time} (${count})`
    }).join('\n')
    return result
  }

  /**
   * 注册备份相关命令
   * @param db - 数据库命令对象
   */
  registerBackupCommands(db: any): void {
    db.subcommand('.backup', '备份数据库')
      .option('tables', '-t <tables:string> 指定表（逗号分隔）')
      .action(async ({ options }) => {
        try {
          this.ensureBackupDir()
          const timestamp = getTimestamp()
          const specificTables = options.tables ? options.tables.split(',').filter(Boolean) : undefined
          const tables = await this.getTablesForBackup(specificTables)

          if (tables.length === 0) {
            return '无可备份的表'
          }

          const result = await this.backupTables(tables, timestamp);

          if (this.config.keepBackups > 0) {
            await this.cleanupOldBackups(this.config.keepBackups)
          }

          logger.info(result)
          return result
        } catch (e) {
          return `备份失败: ${e.message}`
        }
      })

    db.subcommand('.restore [index]', '恢复数据库')
      .option('tables', '-t <tables:string> 指定表（逗号分隔）')
      .action(async ({ options }, index) => {
        try {
          this.ensureBackupDir()
          const backups = await this.listBackups()
          const tableNames = options.tables ? options.tables.split(',').filter(Boolean) : undefined

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
              ? `未找到备份数据: ${tableNames.join(', ')}`
              : '无有效数据'
          }

          const result = tableNames?.length
            ? `已恢复表: ${restoredTables.join(', ')}`
            : `已恢复 (${restoredTables.length}/${targetBackup.tables?.length || 1})`

          return result
        } catch (e) {
          return `恢复失败: ${e.message}`
        }
      })
  }

  /**
   * 清理旧备份
   * @param keepCount - 保留的备份数量
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
      logger.error(`清理旧备份失败: ${e.message}`)
    }
  }

  /**
   * 列出可用备份
   * @returns 备份列表
   * @private
   */
  private async listBackups(): Promise<{timestamp: string, tables?: string[]}[]> {
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
  }
}
