import { Context } from 'koishi'
import {} from "koishi-plugin-adapter-onebot";
import { utils } from './utils'

interface OneBotUserInfo {
  // 基础信息
  uid?: string                // 用户唯一标识
  uin?: string | number       // QQ号码
  nick?: string               // 昵称
  user_id: number             // 用户ID (与uin基本一致)
  nickname?: string           // 昵称 (与nick基本一致)
  qid?: string                // QQ靓号/ID
  remark?: string             // 备注
  longNick?: string           // 个性签名
  long_nick?: string          // 个性签名 (标准格式)
  // 个人信息
  constellation?: number      // 星座 (1-12)
  shengXiao?: number          // 生肖 (1-12)
  birthday_year?: number      // 出生年
  birthday_month?: number     // 出生月
  birthday_day?: number       // 出生日
  age?: number                // 年龄
  sex?: string               // 性别
  kBloodType?: number         // 血型
  homeTown?: string           // 家乡 (格式: 省-市-区)
  country?: string            // 国家
  province?: string           // 省份
  city?: string               // 城市
  pos?: string                // 职位
  college?: string            // 学校/院校
  eMail?: string              // 电子邮件
  email?: string              // 电子邮件 (标准格式)
  phoneNum?: string           // 电话号码
  phone_num?: string          // 电话号码 (标准格式)
  // 账号信息
  regTime?: number            // 注册时间戳
  reg_time?: number           // 注册时间戳 (标准格式)
  qqLevel?: number            // QQ等级
  level?: number              // 等级
  login_days?: number         // 登录天数
  is_vip?: boolean            // 是否为VIP
  is_years_vip?: boolean      // 是否为年费VIP
  vip_level?: number          // VIP等级
  status?: number             // 状态 (10=离线/20=在线/30=离开/...)
  extStatus?: number          // 扩展状态
  batteryStatus?: number      // 电池状态
  termType?: number           // 终端类型 (0=未知/1=电脑/2=手机/...)
  netType?: number            // 网络类型 (0=未知/1=WiFi/2=流量/...)
  eNetworkType?: number       // 网络类型扩展
  termDesc?: string           // 终端描述
}

interface OneBotGroupInfo {
  group_id: number           // 群号
  group_name: string         // 群名称
  group_remark: string       // 群备注
  member_count: number       // 当前成员数量
  max_member_count: number   // 最大成员数量
}

interface OneBotGroupMemberInfo {
  group_id: number           // 群号
  user_id: number            // 用户ID
  nickname: string           // 昵称
  card: string               // 群名片/备注
  sex: string               // 性别
  age: number                // 年龄
  area: string               // 地区
  level: string              // 成员等级
  qq_level: number           // QQ等级
  join_time: number          // 加群时间戳
  last_sent_time: number     // 最后发言时间戳
  title_expire_time: number  // 专属头衔过期时间戳
  unfriendly: boolean        // 是否不良记录成员
  card_changeable: boolean   // 是否允许修改群名片
  is_robot: boolean          // 是否机器人
  shut_up_timestamp: number  // 禁言到期时间戳
  role: string               // 角色 (owner/admin/member)
  title: string              // 专属头衔
}

export class Admin {
  constructor(private ctx: Context) {}

