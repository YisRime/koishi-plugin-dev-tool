import { Logger, Context } from 'koishi'
import { inspect } from 'util'

export const logger = new Logger('dev-tool')

/**
 * 格式化检查数据，用于输出可读性更好的对象表示
 * @param {any} data - 要格式化的数据
 * @param {object} options - 格式化选项
 * @param {number} [options.depth] - 检查深度，默认为无限
 * @returns {string} 格式化后的字符串
 */
export function formatInspect(data: any, options: { depth?: number } = {}) {
  return inspect(data, { depth: options.depth !== undefined ? options.depth : Infinity })
}

/**
 * 错误处理助手，统一处理和记录错误
 * @param {string} operation - 操作名称
 * @param {Error} error - 错误对象
 * @returns {string} 格式化的错误信息
 */
export function handleError(operation: string, error: Error) {
  const message = `${operation}失败：${error.message}`
  logger.warn(message)
  return message
}

/**
 * 格式化数据为表格形式
 * @param {any[]} data - 要格式化的数据数组
 * @returns {string} 格式化后的表格字符串
 */
export function formatAsTable(data: any[]): string {
  if (!data || data.length === 0) return '无数据'
  const allKeys = [...new Set(data.flatMap(item => Object.keys(item)))]
  let keys = allKeys
  if (keys.length > 5) {
    const priorityKeys = ['id', 'name', 'userId', 'channelId', 'content', 'type', 'time', 'date']
    const keptKeys = priorityKeys.filter(k => keys.includes(k))
    if (keptKeys.length < 4) {
      const otherKeys = keys.filter(k => !keptKeys.includes(k)).slice(0, 4 - keptKeys.length)
      keys = [...keptKeys, ...otherKeys]
    } else {
      keys = keptKeys.slice(0, 4)
    }
  }
  // 创建表
  let table = keys.join(' | ') + '\n'
  table += keys.map(() => '---').join(' | ') + '\n'
  data.forEach(item => {
    const row = keys.map(key => {
      const value = item[key]
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') {
        if (value instanceof Date) return value.toISOString()
        return '[对象]'
      }
      // 截断长字符串
      const strValue = String(value)
      return strValue.length > 20 ? strValue.substring(0, 17) + '...' : strValue
    })
    table += row.join(' | ') + '\n'
  })

  return table
}

/**
 * 创建分页显示文本
 * @param {any[]} data - 数据数组
 * @param {number} page - 当前页码
 * @param {number} pageSize - 每页条数
 * @param {number} totalPages - 总页数
 * @param {string} table - 表名
 * @returns {string} 分页显示文本
 */
export function createPaginatedDisplay(data: any[], page: number, pageSize: number, totalPages: number, table: string): string {
  const start = (page - 1) * pageSize
  const end = Math.min(start + pageSize, data.length)
  const currentPageData = data.slice(start, end)
  const header = `表 ${table} 查询结果 (共 ${data.length} 条，第 ${page}/${totalPages} 页)\n`
  return header + formatAsTable(currentPageData)
}

/**
 * 通用数据库操作类
 * 封装常用的数据库操作，统一处理逻辑和错误
 */
export class DatabaseHelper {
  ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /**
   * 获取数据库概览信息，显示表和记录数
   * @param {number} page - 当前页码
   * @param {number} pageSize - 每页显示的表数量
   * @returns {Promise<string>} 格式化的数据库概览信息
   */
  async getDatabaseOverview(page: number = 1, pageSize: number = 10) {
    try {
      const stats = await this.ctx.database.stats();
      const tableCount = Object.keys(stats.tables).length;
      if (tableCount === 0) {
        return '数据库中没有表';
      }
      // 按记录数排序表
      const sortedTables = Object.entries(stats.tables)
        .sort(([, a], [, b]) => (b as any).count - (a as any).count);
      const totalRecords = sortedTables.reduce((sum, [, info]: [string, any]) => sum + info.count, 0);
      const totalPages = Math.ceil(sortedTables.length / pageSize);

      page = Math.max(1, Math.min(totalPages, page));
      const startIndex = (page - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, sortedTables.length);
      const currentPageTables = sortedTables.slice(startIndex, endIndex);
      let result = `数据库概览：${tableCount}个表，共${totalRecords}条记录（第${page}/${totalPages}页）\n\n`;
      currentPageTables.forEach(([name, info]: [string, any]) => {
        result += `${name}: ${info.count}条记录\n`;
      });

      return result;
    } catch (e) {
      return handleError('获取数据库概览', e);
    }
  }

  /**
   * 获取表记录数
   */
  async getCount(table: string, filter: any = {}) {
    try {
      const rows = await this.ctx.database.get(table as any, filter)
      return {
        success: true,
        count: rows.length,
        rows
      }
    } catch (e) {
      return {
        success: false,
        error: e.message
      }
    }
  }

  /**
   * 查询表数据
   */
  async queryTable(table: string, filter: any = {}, page = 1, pageSize = 5) {
    try {
      if (!table) return '请指定要查询的表名'

      const result = await this.getCount(table, filter)
      if (!result.success) {
        return handleError(`查询表 ${table}`, new Error(result.error))
      }

      const rows = result.rows
      if (rows.length === 0) {
        return `表 ${table} 中没有匹配的数据`
      }

      const totalPages = Math.min(10, Math.ceil(rows.length / pageSize))
      return createPaginatedDisplay(rows, page, pageSize, totalPages, table)
    } catch (e) {
      return handleError(`查询表 ${table}`, e)
    }
  }

  /**
   * 删除表记录
   * @param table 表名
   * @param filter 过滤条件
   * @param isTruncate 是否是清空表操作
   */
  async removeRecords(table: string, filter: any = {}, isTruncate = false) {
    if (!table) return '请指定要操作的表名'
    try {
      // 先查询匹配的数据
      const result = await this.getCount(table, filter)
      if (!result.success) {
        return handleError(`从表 ${table} 删除数据`, new Error(result.error))
      }

      const rows = result.rows
      if (rows.length === 0) {
        return `表 ${table} 中没有匹配的数据`
      }

      // 执行删除操作
      await this.ctx.database.remove(table as any, filter)

      // 根据操作类型返回不同的消息
      if (Object.keys(filter).length === 0) {
        return `已清空表 ${table}，删除了 ${rows.length} 条数据`
      } else {
        return `已从表 ${table} 中删除 ${rows.length} 条匹配记录`
      }
    } catch (e) {
      const operation = isTruncate ? `清空表 ${table}` : `从表 ${table} 删除数据`
      return handleError(operation, e)
    }
  }
}
