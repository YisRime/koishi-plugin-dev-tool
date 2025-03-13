import { Context } from 'koishi';
import { inspect } from 'util';
import { logger } from './index';

/**
 * 格式化数据为可读字符串
 * @param {any} data - 要格式化的数据
 * @param {object} options - 格式化选项
 * @param {number} [options.depth] - 格式化深度，默认为无限
 * @returns {string} 格式化后的字符串
 */
function formatInspect(data: any, options: { depth?: number } = {}) {
  return inspect(data, { depth: options.depth ?? Infinity })
}

/**
 * 将数据格式化为表格形式
 * @param {any[]} data - 数据数组
 * @returns {string} 格式化的表格字符串
 */
function formatAsTable(data: any[]): string {
  if (!data?.length) return '无数据'

  const allKeys = [...new Set(data.flatMap(item => Object.keys(item)))]
  const priorityKeys = ['id', 'name', 'userId', 'channelId', 'type', 'time', 'date', 'platform']
  let keys = allKeys.length > 5
    ? priorityKeys.filter(k => allKeys.includes(k)).slice(0, 4) || allKeys.slice(0, 4)
    : allKeys

  let table = keys.join(' | ') + '\n' + keys.map(() => '---').join(' | ') + '\n'
  data.forEach(item => {
    const row = keys.map(key => {
      const value = item[key]
      if (value == null) return ''
      if (typeof value === 'object') {
        return value instanceof Date ? value.toISOString() : '[对象]'
      }
      const strValue = String(value)
      return strValue.length > 20 ? strValue.substring(0, 17) + '...' : strValue
    })
    table += row.join(' | ') + '\n'
  })

  return table
}

/**
 * 验证表名是否有效
 * @param {Context} ctx - Koishi上下文
 * @param {string} table - 要验证的表名
 * @returns {Promise<string|null>} 有效的表名或null（表不存在）
 */
export async function validateTable(ctx: Context, table: string): Promise<string | null> {
  try {
    const stats = await ctx.database.stats();
    const existingTables = Object.keys(stats.tables || {});
    return existingTables.includes(table) ? table :
           existingTables.find(t => t.toLowerCase() === table.toLowerCase()) || null;
  } catch (e) {
    logger.warn(`验证表名失败: ${e.message}`);
    return null;
  }
}

/**
 * 安全执行数据库操作的通用函数
 * @param {Context} ctx - Koishi上下文
 * @param {string} table - 表名
 * @param {Function} operation - 数据库操作函数
 * @param {string} errorPrefix - 错误消息前缀
 * @returns {Promise<T|string>} 操作结果或错误消息
 */
export async function safelyExecute<T>(
  ctx: Context,
  table: string,
  operation: (validTable: string) => Promise<T>,
  errorPrefix = '操作表'
): Promise<T | string> {
  if (!table) return '请指定要操作的表名';

  try {
    const validTable = await validateTable(ctx, table);
    if (!validTable) return `表 "${table}" 不存在或无法访问`;
    return await operation(validTable);
  } catch (e) {
    const message = `${errorPrefix} ${table}失败：${e.message}`;
    logger.warn(message);
    return message;
  }
}

/**
 * 获取表记录并计数
 * @param {Context} ctx - Koishi上下文
 * @param {string} table - 表名
 * @param {any} filter - 过滤条件
 * @returns {Promise<object>} 查询结果对象
 */
export async function getTableData(ctx: Context, table: string, filter: any = {}) {
  try {
    const validTable = await validateTable(ctx, table);
    if (!validTable) {
      return { success: false, error: `表 "${table}" 不存在或无法访问` };
    }

    const rows = await ctx.database.get(validTable as any, filter);
    return { success: true, rows, count: rows.length, table: validTable };
  } catch (e) {
    logger.warn(`查询表 ${table} 失败: ${e.message}`);
    return { success: false, error: e.message, count: 0, rows: [] };
  }
}

