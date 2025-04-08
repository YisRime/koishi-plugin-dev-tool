import { Session, h } from 'koishi';
import { inspect } from 'util';

const sexMap = {
  'male': '男',
  'female': '女'
};

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
  },

  /**
   * 统一错误处理
   */
  async handleError(session: Session, e: Error): Promise<string> {
    const msg = await session.send(`操作失败: ${e.message}`)
    this.autoRecall(session, Array.isArray(msg) ? msg[0] : msg)
    return null
  },

  /**
   * 处理分页逻辑
   * @param session 当前会话
   * @param data 需要分页的数据数组
   * @param page 页码参数，可以是数字或"all"
   * @param pageSize 每页显示的项目数量，默认为10
   * @returns 处理后的数据和分页信息对象，如果出错则返回null
   */
  handlePagination<T>(session: Session, data: T[], page: string, pageSize: number = 10): {
    displayData: T[],
    pageInfo: string,
    totalPages: number
  } | null {
    try {
      if (page === 'all') {
        return {
          displayData: data,
          pageInfo: `：\n`,
          totalPages: 1
        };
      }
      const totalPages = Math.ceil(data.length / pageSize);
      const pageNum = page ? parseInt(page) : 1;
      // 页码有效性检查
      if (isNaN(pageNum) || pageNum < 1 || (pageNum - 1) * pageSize >= data.length) {
        this.handleError(session, new Error(`无效页码`));
        return null;
      }
      const start = (pageNum - 1) * pageSize;
      const end = pageNum * pageSize;
      return {
        displayData: data.slice(start, end),
        pageInfo: `（第 ${pageNum}/${totalPages} 页）：\n`,
        totalPages: totalPages
      };
    } catch (e) {
      this.handleError(session, e);
      return null;
    }
  },

  /**
   * 格式化用户信息
   */
  formatUserInfo(info: any): string {
    // 用户基本信息
    let result = `${info.nickname || info.nick}(${info.user_id || info.uin})\n`
    if (info.qid) result += `QID: ${info.qid}\n`
    if (info.uid) result += `UID: ${info.uid}\n`
    const signature = info.long_nick || info.longNick
    if (signature) result += `个性签名: \n${signature}\n`
    result += '\n个人信息: \n'
    // 基本个人信息
    const personalInfo = []
    if (info.sex && info.sex !== 'unknown') {
      const displaysex = sexMap[info.sex] || info.sex
      personalInfo.push(`${displaysex}`)
    }
    if (info.age) personalInfo.push(`${info.age}岁`)
    if (info.birthday_year && info.birthday_month && info.birthday_day) {
      personalInfo.push(`${info.birthday_year}-${info.birthday_month}-${info.birthday_day}`)
    }
    if (personalInfo.length > 0) {
      result += `${personalInfo.join(' | ')}\n`
    }
    // 生肖、星座和血型信息
    const zodiacInfo = []
    const shengXiaos = ['', '鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']
    if (info.shengXiao && info.shengXiao > 0 && info.shengXiao <= 12) {
      zodiacInfo.push(`${shengXiaos[info.shengXiao]}`)
    }
    const constellations = ['', '水瓶座', '双鱼座', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座']
    if (info.constellation && info.constellation > 0 && info.constellation <= 12) {
      zodiacInfo.push(`${constellations[info.constellation]}`)
    }
    const bloodTypes = ['', 'A型', 'B型', 'AB型', 'O型']
    if (info.kBloodType && info.kBloodType > 0 && info.kBloodType < bloodTypes.length) {
      zodiacInfo.push(`${bloodTypes[info.kBloodType]}`)
    }
    if (zodiacInfo.length > 0) {
      result += `${zodiacInfo.join(' | ')}\n`
    }
    // 联系信息
    const contactInfo = []
    if (info.phoneNum && info.phoneNum !== '-') contactInfo.push(`${info.phoneNum}`)
    if (info.eMail && info.eMail !== '') contactInfo.push(`${info.eMail}`)
    if (contactInfo.length > 0) {
      result += `${contactInfo.join(' | ')}\n`
    }
    // 位置信息
    let locationLine = ''
    // 地区信息
    if (info.country || info.province || info.city) {
      const locationItems = []
      if (info.country) locationItems.push(info.country)
      if (info.province) locationItems.push(info.province)
      if (info.city) locationItems.push(info.city)
      if (locationItems.length > 0) {
        locationLine += `${locationItems.join(' ')}`
      }
    }
    // 家乡信息
    if (info.homeTown && info.homeTown !== '0-0-0') {
      const [province, city] = info.homeTown.split('-').map(id => parseInt(id))
      if (province > 0 || city > 0) {
        if (locationLine) locationLine += ' | '
        locationLine += `家乡: ${province}-${city}`
      }
    }
    if (locationLine) {
      result += `${locationLine}\n`
    }
    // 学校和职位信息
    const educationInfo = []
    if (info.college) educationInfo.push(`${info.college}`)
    if (info.pos) educationInfo.push(`${info.pos}`)
    if (educationInfo.length > 0) {
      result += `${educationInfo.join(' | ')}\n`
    }
    // 账号和状态信息
    result += '\n账号信息: \n'
    const accountInfo = []
    if (info.is_vip || info.vip_level) {
      let vipStr = info.is_years_vip ? `年VIP${info.vip_level || ''}` : `VIP${info.vip_level || ''}`
      accountInfo.push(vipStr)
    }
    if (info.qqLevel) accountInfo.push(`Lv:${info.qqLevel}`)
    // 状态信息
    if (info.status !== undefined) {
      const statusMap = {
        10: '离线',
        20: '在线',
        30: '离开',
        40: '忙碌',
        50: '请勿打扰',
        60: '隐身'
      }
      if (statusMap[info.status]) {
        accountInfo.push(`${statusMap[info.status]}`)
        // 电池信息
        if (info.batteryStatus && info.batteryStatus >= 0 && info.batteryStatus <= 100) {
          accountInfo.push(`电量${info.batteryStatus}%`)
        }
        // 设备信息
        const termTypes = ['', '电脑', '手机', '网页', '平板']
        if (info.termType && info.termType > 0 && info.termType < termTypes.length) {
          let deviceStr = termTypes[info.termType]
          if (info.termDesc && info.termDesc.trim()) {
            deviceStr += `(${info.termDesc})`
          }
          accountInfo.push(deviceStr)
        }
        // 网络信息
        const netTypes = ['', 'WiFi', '移动网络', '有线网络']
        const eNetworkTypes = {
          1: '2G网络',
          2: '3G网络',
          3: '4G网络',
          4: '5G网络',
          5: 'WiFi'
        }
        const networkInfo = []
        if (info.netType && info.netType > 0 && info.netType < netTypes.length) {
          networkInfo.push(netTypes[info.netType])
        }
        if (info.eNetworkType && eNetworkTypes[info.eNetworkType]) {
          networkInfo.push(eNetworkTypes[info.eNetworkType])
        }
        if (networkInfo.length > 0) {
          accountInfo.push(networkInfo.join('-'))
        }
      }
    }
    // 显示账号信息
    if (accountInfo.length > 0) {
      result += `${accountInfo.join(' | ')}\n`
    }
    // 注册时间和登录天数
    if (info.regTime || info.reg_time) {
      const regTimestamp = info.regTime || info.reg_time
      const regDate = new Date(regTimestamp * 1000)
      let regInfo = `注册于: ${regDate.toLocaleDateString()}`
      if (info.login_days) {
        regInfo += ` (登录${info.login_days}天)`
      }
      result += `${regInfo}\n`
    }
    return result
  },

  /**
   * 格式化好友信息
   */
  formatFriendInfo(friend: any): string {
    let result = `${friend.nickname}(${friend.user_id})`
    if (friend.level) result += ` | LV:${friend.level}`
    result += '\n'

    const personalInfo = []
    if (friend.remark && friend.remark.trim()) personalInfo.push(`${friend.remark}`)
    if (friend.sex && friend.sex !== 'unknown') {
      const displaysex = sexMap[friend.sex] || friend.sex
      personalInfo.push(`${displaysex}`)
    }
    if (friend.age && friend.age > 0) personalInfo.push(`${friend.age}岁`)

    const hasBirthday = (friend.birthday_year && friend.birthday_year > 0) ||
                       (friend.birthday_month && friend.birthday_month > 0) ||
                       (friend.birthday_day && friend.birthday_day > 0)
    if (hasBirthday) {
      const year = friend.birthday_year && friend.birthday_year > 0 ? friend.birthday_year : '?'
      const month = friend.birthday_month && friend.birthday_month > 0 ? friend.birthday_month : '?'
      const day = friend.birthday_day && friend.birthday_day > 0 ? friend.birthday_day : '?'
      personalInfo.push(`${year}-${month}-${day}`)
    }

    if (personalInfo.length > 0) {
      result += `- ${personalInfo.join(' | ')}\n`
    }

    const contactInfo = []
    if (friend.phone_num && friend.phone_num.trim() && friend.phone_num !== '-') {
      contactInfo.push(`${friend.phone_num}`)
    }
    if (friend.email && friend.email.trim()) contactInfo.push(`${friend.email}`)
    if (contactInfo.length > 0) {
      result += `- ${contactInfo.join(' | ')}\n`
    }

    return result
  },

  /**
   * 格式化群信息
   */
  formatGroupInfo(info: any): string {
    let result = `${info.group_name}(${info.group_id}) [${info.member_count}/${info.max_member_count}]`
    if (info.group_remark && info.group_remark.trim()) {
      result += `\n备注: ${info.group_remark}`
    }
    return result
  },

  /**
   * 格式化群成员信息
   */
  formatGroupMemberInfo(member: any): string {
    const roleMap = {
      'owner': '群主',
      'admin': '管理员',
      'member': '成员'
    }

    let result = `成员 `

    // 显示群名片和昵称
    if (member.card && member.card.trim()) {
      result += `[${member.card}]`
    }
    result += `${member.nickname}(${member.user_id}) 信息:\n`

    // 身份信息
    let identityInfo = []
    if (member.level && member.level !== '0') {
      identityInfo.push(`LV${member.level}`)
    }
    if (member.title && member.title.trim()) {
      identityInfo.push(`${member.title}`)
    }
    if (member.card && member.card.trim()) {
      identityInfo.push(`${member.card}`)
    }
    if (member.role !== 'member') {
      identityInfo.push(roleMap[member.role] || member.role)
    }
    if (member.is_robot) {
      identityInfo.push('Bot')
    }
    if (identityInfo.length > 0) {
      result += `- ${identityInfo.join(' | ')}\n`
    }

    // 基本信息
    let personalInfo = []
    if (member.qq_level > 0) {
      personalInfo.push(`LV${member.qq_level}`)
    }
    if (member.sex && member.sex !== 'unknown') {
      const displaysex = sexMap[member.sex] || member.sex
      personalInfo.push(`${displaysex}`)
    }
    if (member.age > 0) {
      personalInfo.push(`${member.age}岁`)
    }
    if (member.area && member.area.trim()) {
      personalInfo.push(`${member.area}`)
    }
    if (personalInfo.length > 0) {
      result += `- ${personalInfo.join(' | ')}\n`
    }

    // 时间信息
    if (member.shut_up_timestamp && member.shut_up_timestamp > Math.floor(Date.now() / 1000)) {
      const shutUpEnd = new Date(member.shut_up_timestamp * 1000)
      result += `- 禁言至: ${shutUpEnd.toLocaleDateString()} ${shutUpEnd.toLocaleTimeString()}\n`
    }
    if (member.join_time) {
      const joinDate = new Date(member.join_time * 1000)
      result += `- 入群时间: ${joinDate.toLocaleDateString()} ${joinDate.toLocaleTimeString()}\n`
    }
    if (member.last_sent_time) {
      const lastSentDate = new Date(member.last_sent_time * 1000)
      result += `- 最后发言: ${lastSentDate.toLocaleDateString()} ${lastSentDate.toLocaleTimeString()}`
    }

    return result
  },

  /**
   * 从引用消息中提取语音文件
   */
  extractAudioFile(content: string): string {
    if (!content) return null
    // 尝试从XML格式解析
    const xmlMatch = /<audio.*?file="(.*?)".*?\/>/i.exec(content)
    if (xmlMatch && xmlMatch[1]) {
      return xmlMatch[1]
    }
    // 尝试从CQ码解析
    const cqMatch = /\[CQ:record,file=(.*?)(?:,|])/i.exec(content)
    if (cqMatch && cqMatch[1]) {
      return cqMatch[1]
    }
    // 尝试从JSON格式解析
    const jsonMatch = /"file"\s*:\s*"([^"]+)"/i.exec(content)
    if (jsonMatch && jsonMatch[1]) {
      return jsonMatch[1]
    }
    return null;
  },

  /**
   * 从引用消息中提取文件ID
   */
  extractFileId(content: string): string {
    if (!content) return null
    // 尝试从XML格式解析
    const xmlMatch = /<file.*?id="(.*?)".*?\/>/i.exec(content)
    if (xmlMatch && xmlMatch[1]) {
      return xmlMatch[1]
    }
    // 尝试从CQ码解析
    const cqMatch = /\[CQ:file,file=(?:.*?),id=(.*?)(?:,|])/i.exec(content)
    if (cqMatch && cqMatch[1]) {
      return cqMatch[1]
    }
    // 尝试从JSON格式解析
    const jsonMatch = /"file_id"\s*:\s*"([^"]+)"/i.exec(content)
    if (jsonMatch && jsonMatch[1]) {
      return jsonMatch[1]
    }
    return null;
  },

  /**
   * 从引用消息中提取图片文件
   */
  extractImageFile(content: string): string {
    if (!content) return null
    // 尝试从XML格式解析
    const xmlMatch = /<image.*?file="([^"]+)".*?\/>/i.exec(content) ||
                    /<img.*?file="([^"]+)".*?\/>/i.exec(content)
    if (xmlMatch && xmlMatch[1]) {
      return xmlMatch[1]
    }
    // 尝试从CQ码解析
    const cqMatch = /\[CQ:image,(?:.*?,)?file=([^,\]]+)(?:,|])/i.exec(content)
    if (cqMatch && cqMatch[1]) {
      return cqMatch[1]
    }
    // 尝试从JSON格式解析
    const jsonMatch = /"file"(?:\s*):(?:\s*)"([^"]+)"/i.exec(content)
    if (jsonMatch && jsonMatch[1]) {
      return jsonMatch[1]
    }
    // 尝试从URL解析
    const urlMatch = /https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|gif|bmp|webp)/i.exec(content)
    if (urlMatch && urlMatch[0]) {
      return urlMatch[0]
    }
    return null
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
