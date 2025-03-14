import { Context, Schema, h, Logger } from 'koishi'
import { inspect } from 'util'
import { BackupService } from './backup'
import { DbService } from './command'

/**
 * 插件名称
 * @type {string}
 */
export const name = 'dev-tool'
export const inject = ['database']

/**
 * 插件专用日志记录器
 * @type {Logger}
 */
export const logger = new Logger(name)

/**
 * 插件配置接口
 * @interface Config
 * @property {string[]} [tables] - 数据库特殊表名（例如大写）
 * @property {boolean} [autoBackup] - 是否启用自动备份
 * @property {number} [interval] - 自动备份时间间隔（小时）
 * @property {string} [dir] - 备份存储目录
 * @property {number} [keepBackups] - 保留备份数量
 * @property {boolean} [singleFile] - 是否以单文件存储备份
 */
export interface Config {
  tables?: string[]
  autoBackup?: boolean
  interval?: number
  dir?: string
  keepBackups?: number
  singleFile?: boolean
}

/**
 * 插件配置Schema定义
 * @type {Schema<Config>}
 */
export const Config: Schema<Config> = Schema.object({
  autoBackup: Schema.boolean().description('是否启用自动备份').default(false),
  singleFile: Schema.boolean().description('备份以单文件存储').default(false),
  interval: Schema.number().description('自动备份时间间隔（小时）').default(24).min(1),
  keepBackups: Schema.number().description('保留备份数量（设置为 0 关闭限制）').default(7).min(0),
  dir: Schema.string().description('备份存储目录').default('./data/backups'),
  tables: Schema.array(String).description('数据库特殊表名（例如大写）').default([]),
})

/**
 * 插件主函数，注册命令和功能
 * @param {Context} ctx - Koishi上下文
 * @param {Config} config - 插件配置
 */
export function apply(ctx: Context, config: Config = {}) {
  // 实例化服务
  const dbService = new DbService(ctx);
  const backupService = new BackupService(ctx, config);
  ctx.on('dispose', () => backupService.dispose())

  // 初始化数据库命令并注册备份命令
  dbService.initialize();
  backupService.registerBackupCommands(dbService.Command);

  const ins = ctx.command('inspect')

  /**
   * 检查消息元素命令
   * 用于解析和显示消息中的元素结构
   */
  ins.subcommand('elements', '检查消息元素')
    .usage('发送消息或回复一条消息来检查其元素结构')
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
}