/**
 * 处理数据库概览命令
 * @param {Context} ctx - Koishi上下文
 * @param {any} options - 命令选项
 * @param {string} [pageArg] - 页码参数
 * @returns {Promise<string>} 处理结果消息
 */
export async function handleOverview(ctx: Context, options: any, pageArg?: string): Promise<string> {
  try {
    const stats = await ctx.database.stats();
    const tables = stats.tables || {};
    const tableCount = Object.keys(tables).length;

    if (tableCount === 0) return '数据库中没有表';

    const sortedTables = Object.entries(tables)
      .sort(([, a], [, b]) => (b as any).count - (a as any).count);
    const totalRecords = sortedTables.reduce((sum, [, info]: [string, any]) => sum + info.count, 0);

    const showAll = pageArg === 'all';
    const page = pageArg && !showAll ? parseInt(pageArg) : Math.max(1, options.page || 1);
    const pageSize = 15;
    const totalPages = Math.ceil(sortedTables.length / pageSize);
    const startIndex = (page - 1) * pageSize;
    const currentPageTables = showAll ? sortedTables : sortedTables.slice(startIndex, startIndex + pageSize);

    let result = `数据库（${tableCount}个表）概览：\n共 ${totalRecords} 条`;
    if (!showAll) {
      result += `（第${page}/${totalPages}页）`;
    }
    result += '\n';

    currentPageTables.forEach(([name, info]: [string, any]) => {
      result += `${name.padEnd(30)} ${info.count}条\n`;
    });

    return result;
  } catch (e) {
    const message = `获取数据库概览失败：${e.message}`;
    logger.warn(message);
    return message;
  }
}

/**
 * 处理查询表数据命令
 * @param {Context} ctx - Koishi上下文
 * @param {string} table - 表名
 * @param {any} options - 命令选项
 * @returns {Promise<string>} 查询结果消息
 */
export async function handleQuery(ctx: Context, table: string, options: any): Promise<string> {
  try {
    const filter = JSON.parse(options.filter || '{}');
    const page = Math.max(1, Math.min(10, options.page || 1));
    const pageSize = 5;

    const result = await getTableData(ctx, table, filter);

    if (!result.success) {
      return `查询表 ${table} 失败: ${result.error}`;
    }

    if (!result.rows?.length) {
      return `表 ${result.table} 中没有匹配的数据`;
    }

    const totalPages = Math.ceil(result.count / pageSize);
    const start = (page - 1) * pageSize;
    const currentPageData = result.rows.slice(start, start + pageSize);

    return `表 ${result.table} 查询结果：\n共 ${result.count} 条（第${page}/${totalPages || 1}页）\n` +
           formatAsTable(currentPageData);
  } catch (e) {
    const message = `查询表 ${table}失败：${e.message}`;
    logger.warn(message);
    return message;
  }
}

/**
 * 处理统计表数据命令
 * @param {Context} ctx - Koishi上下文
 * @param {string} table - 表名
 * @param {any} options - 命令选项
 * @returns {Promise<string>} 统计结果消息
 */
export async function handleCount(ctx: Context, table: string, options: any): Promise<string> {
  try {
    const filter = JSON.parse(options.filter || '{}');
    const result = await getTableData(ctx, table, filter);

    if (!result.success) {
      return `统计表 ${table} 失败: ${result.error}`;
    }

    return `表 ${result.table} 中${Object.keys(filter).length ? '共有符合条件的' : '共有'} ${result.count} 条数据`;
  } catch (e) {
    const message = `统计表 ${table}失败：${e.message}`;
    logger.warn(message);
    return message;
  }
}

/**
 * 处理删除数据命令
 * @param {Context} ctx - Koishi上下文
 * @param {string} table - 表名
 * @param {any} options - 命令选项
 * @returns {Promise<string>} 删除结果消息
 */
