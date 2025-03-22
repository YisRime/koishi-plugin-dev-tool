import { Context, Schema, h, Logger } from 'koishi'
import { inspect } from 'util'
import { BackupService } from './backup'
import { DbService } from './dbtool'

/**
 * 插件名称
 */
export const name = 'dev-tool'
export const inject = ['database']

export const logger = new Logger(name)

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
}

/**
 * 插件配置Schema定义
 */
export const Config: Schema<Config> = Schema.object({
  autoBackup: Schema.boolean().description('启用自动备份').default(false),
  singleFile: Schema.boolean().description('以单文件存储备份').default(false),
  interval: Schema.number().description('自动备份间隔（小时）').default(24).min(1),
  keepBackups: Schema.number().description('保留备份数量').default(7).min(0),
  dir: Schema.string().description('备份存储目录').default('./data/backups'),
  tables: Schema.array(String).description('特殊表名（如大写表名）').default([]),
})

/**
 * 数据格式化工具函数
 * @param data - 要格式化的数据
 * @param options - 格式化选项
 * @returns 格式化后的字符串
 */
export function formatInspect(data: any, options: { depth?: number, colors?: boolean } = {}): string {
  return inspect(data, {
    depth: options.depth ?? Infinity,
    colors: options.colors ?? false
  });
}

/**
 * 将数据格式化为表格形式
 * @param data - 数据数组
 * @returns 格式化的表格字符串
 */
export function formatAsTable(data: any[]): string {
  if (!data?.length) return '无数据';

  const allKeys = [...new Set(data.flatMap(item => Object.keys(item)))];
  const priorityKeys = ['id', 'name', 'userId', 'channelId', 'type', 'time', 'date', 'platform'];
  let keys = allKeys.length > 5
    ? priorityKeys.filter(k => allKeys.includes(k)).slice(0, 4) || allKeys.slice(0, 4)
    : allKeys;
  // 计算每列的最大宽度
  const columnWidths = keys.map(key => {
    const maxValueLength = Math.max(
      key.length,
      ...data.map(item => {
        const value = item[key];
        if (value == null) return 0;
        if (typeof value === 'object') {
          return value instanceof Date ? 19 : 6;
        }
        return String(value).length > 20 ? 20 : String(value).length;
      })
    );
    return Math.min(maxValueLength, 20);
  });
  // 生成表头
  let table = keys.map((key, i) => key.padEnd(columnWidths[i])).join(' | ') + '\n';
  // 生成数据行
  data.forEach(item => {
    const row = keys.map((key, i) => {
      const value = item[key];
      let strValue = '';
      if (value == null) {
        strValue = '';
      } else if (typeof value === 'object') {
        strValue = value instanceof Date ? value.toISOString().slice(0, 19) : '[对象]';
      } else {
        strValue = String(value);
        if (strValue.length > 20) {
          strValue = strValue.substring(0, 17) + '...';
        }
      }
      return strValue.padEnd(columnWidths[i]);
    });
    table += row.join(' | ') + '\n';
  });
  return table;
}

/**
 * 获取当前时间戳
 * @returns 格式化的时间戳字符串
 */
export function getTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${
    String(now.getDate()).padStart(2, '0')}_${
    String(now.getHours()).padStart(2, '0')}${
    String(now.getMinutes()).padStart(2, '0')}${
    String(now.getSeconds()).padStart(2, '0')}`;
}

/**
 * 格式化时间戳为日期和时间
 * @param timestamp - 时间戳字符串
 * @returns 格式化后的日期和时间对象
 */
export function formatTimestamp(timestamp: string): {date: string, time: string} {
  return {
    date: `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`,
    time: `${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}`
  };
}

/**
 * JSON内容解析工具，可自动转换日期字符串为Date对象
 * @param content - JSON字符串
 * @returns 解析后的对象
 */
export function parseJSONWithDates(content: string): any {
  return JSON.parse(content, (key, value) => {
    return typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value) ?
      new Date(value) : value;
  });
}

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

  const ins = ctx.command('inspect')

  /**
   * 检查消息元素命令
   */
  ins.subcommand('elements', '检查消息元素')
    .usage('发送或回复消息以查看其元素结构')
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
   * 获取原始消息内容命令
   */
  ins.subcommand('msg', '获取原始消息内容')
    .usage('发送或回复消息以查看其原始内容')
    .action(({ session }) => {
      let content = session.quote ? session.quote.content : session.content
      const elements = session.quote ? session.quote.elements : session.elements
      // 直接返回原始内容
      let result = `原始内容:\n${content}`
      // 添加原始元素
      result += '\n原始元素:\n' + JSON.stringify(elements, null, 2)
      // 简单列出各种元素
      const elementTypes = elements.map(el => el.type)
      if (elementTypes.length > 0) {
        result += '\n消息包含的元素类型: ' + elementTypes.join(', ')
      }
      // 对于特殊元素内容，直接显示原始数据
      elements.forEach((element, idx) => {
        if (element.type === 'json' && element.attrs?.data) {
          result += `\nJSON元素 #${idx + 1} 原始数据:\n` + element.attrs.data
        }
        if (element.type === 'forward') {
          result += `\n转发消息元素 #${idx + 1} 原始数据:\n` + JSON.stringify(element)
        }
      })
      return h('message', [h('code', { lang: 'text' }, result)])
    })
}
