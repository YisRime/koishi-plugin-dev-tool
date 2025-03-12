# koishi-plugin-dev-tool

[![npm](https://img.shields.io/npm/v/koishi-plugin-dev-tool?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-dev-tool)

消息元素获取及数据库工具，可自动备份数据库

## 功能

### inspect elements

检查消息元素结构。当消息中包含 JSON 元素时，会将 JSON 内容单独展示。

- 直接使用：显示当前消息的元素结构
- 回复消息使用：显示被回复消息的元素结构

### inspect msgid

获取消息 ID。

- 直接使用：显示当前消息的 ID、平台、频道 ID 和用户 ID
- 回复消息使用：显示被回复消息的 ID

### db

数据库管理工具（需要权限等级 4）

- 直接使用：显示数据库表概览
- 指定页码：`db <page>` 分页显示表信息

#### db.query

从表中查询数据

- `<table>` 要查询的表名
- `-f <filter>` 过滤条件(JSON格式)
- `--page <page>` 页码

示例：

```bash
db.query user -f {"platform":"discord"} --page 2
```

#### db.count

统计表中记录数量

- `<table>` 要统计的表名
- `-f <filter>` 过滤条件(JSON格式)

示例：

```bash
db.count user -f {"authority":5}  # 统计管理员数量
```

#### db.update

更新表中数据

- `<table>` 要操作的表名
- `-m <mode>` 操作模式:
  - `set`: 更新已有数据(默认)
  - `create`: 创建新数据
  - `upsert`: 更新或插入多条数据
- `-q <query>` 查询条件（set模式，JSON格式）
- `-k <keys>` 索引字段（upsert模式，逗号分隔）
- `-d <data>` 要更新的数据(JSON格式,必填)

示例：

```bash
# 更新用户权限
db.update user -m set -q {"id":10086} -d {"authority":4}
# 创建新用户
db.update user -m create -d {"name":"New","authority":1}
```

#### db.delete

删除表中数据

- `<table>` 要操作的表名
- `-f <filter>` 过滤条件(JSON格式)

示例：

```bash
# 清空临时表
db.delete temp_data
# 删除旧消息
db.delete message -f {"time":{"$lt":1600000000}}
```

#### db.drop

删除数据库表（需要权限等级 5）

- `[table]` 要删除的表名
- `-a` 删除所有表

示例：

```bash
db.drop temp_table  # 删除单个表
db.drop -a  # 删除所有表
```

#### db.backup

备份数据库

- `-t <tables>` 备份指定表（逗号分隔）

#### db.restore

恢复数据库备份

- `[index]` 备份序号（从1开始）
- `-t <tables>` 恢复指定表（逗号分隔）

示例：

```bash
db.restore  # 列出可用备份
db.restore 1  # 恢复最新备份
db.restore 2 -t user,group  # 恢复指定表
```

## 配置项

- `tables`: 数据库特殊表名列表，用于处理大写表名等特殊情况
- `autoBackup`: 是否启用自动备份功能，默认 false
- `interval`: 自动备份间隔（小时），默认 24，最小 1 小时
- `dir`: 备份文件存储目录，默认 `./data/backups`
- `keepBackups`: 保留最近几次备份，默认 7，设为 0 保留所有备份
- `singleFile`: 是否使用单文件备份模式，默认 false

## 权限要求

- 数据库相关命令需要权限等级 4
- 删除表命令需要权限等级 5

## 注意事项

1. 备份时会自动处理和还原日期类型数据
2. 自动备份功能需要开启 `autoBackup` 并设置合适的 `interval`
3. 建议根据数据量和备份频率适当配置 `keepBackups` 以管理磁盘空间
4. 删除表操作不可恢复，请谨慎使用
