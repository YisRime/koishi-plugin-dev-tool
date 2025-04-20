import { Context, Schema, h, Logger } from 'koishi'
import { BackupService } from './backup'
import { DbService } from './dbtool'
import { Onebot } from './onebot'
import { formatInspect } from './utils'

export const name = 'dev-tool'
export const inject = ['database']
export const logger = new Logger(name)

export const usage = `
<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #4a6ee0;">📌 插件说明</h2>
  <p>📖 <strong>使用文档</strong>：请点击左上角的 <strong>插件主页</strong> 查看插件使用文档</p>
  <p>🔍 <strong>更多插件</strong>：可访问 <a href="https://github.com/YisRime" style="color:#4a6ee0;text-decoration:none;">苡淞的 GitHub</a> 查看本人的所有插件</p>
</div>

<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #e0574a;">❤️ 支持与反馈</h2>
  <p>🌟 喜欢这个插件？请在 <a href="https://github.com/YisRime" style="color:#e0574a;text-decoration:none;">GitHub</a> 上给我一个 Star！</p>
  <p>🐛 遇到问题？请通过 <strong>Issues</strong> 提交反馈，或加入 QQ 群 <a href="https://qm.qq.com/q/PdLMx9Jowq" style="color:#e0574a;text-decoration:none;"><strong>855571375</strong></a> 进行交流</p>
</div>
`

/**
 * 插件配置接口
 */
export interface Config {
  tables?: string[]
  autoBackup?: boolean
  interval?: number
  dir?: string
  keepBackups?: number
  singleFile?: boolean
  enableOneBot?: boolean
}

/**
 * 插件配置Schema定义
 */
export const Config: Schema<Config> = Schema.object({
  enableOneBot: Schema.boolean().description('启用 OneBot 相关指令').default(false),
  autoBackup: Schema.boolean().description('启用自动备份').default(false),
  singleFile: Schema.boolean().description('以单文件存储备份').default(false),
  interval: Schema.number().description('自动备份间隔（小时）').default(24).min(1),
  keepBackups: Schema.number().description('保留备份数量').default(7).min(0),
  dir: Schema.string().description('备份存储目录').default('./data/backups'),
  tables: Schema.array(String).description('特殊表名（如大写表名）').default([]),
})

/**
 * 插件主函数
 * @param ctx - Koishi上下文
 * @param config - 插件配置
 */
export function apply(ctx: Context, config: Config = {}) {
  // 实例化服务
  const dbService = new DbService(ctx);
  const backupService = new BackupService(ctx, config);
  ctx.on('dispose', () => backupService.dispose())
  // 初始化数据库命令并注册备份命令
  dbService.initialize();
  backupService.registerBackupCommands(dbService.Command);
  // 根据配置决定是否注册 OneBot 命令
  if (config.enableOneBot !== false) {
    const onebotService = new Onebot(ctx);
    onebotService.registerCommands();
  }

  const ins = ctx.command('inspect', '查看详细信息')

  /**
   * 检查消息元素命令
   */
  ins.subcommand('elements', '检查消息元素')
    .option('id', '-i <messageId:string> 指定消息ID')
    .usage('发送或回复消息以查看其元素结构，使用 -i 指定消息ID')
    .action(async ({ session, options }) => {
      let elements
      const messageId = options.id
      if (messageId) {
        try {
          const message = await session.bot.getMessage(session.channelId, messageId)
          if (!message) return '未找到指定消息'
          elements = message.elements
        } catch (error) {
          return `获取消息失败: ${error.message}`
        }
      } else {
        elements = session.quote ? session.quote.elements : session.elements
      }
      const jsons = []
      elements = elements.map((element) => {
        if (element.type === 'json') {
          jsons.push(JSON.parse(element.attrs.data))
          element.attrs.data = `[JSON ${jsons.length}]`
        }
        return element
      })
      let result = formatInspect(elements, { depth: Infinity })
      if (jsons.length) {
        result += '\n' + jsons.map((data, index) =>
          `[JSON ${index + 1}]:\n${formatInspect(data, { depth: Infinity })}`
        ).join('\n')
      }
      return h.text(result)
    })

  /**
   * 获取原始消息内容命令
   */
  ins.subcommand('content', '获取原始内容')
    .option('id', '-i <messageId:string> 指定消息ID')
    .usage('发送或回复消息以查看其原始内容，使用 -i 指定消息ID')
    .action(async ({ session, options }) => {
      const messageId = options.id;
      if (messageId) {
        try {
          const message = await session.bot.getMessage(session.channelId, messageId);
          if (!message) return '未找到指定消息';
          return h.text(message.content);
        } catch (error) {
          return `获取消息失败: ${error.message}`;
        }
      } else if (session.quote) {
        try {
          const quoteMessage = await session.bot.getMessage(session.channelId, session.quote.id);
          if (!quoteMessage) return '未找到引用消息';
          return h.text(quoteMessage.content);
        } catch (error) {
          return `获取引用消息失败: ${error.message}`;
        }
      } else {
        return h.text(session.event.message.content);
      }
    })

  /**
   * 获取消息ID命令
   */
  ins.subcommand('msgid', '获取消息ID')
    .usage('发送或回复消息以获取其消息ID')
    .action(async ({ session }) => {
      if (session.quote) {
        return `引用消息ID: ${session.quote.id}`;
      } else {
        return `当前消息ID: ${session.messageId}`;
      }
    })

  /**
   * 检查会话信息命令
   */
  ins.subcommand('session', '查看会话信息')
    .usage('查看当前会话的信息')
    .action(async ({ session }) => {
      return h.text(formatInspect(session, { depth: Infinity }));
    })
}