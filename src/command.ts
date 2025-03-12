import { Context } from 'koishi';
import * as dbHandler from './handler';

/**
 * 数据库命令服务
 * 负责注册和路由所有数据库操作命令
 */
export class DbService {
  /**
   * Koishi上下文
   * @private
   * @type {Context}
   */
  private ctx: Context

  /**
   * 数据库命令根对象
   * @public
   * @type {any}
   */
  public Command: any

  /**
   * 构造函数
   * @param {Context} ctx - Koishi上下文
   */
  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /**
   * 初始化数据库命令
   * 注册所有数据库相关的子命令
   */
  initialize(): void {
    this.Command = this.ctx.command('db [page]', '数据库操作工具', { authority: 4 })
      .usage('数据库查询和管理命令\n用法: db [页码] - 显示指定页码的数据\ndb all - 显示所有数据')
      .action(async ({ options }, page) => {
        return await dbHandler.handleOverview(this.ctx, options, page);
      });
    // 查询
    this.Command.subcommand('.query <table>', '从表中查询数据')
      .option('filter', '-f <filter:string> 过滤条件(JSON格式)')
      .option('page', '--page <page:number> 页码')
      .usage('查询表中数据并以表格形式展示')
      .example('db.query user -f {"platform":"discord"} --page 2')
      .action(async ({ options }, table) => {
        return await dbHandler.handleQuery(this.ctx, table, options);
      });
    // 统计记录
    this.Command.subcommand('.count <table>', '从表中获取记录数量')
      .option('filter', '-f <filter:string> 过滤条件(JSON格式)')
      .usage('统计表中数据总数或符合条件的数据数量')
      .example('db.count user - 统计所有用户数\ndb.count user -f {"authority":5} - 统计管理员数量')
      .action(async ({ options }, table) => {
        return await dbHandler.handleCount(this.ctx, table, options);
      });
    // 更新数据
    this.Command.subcommand('.update <table>', '从表中更新数据')
      .option('mode', '-m <mode:string> 操作模式(set/create/upsert)', { fallback: 'set' })
      .option('query', '-q <query:string> 查询条件(set模式,JSON格式)')
      .option('keys', '-k <keys:string> 索引字段(upsert模式,逗号分隔)')
      .option('data', '-d <data:string> 数据(JSON格式)', { required: true })
      .usage('更新、创建或插入数据\n- set: 更新已有数据\n- create: 创建新数据\n- upsert: 更新或插入多条数据')
      .example('db.update user -m set -q {"id":10086} -d {"authority":4}\ndb.update user -m create -d {"name":"New","authority":1}')
      .action(async ({ options }, table) => {
        return await dbHandler.handleUpdate(this.ctx, table, options);
      });
    // 删除数据
    this.Command.subcommand('.delete <table>', '从表中删除数据')
      .option('filter', '-f <filter:string> 过滤条件(JSON格式)')
      .usage('删除表中符合条件的数据，空过滤器将清空表')
      .example('db.delete temp_data - 清空临时表\ndb.delete message -f {"time":{"$lt":1600000000}} - 删除旧消息')
      .action(async ({ options }, table) => {
        return await dbHandler.handleDelete(this.ctx, table, options);
      });
    // 删除表
    this.Command.subcommand('.drop [table]', '从数据库中删除表', { authority: 5 })
      .option('all', '-a 删除所有表')
      .usage('永久删除表及其数据')
      .example('db.drop temp_table - 删除单个表\ndb.drop all -a - 删除所有表')
      .action(async ({ options }, table) => {
        return await dbHandler.handleDrop(this.ctx, table, options);
      });
        }
}