export async function handleDelete(ctx: Context, table: string, options: any): Promise<string> {
  try {
    const filter = JSON.parse(options.filter || '{}');
    const result = await getTableData(ctx, table, filter);

    if (!result.success) {
      return `删除表 ${table} 数据失败: ${result.error}`;
    }

    if (!result.rows?.length) {
      return `表 ${result.table} 中没有匹配的数据`;
    }

    await ctx.database.remove(result.table as any, filter);

    const isEmpty = Object.keys(filter).length === 0;
    return isEmpty
      ? `已清空表 ${result.table} 中 ${result.count} 条数据`
      : `已删除表 ${result.table} 中 ${result.count} 条数据`;
  } catch (e) {
    const message = `从表 ${table} 删除数据失败：${e.message}`;
    logger.warn(message);
    return message;
  }
}

/**
 * 处理更新数据命令
 * @param {Context} ctx - Koishi上下文
 * @param {string} table - 表名
 * @param {any} options - 命令选项
 * @returns {Promise<string>} 更新结果消息
 */
export async function handleUpdate(ctx: Context, table: string, options: any): Promise<string> {
  try {
    const mode = options.mode || 'set';
    const data = JSON.parse(options.data || '{}');

    const validTable = await validateTable(ctx, table);
    if (!validTable) {
      return `表 "${table}" 不存在或无法访问`;
    }

    let result, message;

    switch (mode) {
      case 'set':
        const query = JSON.parse(options.query || '{}');
        const before = await ctx.database.get(validTable as any, query);

        if (!before.length) {
          return `表 ${validTable} 中没有匹配的数据`;
        }

        result = await ctx.database.set(validTable as any, query, data);
        const after = await ctx.database.get(validTable as any, query);

        message = `已在表 ${validTable} 中更新 ${result.modified} 条数据\n` +
                  `前:${formatInspect(before[0], { depth: 2 })}\n` +
                  `后:${formatInspect(after[0], { depth: 2 })}`;
        break;

      case 'create':
        result = await ctx.database.create(validTable as any, data);
        message = `已在表 ${validTable} 中插入 1 条数据\n${formatInspect(result, { depth: 2 })}`;
        break;

      case 'upsert':
        if (!Array.isArray(data)) {
          return '数据必须是数组格式';
        }

        const keys = options.keys?.split(',').filter(Boolean) || [];
        result = await ctx.database.upsert(validTable as any, data, keys);
        message = `已在表 ${validTable} 中（插入${result.inserted}/匹配${result.matched}/修改${result.modified}）条数据`;
        break;

      default:
        return `不支持的操作模式: ${mode}`;
    }

    return message;
  } catch (e) {
    const message = `更新表 ${table}失败：${e.message}`;
    logger.warn(message);
    return message;
  }
}

/**
 * 处理删除表命令
 * @param {Context} ctx - Koishi上下文
 * @param {string} table - 表名
 * @param {any} options - 命令选项
 * @returns {Promise<string>} 删除结果消息
 */
export async function handleDrop(ctx: Context, table: string, options: any): Promise<string> {
  if (options.all) {
    try {
      const stats = await ctx.database.stats();
      const tables = stats.tables || {};
      const tableCount = Object.keys(tables).length;
      const recordCount = Object.values(tables).reduce((sum, table: any) => sum + table.count, 0);

      await ctx.database.dropAll();
      logger.warn(`已删除表 ${tableCount} 个，共 ${recordCount} 条记录`);

      return `已删除表 ${tableCount} 个，共 ${recordCount} 条记录`;
    } catch (e) {
      const message = `删除所有表失败：${e.message}`;
      logger.warn(message);
      return message;
    }
  }

  try {
    const validTable = await validateTable(ctx, table);
    if (!validTable) {
      return `表 "${table}" 不存在或无法访问`;
    }

    const result = await ctx.database.get(validTable as any, {});
    const count = result.length;

    await ctx.database.drop(validTable as any);
    logger.warn(`已删除表 ${validTable}，共 ${count} 条记录`);

    return `已删除表 ${validTable}，共 ${count} 条记录`;
  } catch (e) {
    const message = `删除表 ${table}失败：${e.message}`;
    logger.warn(message);
    return message;
  }
}
