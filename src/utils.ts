import { Session, h } from 'koishi';
import { inspect } from 'util';

/**
 * 工具函数集合
 */
export const utils = {
  /**
   * 解析目标用户ID (支持@元素、@数字格式或纯数字)
   * @param target - 要解析的目标字符串，可以是纯数字、`@`元素或`@`数字格式
   * @returns 解析出的用户ID，如果解析失败则返回null
   */
  parseTarget(target: string): string | null {
    if (!target) return null
    // 尝试解析at元素
    try {
      const atElement = h.select(h.parse(target), 'at')[0]
      if (atElement?.attrs?.id) return atElement.attrs.id;
    } catch {}
    // 尝试匹配@数字格式或纯数字
    const atMatch = target.match(/@(\d+)/)
    const userId = atMatch ? atMatch[1] : (/^\d+$/.test(target.trim()) ? target.trim() : null);
    // 验证ID格式：5-10位数字
    return userId && /^\d{5,10}$/.test(userId) ? userId : null;
  },

  /**
   * 处理错误并发送提示消息
   */
  async handleError(session: Session, error: any) {
    const errorMsg = error?.message || String(error);
    const msg = await session.send(errorMsg);
    if (typeof msg === 'string')
      setTimeout(() => session.bot.deleteMessage(session.channelId, msg).catch(() => { }), 10000);
    return null;
  },

  /**
   * 自动撤回消息
   * @param session - 会话对象
   * @param message - 要撤回的消息ID
   * @param delay - 撤回延迟时间(毫秒)，默认15s
   * @returns Promise<void>
   */
  async autoRecall(session: Session, message: string | number, delay: number = 15000): Promise<void> {
    if (!session || !message) return
    setTimeout(async () => {
      try {
        await session.bot?.deleteMessage(session.channelId, message.toString())
      } catch (e) {
        // 忽略撤回失败的错误
      }
    }, delay)
  }
}

/**
 * 数据格式化工具函数
 * @param data - 要格式化的数据
 * @param options - 格式化选项
 * @returns 格式化后的字符串
 */
export function formatInspect(data: any, options: { depth?: number, colors?: boolean, showHidden?: boolean } = {}): string {
  return inspect(data, {
    depth: options.depth ?? Infinity,
    colors: options.colors ?? false,
    showHidden: options.showHidden ?? false,
    maxArrayLength: null,
    maxStringLength: null,
    getters: true,
    compact: false
  });
}

/**
 * 将数据格式化为表格形式
 * @param data - 数据数组
 * @returns 格式化的表格字符串
 */
export function formatAsTable(data: any[]): string {
  if (!data?.length) return '无数据';

  const keys = [...new Set(data.flatMap(item => Object.keys(item)))];

  // 计算每列的最大宽度
  const columnWidths = keys.map(key => {
    return Math.max(
      key.length,
      ...data.map(item => {
        const value = item[key];
        if (value == null) return 0;
        if (typeof value === 'object') {
          return value instanceof Date ? 19 : JSON.stringify(value).length;
        }
        return String(value).length;
      })
    );
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
        strValue = value instanceof Date ? value.toISOString().slice(0, 19) : JSON.stringify(value);
      } else {
        strValue = String(value);
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
