# koishi-plugin-dev-tool

[![npm](https://img.shields.io/npm/v/koishi-plugin-dev-tool?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-dev-tool)

开发工具，提供消息查看以及数据库工具，可查询或删除数据表，支持功能参见README

## 功能介绍

- **消息检查**：解析消息元素结构，查看原始消息内容
- **数据库管理**：查询、更新、删除数据表内容
- **数据库备份**：支持自动/手动备份，多种备份模式
- **数据库恢复**：简便的数据恢复机制

### OneBot管理工具

- 提供丰富的信息查询功能，包括消息、图片、语音、合并转发等内容
- 支持查询账号信息、群组信息、成员信息等
- 提供OneBot实现重启、缓存清理等管理功能
- 支持获取运行状态和版本信息

## 命令列表

### 消息检查命令

| 命令 | 说明 | 示例 |
|-----|------|------|
| `inspect elements` | 检查消息元素结构 | 回复一条消息并使用此命令，或使用 -i 选项指定消息ID |
| `inspect content` | 获取原始消息内容 | 回复一条消息并使用此命令，或使用 -i 选项指定消息ID |
| `inspect msgid` | 获取消息ID | 发送或回复消息以获取其消息ID |
| `inspect session` | 查看会话信息 | 查看当前会话的信息 |

#### 消息检查选项

| 选项 | 说明 | 示例 |
|-----|------|------|
| `-i, --id <messageId>` | 指定要检查的消息ID | `inspect elements -i 1234567890` |

### 数据库命令

| 命令 | 说明 | 示例 |
|-----|------|------|
| `db [页码]` | 显示数据库概览 | `db 2` |
| `db.all` | 显示所有表 | `db.all` |
| `db.query <表名>` | 查询表数据 | `db.query user -f {"authority":4} --page 2` |
| `db.count <表名>` | 统计记录数 | `db.count message -f {"platform":"discord"}` |
| `db.update <表名>` | 更新表数据 | `db.update user -m set -q {"id":123} -d {"authority":4}` |
| `db.delete <表名>` | 删除表数据 | `db.delete message -f {"time":{"$lt":1600000000}}` |
| `db.drop [表名]` | 删除表 | `db.drop temp_table` |
| `db.backup` | 备份数据库 | `db.backup -t user,channel` |
| `db.restore [序号]` | 恢复数据库 | `db.restore 1 -t user` |

### OneBot命令

| 命令 | 说明 | 示例 |
|-----|------|------|
| `onebot.restart` | 重启 OneBot | `onebot.restart` |
| `onebot.clean` | 清理缓存 | `onebot.clean` |
| `get` | 获取消息内容及状态 | `get -i 1234567890` |
| `get.forward` | 获取合并转发内容 | `get.forward -i 1234567890` |
| `get.record` | 获取语音文件 | `get.record -f 1234.silk -t mp3` |
| `get.image` | 获取图片文件 | `get.image -f abc.image` |
| `get.stat` | 获取运行状态 | `get.stat` |
| `get.ver` | 获取版本信息 | `get.ver` |
| `get.csrf` | 获取相关接口凭证 | `get.csrf qun.qq.com` |
| `info` | 查询账号信息 | `info` |
| `info.user` | 查询其它账号信息 | `info.user 123456 -n` |
| `info.friend` | 获取本账号好友列表 | `info.friend` |
| `info.group` | 获取本账号群组列表 | `info.group` |
| `group` | 查询群信息 | `group 123456 -n` |
| `group.user` | 查询群成员信息 | `group.user 123456 654321 -n` |
| `group.list` | 获取群成员列表 | `group.list 123456` |
| `group.honor` | 查询群荣誉信息 | `group.honor 123456 -t talkative` |

## 命令参数说明

### inspect elements/content

- `-i, --id <messageId>` - 指定要检查的消息ID

### db.query

- `-f, --filter <过滤条件>` - JSON格式过滤条件
- `--page <页码>` - 结果分页，默认为1

### db.count

- `-f, --filter <过滤条件>` - JSON格式过滤条件

### db.update

- `-m, --mode <模式>` - 更新模式：set(默认)/create/upsert
- `-q, --query <查询条件>` - JSON格式查询条件(set模式)
- `-k, --keys <索引字段>` - 索引字段(upsert模式,逗号分隔)
- `-d, --data <数据>` - JSON格式数据(必填)

### db.delete

- `-f, --filter <过滤条件>` - JSON格式过滤条件

### db.drop

- `-a, --all` - 删除所有表

### db.backup

- `-t, --tables <表名>` - 指定要备份的表(逗号分隔)

### db.restore

- `-t, --tables <表名>` - 指定要恢复的表(逗号分隔)

### get/get.forward

- `-i, --id <messageId>` - 指定消息ID

### get.record

- `-f, --file <file>` - 语音文件名
- `-t, --format <format>` - 转换格式(mp3/amr/wma/m4a/spx/ogg/wav/flac)

### get.image

- `-f, --file <file>` - 图片文件名

### get.csrf

- `[domain]` - 可选，指定域名

### info.user/group

- `-n, --no-cache` - 不使用缓存

### group.honor

- `-t, --type <type>` - 荣誉类型(talkative/performer/legend/strong_newbie/emotion)

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|-------|------|-------|------|
| `enableAdminCommands` | boolean | true | 启用 OneBot 管理命令 |
| `autoBackup` | boolean | false | 启用自动备份 |
| `singleFile` | boolean | false | 以单文件存储备份 |
| `interval` | number | 24 | 自动备份间隔（小时） |
| `keepBackups` | number | 7 | 保留备份数量（0为不限制） |
| `dir` | string | './data/backups' | 备份存储目录 |
| `tables` | string[] | [] | 特殊表名（如大写表名） |

## 自动备份

启用配置项 `autoBackup` 并设置 `interval` 可实现定时自动备份数据库。过期备份会根据 `keepBackups` 设置自动清理。

## 使用建议

1. 在正式使用数据库命令修改数据前，先执行备份操作
2. 复杂的数据库更新操作请先测试，以避免数据丢失
3. 建议将备份目录配置到独立存储或云端同步目录
