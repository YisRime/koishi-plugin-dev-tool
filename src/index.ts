import { Context, Schema, h, Logger } from 'koishi'
import { inspect } from 'util'
import { BackupService } from './backup'
import { formatInspect, handleError, DatabaseHelper } from './database'

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
 * 插件主函数，注册命令和功能
 * @param {Context} ctx - Koishi上下文
 * @param {Config} config - 插件配置
 */
export function apply(ctx: Context, config: Config = {}) {
  const backupDirPath = config.backupDir || './data/backups';
  const isSingleFile = config.singleFile ?? false;

  // 创建备份服务
  const backupService = new BackupService(
    ctx,
    backupDirPath,
    isSingleFile,
    config.keepBackups,
    config.tables
  );
  // 设置定时备份
  if (config.backupInterval > 0) {
    backupService.setupSchedule(config.backupInterval);
  }
  // 清理资源
  ctx.on('dispose', () => {
    backupService.dispose();
  });

  const dbHelper = new DatabaseHelper(ctx);
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
    .option('page', '-p <page:number> 页码', { fallback: 1 })
    .action(async ({ options }) => {
      return await dbHelper.getDatabaseOverview(options.page);
    });

  // 查询子命令
  db.subcommand('.query <table>', '从表中查询数据')
    .option('filter', '-f <filter:string>', { fallback: '{}' })
    .option('page', '-p <page:number>', { fallback: 1 })
    .action(async ({ options }, table) => {
      if (!table) return '请指定要查询的表名'
      try {
        const filter = JSON.parse(options.filter)
        const page = Math.max(1, Math.min(10, options.page || 1))
        const pageSize = 5
        return h.text(await dbHelper.queryTable(table, filter, page, pageSize))
      } catch (e) {
        return handleError(`查询表 ${table}`, e)
      }
    });

  // 删除数据子命令
  db.subcommand('.delete <table>', '从表中删除数据')
    .option('filter', '-f <filter:string>', { fallback: '{}' })
    .action(async ({ options }, table) => {
      try {
        if (!table) return '请指定要删除的表名';

        // 有-f选项时只删除匹配的记录，否则清空整个表
        const useFilter = options.filter !== '{}';
        const filter = JSON.parse(options.filter);

        if (useFilter) {
          return await dbHelper.removeRecords(table, filter, false);
        } else {
          return await dbHelper.removeRecords(table, {}, true);
        }
      } catch (e) {
        return handleError(`从表 ${table} 删除数据`, e);
      }
    });

  // 统计记录命令
  db.subcommand('.count <table>', '获取表中记录数量')
    .option('filter', '-f <filter:string>', { fallback: '{}' })
    .action(async ({ options }, table) => {
      if (!table) return '请指定要统计的表名'
      try {
        const filter = JSON.parse(options.filter)
        const result = await dbHelper.getCount(table, filter)
        if (!result.success) {
          return `统计表 ${table} 失败：${result.error}`
        }
        return `表 ${table} 中${Object.keys(filter).length ? '符合条件的有' : '共有'} ${result.count} 条记录`
      } catch (e) {
        return handleError(`统计表 ${table}`, e)
      }
    });

  // 备份命令
  db.subcommand('.backup', '备份数据库')
    .action(() => backupService.performBackup());

  // 恢复命令
  db.subcommand('.restore [index]', '恢复数据库')
    .option('table', '-t <table:string> 只恢复指定表')
    .action(async ({ options }, index) => {
      return backupService.performRestore(index, options?.table);
    });
}