  /**
   * 注册命令
   */
  registerCommands() {
    const admin = this.ctx.command('onebot', 'OneBot 测试工具')

    admin.subcommand('.restart', '重启 OneBot', { authority: 5 })
      .usage('重启 OneBot 实现和 API 服务')
      .action(async ({ session }) => {
        try {
          await session.onebot.setRestart(2000)
          return '正在重启 OneBot，请稍候...'
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    admin.subcommand('.clean', '清理缓存', { authority: 4 })
      .usage('清理积攒的缓存文件')
      .action(async ({ session }) => {
        try {
          await session.onebot.cleanCache()
          return '清理缓存成功'
        } catch (e) {
          return utils.handleError(session, e)
        }
      })

    const get = admin.subcommand('get', '获取消息内容及状态')
      .usage('获取指定ID消息的完整内容')
      .option('id', '-i <id:string> 消息ID')
      .action(async ({ session, options }) => {
        let messageId = options.id
        if (!messageId && session.quote) {
          messageId = session.quote.id
        } else if (!messageId && session.messageId) {
          messageId = session.messageId
        }
        try {
          const msg = await session.onebot.getMsg(messageId)
          return JSON.stringify(msg, null, 2)
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    get.subcommand('.forward', '获取合并转发内容')
      .usage('获取指定合并转发ID消息的完整内容')
      .option('id', '-i <id:string> 合并转发ID')
      .action(async ({ session, options }) => {
        let messageId = options.id
        if (!messageId && session.quote) {
          messageId = session.quote.id
        } else if (!messageId && session.messageId) {
          messageId = session.messageId
        }
        try {
          const msg = await session.onebot.getForwardMsg(messageId)
          return JSON.stringify(msg, null, 2)
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    get.subcommand('.record', '获取语音文件')
      .usage('获取指定语音文件并转换格式')
      .option('file', '-f <file:string> 文件名', { type: 'string' })
      .option('format', '-t <format:string> 转换格式 (mp3/amr/wma/m4a/spx/ogg/wav/flac)', { fallback: 'mp3' })
      .action(async ({ session, options }) => {
        let fileName = options.file
        if (!fileName && session.quote) {
          try {
            fileName = utils.extractAudioFile(session.quote.content)
          } catch (e) {
            return utils.handleError(session, new Error(`解析引用消息失败: ${e.message}`))
          }
        }
        if (!fileName) {
          const msg = await session.send('未发现语音文件')
          utils.autoRecall(session, Array.isArray(msg) ? msg[0] : msg)
          return
        }
        try {
          const result = await session.onebot.getRecord(fileName, options.format as 'mp3' | 'amr' | 'wma' | 'm4a' | 'spx' | 'ogg' | 'wav' | 'flac')
          return `语音文件路径: ${result.file}`
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    get.subcommand('.image', '获取图片文件')
      .usage('获取指定图片文件的本地路径')
      .option('file', '-f <file:string> 文件名', { type: 'string' })
      .action(async ({ session, options }) => {
        let fileName = options.file
        if (!fileName && session.quote) {
          try {
            fileName = utils.extractImageFile(session.quote.content)
          } catch (e) {
            return utils.handleError(session, new Error(`解析引用消息失败: ${e.message}`))
          }
        }
        if (!fileName) {
          const msg = await session.send('未发现图片文件')
          utils.autoRecall(session, Array.isArray(msg) ? msg[0] : msg)
          return
        }
        try {
          const result = await session.onebot.getImage(fileName)
          return `图片文件路径: ${result.file}`
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    get.subcommand('.stat', '获取运行状态')
      .usage('获取运行状态信息')
      .action(async ({ session }) => {
        try {
          const status = await session.onebot.getStatus()
          let result = `运行状态: ${status.online ? '在线' : '离线'} | ${status.good ? '正常' : '异常'}\n`
          for (const key in status) {
            if (key !== 'online' && key !== 'good') {
              result += `${key}: ${JSON.stringify(status[key])}\n`
            }
          }
          return result
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    get.subcommand('.ver', '获取版本信息')
      .usage('获取版本信息')
      .action(async ({ session }) => {
        try {
          const version = await session.onebot.getVersionInfo()
          let result = `应用标识: ${version.app_name}\n`
          result += `应用版本: ${version.app_version}\n`
          result += `协议版本: ${version.protocol_version}\n`
          for (const key in version) {
            if (key !== 'app_name' && key !== 'app_version' && key !== 'protocol_version') {
              result += `${key}: ${JSON.stringify(version[key])}\n`
            }
          }
          return result
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    get.subcommand('.csrf [domain:string]', '获取相关接口凭证', { authority: 4 })
      .usage('获取指定域名的Cookies和CSRF Token')
      .action(async ({ session }, domain) => {
        try {
          const credentials = await session.onebot.getCredentials(domain || '')
          let result = '接口凭证信息:\n'
          result += `CSRF Token: ${credentials.csrf_token}\n`
          result += `Cookies: ${credentials.cookies}`
          return result
        } catch (e) {
          return utils.handleError(session, e)
        }
      })

    const info = admin.subcommand('info', '查询账号信息')
      .usage('查询当前账号的基本信息')
      .action(async ({ session }) => {
        try {
          const info = await session.onebot.getLoginInfo()
          return `账号信息:\n${info.nickname}(${info.user_id})`
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    info.subcommand('.user <user_id:number>', '查询其它账号信息')
      .usage('查询指定账号的基本信息')
      .option('no-cache', '-n 不使用缓存', { fallback: false })
      .action(async ({ session, options }, user_id) => {
        if (!user_id) {
          const msg = await session.send('请提供QQ')
          utils.autoRecall(session, Array.isArray(msg) ? msg[0] : msg)
          return
        }
        try {
          const info = await session.onebot.getStrangerInfo(user_id, options['no-cache']) as OneBotUserInfo
          return utils.formatUserInfo(info)
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    info.subcommand('.friend', '获取本账号好友列表', { authority: 3 })
      .usage('获取本账号的完整好友列表及备注')
      .action(async ({ session }) => {
        try {
          const friends = await session.onebot.getFriendList() as OneBotUserInfo[]
          let result = `好友数量: ${friends.length}\n`
          friends.slice(0, 10).forEach((friend) => {
            result += utils.formatFriendInfo(friend)
          })
          return result
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    info.subcommand('.group', '获取本账号群组列表', { authority: 3 })
      .usage('获取本账号加入的群组列表')
      .action(async ({ session }) => {
        try {
          const groups = await session.onebot.getGroupList() as OneBotGroupInfo[]
          let result = `群数量: ${groups.length}\n`
          groups.slice(0, 20).forEach((group) => {
            result += utils.formatGroupInfo(group) + '\n'
          })
          return result
        } catch (e) {
          return utils.handleError(session, e)
        }
      })

    const group = admin.subcommand('group [group_id:number]', '查询群信息')
      .usage('查询指定群的基本信息')
      .option('no-cache', '-n 不使用缓存', { fallback: false })
      .action(async ({ session, options }, group_id) => {
        if (!group_id) {
          if (!session.guildId) {
            const msg = await session.send('请提供群号')
            utils.autoRecall(session, Array.isArray(msg) ? msg[0] : msg)
            return
          }
          group_id = parseInt(session.guildId)
        }
        try {
          const info = await session.onebot.getGroupInfo(group_id, options['no-cache']) as OneBotGroupInfo
          return utils.formatGroupInfo(info)
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    group.subcommand('.user <user_id:number> [group_id:number]', '查询群成员信息')
      .usage('查询群内指定成员的基本信息')
      .option('no-cache', '-n 不使用缓存', { fallback: false })
      .action(async ({ session, options }, user_id, group_id) => {
        if (!user_id) {
          const msg = await session.send('请提供QQ号')
          utils.autoRecall(session, Array.isArray(msg) ? msg[0] : msg)
          return
        }
        if (!group_id) {
          if (!session.guildId) {
            const msg = await session.send('请提供群号')
            utils.autoRecall(session, Array.isArray(msg) ? msg[0] : msg)
            return
          }
          group_id = parseInt(session.guildId)
        }
        try {
          const info = await session.onebot.getGroupMemberInfo(group_id, user_id, options['no-cache']) as unknown as OneBotGroupMemberInfo
          return utils.formatGroupMemberInfo(info)
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    group.subcommand('.list [group_id:number]', '获取群成员列表')
      .usage('获取指定群的成员列表')
      .action(async ({ session }, group_id) => {
        if (!group_id) {
          if (!session.guildId) {
            const msg = await session.send('请提供群号')
            utils.autoRecall(session, Array.isArray(msg) ? msg[0] : msg)
            return
          }
          group_id = parseInt(session.guildId)
        }
        try {
          const members = await session.onebot.getGroupMemberList(group_id) as unknown as OneBotGroupMemberInfo[]
          let result = `群 ${group_id} 成员列表：\n`
          // 按角色排序
          members.sort((a, b) => {
            const roleOrder = { owner: 0, admin: 1, member: 2 }
            return roleOrder[a.role] - roleOrder[b.role]
          })
          members.slice(0, 20).forEach((member) => {
            result += utils.formatGroupMemberInfo(member) + '\n'
          })
          return result
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
    group.subcommand('.honor [group_id:number]', '查询群荣誉信息')
      .usage('可用参数:\n- talkative: 龙王\n- performer: 群聊之火\n- legend: 群聊炽焰\n- strong_newbie: 冒尖小春笋\n- emotion: 快乐之源')
      .option('type', '-t <type> 荣誉类型', { fallback: 'all' })
      .action(async ({ session, options }, group_id) => {
        if (!group_id) {
          if (!session.guildId) {
            const msg = await session.send('请提供群号')
            utils.autoRecall(session, Array.isArray(msg) ? msg[0] : msg)
            return
          }
          group_id = parseInt(session.guildId)
        }
        try {
          const honorInfo = await session.onebot.getGroupHonorInfo(group_id, options.type)
          const groupInfo = await session.onebot.getGroupInfo(group_id)
          let result = `${groupInfo.group_name}(${group_id}) 荣誉信息:\n`

          const honorTypeNames = {
            talkative: '龙王',
            performer: '群聊之火',
            legend: '群聊炽焰',
            strong_newbie: '冒尖小春笋',
            emotion: '快乐之源'
          }
          if (honorInfo.current_talkative) {
            result += `当前龙王: ${honorInfo.current_talkative.nickname}(${honorInfo.current_talkative.user_id})\n`
          }
          for (const type of ['talkative', 'performer', 'legend', 'strong_newbie', 'emotion']) {
            const list = honorInfo[`${type}_list`]
            if (list && list.length) {
              result += `${honorTypeNames[type]} (${list.length}名):\n`
              list.slice(0, 5).forEach((item) => {
                result += `${item.nickname}(${item.user_id}) | ${item.description}\n`
              })
            }
          }
          return result
        } catch (e) {
          return utils.handleError(session, e)
        }
      })
  }
}
