import { $, Context } from 'koishi';
import { logger } from './index';
import { formatAsTable, formatInspect } from './utils';

/**
 * 数据库服务类
 * 负责注册和处理所有数据库相关命令
 */
export class DbService {
  private ctx: Context
  public Command: any

  /**
   * 创建数据库服务实例
   * @param ctx - Koishi上下文
   */
  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /**
   * 验证表名是否有效
   * @param table - 要验证的表名
   * @returns 有效的表名或null（表不存在）
   */
  private async validateTable(table: string): Promise<string | null> {
    try {
      const stats = await this.ctx.database.stats();
      const existingTables = Object.keys(stats.tables || {});
      return existingTables.find(t => t.toLowerCase() === table.toLowerCase()) || (existingTables.includes(table) ? table : null);
    } catch (e) {
      logger.warn(`验证表名失败: ${e.message}`);
      return null;
    }
  }

  /**
   * 初始化数据库命令
   * 注册所有数据库相关的子命令
   */
  initialize(): void {
    this.Command = this.ctx.command('db', '数据库工具', { authority: 4 })
      .usage('查询和管理数据库')

    // 数据库概览命令
    this.Command.subcommand('.list [page]', '列出数据库表')
      .usage('列出数据库所有表\n- db.list [页码] - 显示数据库概览\n- db.list all - 显示所有表')
      .action(async ({ }, pageArg) => {
        try {
          const stats = await this.ctx.database.stats();
          const tables = stats.tables || {};
          const tableCount = Object.keys(tables).length;

          if (tableCount === 0) return '数据库中没有表';

          const sortedTables = Object.entries(tables)
            .sort(([, a], [, b]) => (b as any).count - (a as any).count);
          const totalRecords = sortedTables.reduce((sum, [, info]: [string, any]) => sum + info.count, 0);

          const showAll = pageArg === 'all';
          const page = pageArg && !showAll ? parseInt(pageArg) : 1;
          const pageSize = 15;
          const totalPages = Math.ceil(sortedTables.length / pageSize);
          const startIndex = (page - 1) * pageSize;
          const currentPageTables = showAll ? sortedTables : sortedTables.slice(startIndex, startIndex + pageSize);

          let result = `数据库概览 (${tableCount}表/${totalRecords}条)`;
          if (!showAll) {
            result += ` - 第${page}/${totalPages}页`;
          }
          result += '\n';

          const nameWidth = Math.min(30, Math.max(...currentPageTables.map(([name]) => name.length)));

          currentPageTables.forEach(([name, info]: [string, any]) => {
            result += `${name.padEnd(nameWidth)} ${info.count}条\n`;
          });
          return result;
        } catch (e) {
          return `获取数据库概览失败: ${e.message}`;
        }
      });

    // 查询命令
    this.Command.subcommand('.query <table>', '查询表数据')
      .option('filter', '-f <filter:string> 过滤条件(JSON)')
      .option('page', '--page <page:number> 页码')
      .usage('以表格形式展示查询结果\n示例: db.query user -f {"platform":"discord"} --page 2')
      .action(async ({ options }, table) => {
        try {
          const filter = JSON.parse(options.filter || '{}');
          const page = Math.max(1, options.page || 1);
          const pageSize = 10;

          const validTable = await this.validateTable(table);
          if (!validTable) {
            return `查询失败: 表 "${table}" 不存在或无法访问`;
          }

          const model = this.ctx.model.tables[validTable];
          const keyToCount = Array.isArray(model.primary) ? model.primary[0] : model.primary || Object.keys(model.fields)[0];

          const totalCount = await this.ctx.database.eval(
              validTable as any,
              (row) => $.count(row[keyToCount]),
              filter
          );

          if (totalCount === 0) {
            return `表 ${validTable} 中没有匹配数据`;
          }

          const currentPageData = await this.ctx.database.get(validTable as any, filter, {
              limit: pageSize,
              offset: (page - 1) * pageSize,
          });

          const totalPages = Math.ceil(totalCount / pageSize);
          const filterDesc = Object.keys(filter).length > 0 ?
            `\n过滤条件: ${JSON.stringify(filter)}` : '';

          return `表 ${validTable} (${totalCount}条) - 第${page}/${totalPages || 1}页${filterDesc}\n` +
                 formatAsTable(currentPageData);
        } catch (e) {
          return `查询失败: ${e.message}`;
        }
      });

    // 统计记录命令
    this.Command.subcommand('.count <table>', '统计表记录数')
      .option('filter', '-f <filter:string> 过滤条件(JSON)')
      .usage('示例: db.count user -f {"authority":5}')
      .action(async ({ options }, table) => {
        try {
          const filter = JSON.parse(options.filter || '{}');

          const validTable = await this.validateTable(table);
          if (!validTable) {
              return `统计失败: 表 "${table}" 不存在或无法访问`;
          }

          const model = this.ctx.model.tables[validTable];
          const keyToCount = Array.isArray(model.primary) ? model.primary[0] : model.primary || Object.keys(model.fields)[0];

          const count = await this.ctx.database.eval(
              validTable as any,
              (row) => $.count(row[keyToCount]),
              filter
          );

          const filterDesc = Object.keys(filter).length > 0 ?
            `（条件: ${JSON.stringify(filter)}）` : '';

          return `表 ${validTable} 共有 ${count} 条数据${filterDesc}`;
        } catch (e) {
          return `统计失败: ${e.message}`;
        }
      });

    // 更新数据命令
    this.Command.subcommand('.update <table>', '更新表数据')
      .option('mode', '-m <mode:string> 模式(set/create/upsert)', { fallback: 'set' })
      .option('query', '-q <query:string> 查询条件(JSON,set模式)')
      .option('keys', '-k <keys:string> 索引字段(upsert模式,逗号分隔)')
      .option('data', '-d <data:string> 数据(JSON)', { required: true })
      .usage('示例:\ndb.update user -m set -q {"id":123} -d {"authority":4}\ndb.update user -m create -d {"name":"New"}')
      .action(async ({ options }, table) => {
        try {
          const mode = options.mode || 'set';
          const data = JSON.parse(options.data || '{}');

          const validTable = await this.validateTable(table);
          if (!validTable) return `更新失败: 表 "${table}" 不存在`;

          let result, message;

          switch (mode) {
            case 'set':
              const query = JSON.parse(options.query || '{}');
              const before = await this.ctx.database.get(validTable as any, query);
              if (!before.length) return `更新失败: 表 ${validTable} 中没有匹配数据`;
              result = await this.ctx.database.set(validTable as any, query, data);
              const after = await this.ctx.database.get(validTable as any, query);
              message = `已更新 ${result.modified} 条数据\n更新前:\n${formatInspect(before[0], { depth: 2 })}\n更新后:\n${formatInspect(after[0], { depth: 2 })}`;
              break;
            case 'create':
              result = await this.ctx.database.create(validTable as any, data);
              message = `已插入 1 条数据\n${formatInspect(result, { depth: 2 })}`;
              break;
            case 'upsert':
              if (!Array.isArray(data)) return '更新失败: 数据必须是数组格式';
              const keys = options.keys?.split(',').filter(Boolean) || [];
              result = await this.ctx.database.upsert(validTable as any, data, keys);
              message = `已处理 ${data.length} 条数据\n- 新增: ${result.inserted}条\n- 匹配: ${result.matched}条\n- 修改: ${result.modified}条`;
              break;
            default:
              return `更新失败: 不支持的模式 "${mode}"`;
          }
          return message;
        } catch (e) {
          return `更新失败: ${e.message}`;
        }
      });

    // 删除数据命令
    this.Command.subcommand('.delete <table>', '删除表数据')
      .option('filter', '-f <filter:string> 过滤条件(JSON)')
      .usage('示例: db.delete message -f {"time":{"$lt":1600000000}}')
      .action(async ({ options }, table) => {
        try {
          const filter = JSON.parse(options.filter || '{}');

          const validTable = await this.validateTable(table);
          if (!validTable) return `删除失败: 表 "${table}" 不存在或无法访问`;

          const model = this.ctx.model.tables[validTable];
          const keyToCount = Array.isArray(model.primary) ? model.primary[0] : model.primary || Object.keys(model.fields)[0];

          const count = await this.ctx.database.eval(
              validTable as any,
              (row) => $.count(row[keyToCount]),
              filter
          );

          if (count === 0) {
            return `表 ${validTable} 中没有匹配数据`;
          }

          await this.ctx.database.remove(validTable as any, filter);

          const isEmpty = Object.keys(filter).length === 0;
          return isEmpty
            ? `已清空表 ${validTable} (${count}条)`
            : `已删除表 ${validTable} 中符合条件的 ${count} 条数据`;
        } catch (e) {
          return `删除失败: ${e.message}`;
        }
      });

    // 删除表命令
    this.Command.subcommand('.drop [table]', '删除表', { authority: 5 })
      .option('all', '-a 删除所有表')
      .usage('示例: db.drop temp_table')
      .action(async ({ options }, table) => {
        if (options.all) {
          try {
            const stats = await this.ctx.database.stats();
            const tables = stats.tables || {};
            const tableCount = Object.keys(tables).length;
            const recordCount = Object.values(tables).reduce((sum, table: any) => sum + table.count, 0);
            await this.ctx.database.dropAll();
            return `已删除所有表 (${tableCount}表/${recordCount}条)`;
          } catch (e) {
            return `删除失败: ${e.message}`;
          }
        }

        try {
          const validTable = await this.validateTable(table);
          if (!validTable) return `表 "${table}" 不存在，无需删除`;

          const model = this.ctx.model.tables[validTable];
          const keyToCount = Array.isArray(model.primary) ? model.primary[0] : model.primary || Object.keys(model.fields)[0];

          const count = await this.ctx.database.eval(validTable as any, (row) => $.count(row[keyToCount]));

          await this.ctx.database.drop(validTable as any);
          return `已删除表 ${validTable} (${count}条)`;
        } catch (e) {
          return `删除失败: ${e.message}`;
        }
      });
  }
}
