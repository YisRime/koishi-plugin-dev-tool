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

数据库管理命令，直接使用将显示数据库表的概览信息（需要权限等级 4）。

#### db.query

查询指定表的数据。

- `<table>` 要查询的表名
- `-f <filter>` 查询条件（JSON格式，默认 `{}`）
- `-p <page>` 指定页码，用于分页显示结果

#### db.count

获取表中记录数量。

- `<table>` 要统计的表名
- `-f <filter>` 统计条件（JSON格式，默认 `{}`）

#### db.delete

从表中删除数据。

- `<table>` 要操作的表名
- `-f <filter>` 删除条件（JSON格式，默认 `{}`，无条件则清空整个表）

#### db.backup

立即执行数据库备份。

- 支持单文件或多文件备份模式
- 自动创建备份目录
- 可配置定时自动备份
- 支持保留指定数量的最新备份

#### db.restore

恢复数据库备份。

- 不带参数：列出所有可用的备份
- `[index]` 可选参数，指定要恢复的备份序号（从1开始）
- `-t <table>` 可选参数，只恢复指定表的数据
- 支持从单文件或多文件备份恢复
- 自动处理日期类型数据

## 配置项

- `tables`: 数据库特殊表名列表，用于处理大写表名等特殊情况
- `backupInterval`: 自动备份间隔（小时），设为 0 禁用自动备份
- `backupDir`: 备份文件存储目录，默认 `./data/backups`
- `keepBackups`: 保留最近几次备份，设为 0 保留所有备份
- `singleFile`: 是否使用单文件备份模式，默认 false
