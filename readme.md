# koishi-plugin-dev-tool

[![npm](https://img.shields.io/npm/v/koishi-plugin-dev-tool?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-dev-tool)

开发工具，提供消息元素检查、原始消息查看以及数据库工具，可查询或删除数据，以及备份恢复数据库

## 功能介绍

- **消息检查**：解析消息元素结构，查看原始消息内容
- **数据库管理**：查询、更新、删除数据表内容
- **数据库备份**：支持自动/手动备份，多种备份模式
- **数据库恢复**：简便的数据恢复机制

## 命令列表

### 消息检查命令

| 命令 | 说明 | 示例 |
|-----|------|------|
| `inspect elements [messageId]` | 检查消息元素结构 | 回复一条消息并使用此命令，或指定消息ID |
| `inspect msg [messageId]` | 查看原始消息内容 | 回复一条消息并使用此命令，或指定消息ID |

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

## 数据库命令参数

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

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|-------|------|-------|------|
| `autoBackup` | boolean | false | 启用自动备份 |
| `singleFile` | boolean | false | 以单文件存储备份 |
| `interval` | number | 24 | 自动备份间隔（小时） |
| `keepBackups` | number | 7 | 保留备份数量（0为不限制） |
| `dir` | string | './data/backups' | 备份存储目录 |
| `tables` | string[] | [] | 特殊表名（如大写表名） |

## 使用示例

### 消息元素检查

1. 回复一条包含特殊消息元素的消息
2. 输入命令：`inspect elements`
3. 查看解析后的消息元素结构

也可以直接指定消息ID：`inspect elements 1234567890`

### 数据库备份与恢复

#### 手动备份

db.backup

#### 备份特定表

db.backup -t user,channel,group

#### 查看可用备份

db.restore

#### 恢复备份

db.restore 1

#### 恢复特定表

db.restore 1 -t user,channel

## 自动备份

启用配置项 `autoBackup` 并设置 `interval` 可实现定时自动备份数据库。过期备份会根据 `keepBackups` 设置自动清理。

## 使用建议

1. 在正式使用数据库命令修改数据前，先执行备份操作
2. 复杂的数据库更新操作请先测试，以避免数据丢失
3. 建议将备份目录配置到独立存储或云端同步目录
