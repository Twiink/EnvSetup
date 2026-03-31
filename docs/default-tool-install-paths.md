# EnvSetup 默认工具安装路径说明

## 1. 适用范围

本文档说明 `EnvSetup` 7 个内置工具在默认模板配置下的路径展开结果，以及在双平台下不同安装模式的最终落盘位置。

本文档基于当前仓库默认模板值：

- `installRootDir`: `./.envsetup-data/toolchain`
- Node 额外目录：
  - `npmCacheDir`: `./.envsetup-data/npm-cache`
  - `npmGlobalPrefix`: `./.envsetup-data/npm-global`

## 2. 路径展开基准

当前实现中，`./.envsetup-data/toolchain` 是相对应用当前工作目录解析，不是相对 `exe`、`.app`、`.dmg` 或安装包文件所在目录解析。

为了给出一组可直接阅读的路径示例，本文使用两个基准：

- macOS 当前仓库工作目录：`/Users/mac/ProjectStation/EnvSetup`
- Windows 示例工作目录：`C:\EnvSetup`

因此默认 `installRootDir` 展开为：

- macOS: `/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain`
- Windows: `C:\EnvSetup\.envsetup-data\toolchain`

下文约定：

- `MAC_TOOLCHAIN = /Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain`
- `WIN_TOOLCHAIN = C:\EnvSetup\.envsetup-data\toolchain`

## 3. 默认模板值对应的实际路径

| 工具   | 默认管理方式 | 默认版本          | macOS 默认路径示例                                                                                        | Windows 默认路径示例                                                             |
| ------ | ------------ | ----------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Node   | `nvm`        | `20.11.1`         | `MAC_TOOLCHAIN/nvm`，活动版本通常在 `MAC_TOOLCHAIN/nvm/versions/node/v20.11.1/bin/node`                   | `WIN_TOOLCHAIN\nvm`，活动版本入口在 `WIN_TOOLCHAIN\node-current\node.exe`        |
| Java   | `sdkman`     | `21`              | `MAC_TOOLCHAIN/sdkman`，本地 JDK payload 在 `MAC_TOOLCHAIN/sdkman/local/java-21`                          | `WIN_TOOLCHAIN\sdkman`，本地 JDK payload 在 `WIN_TOOLCHAIN\sdkman\local\java-21` |
| Python | `conda`      | `3.12.10`，`base` | `MAC_TOOLCHAIN/miniconda3/bin/python`                                                                     | `WIN_TOOLCHAIN\miniconda3\python.exe`                                            |
| Git    | `git`        | `2.51.1`          | `MAC_TOOLCHAIN/git/bin/git`                                                                               | `WIN_TOOLCHAIN\git\cmd\git.exe`                                                  |
| MySQL  | `package`    | `8.4.8`           | Homebrew 入口通常为 `/opt/homebrew/opt/mysql@8.4/bin/mysql` 或 `/usr/local/opt/mysql@8.4/bin/mysql`       | Scoop 入口通常为 `%USERPROFILE%\scoop\shims\mysql.exe`                           |
| Redis  | `package`    | `7.4.7`           | Homebrew 入口通常为 `/opt/homebrew/opt/redis/bin/redis-server` 或 `/usr/local/opt/redis/bin/redis-server` | Scoop 入口通常为 `%USERPROFILE%\scoop\shims\redis-server.exe`                    |
| Maven  | `maven`      | `3.9.11`          | `MAC_TOOLCHAIN/maven-3.9.11/bin/mvn`                                                                      | `WIN_TOOLCHAIN\maven-3.9.11\bin\mvn.cmd`                                         |

Node 默认配置还会额外创建：

- macOS:
  - `/Users/mac/ProjectStation/EnvSetup/.envsetup-data/npm-cache`
  - `/Users/mac/ProjectStation/EnvSetup/.envsetup-data/npm-global`
- Windows:
  - `C:\EnvSetup\.envsetup-data\npm-cache`
  - `C:\EnvSetup\.envsetup-data\npm-global`

## 4. 7 个工具的完整路径示例

### 4.1 Node

#### 直装模式 `node`

- macOS 最终目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/node-v20.11.1`
- macOS PATH 入口：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/node-v20.11.1/bin`
- Windows 最终目录：`C:\EnvSetup\.envsetup-data\toolchain\node-v20.11.1`
- Windows PATH 入口：`C:\EnvSetup\.envsetup-data\toolchain\node-v20.11.1`

#### 管理器模式 `nvm`

- macOS 管理器目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/nvm`
- macOS 活动版本示例：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/nvm/versions/node/v20.11.1/bin/node`
- Windows 管理器目录：`C:\EnvSetup\.envsetup-data\toolchain\nvm`
- Windows 活动版本稳定入口：`C:\EnvSetup\.envsetup-data\toolchain\node-current\node.exe`
- Windows 当前版本物理目录通常是：`C:\EnvSetup\.envsetup-data\toolchain\nvm\v20.11.1`

#### Node 额外目录

- macOS npm cache：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/npm-cache`
- macOS npm global prefix：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/npm-global`
- Windows npm cache：`C:\EnvSetup\.envsetup-data\npm-cache`
- Windows npm global prefix：`C:\EnvSetup\.envsetup-data\npm-global`

### 4.2 Java

#### 直装模式 `jdk`

- macOS 最终目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/java-21`
- macOS PATH 入口：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/java-21/bin/java`
- Windows 最终目录：`C:\EnvSetup\.envsetup-data\toolchain\java-21`
- Windows PATH 入口：`C:\EnvSetup\.envsetup-data\toolchain\java-21\bin\java.exe`

#### 管理器模式 `sdkman`

- macOS 管理器目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/sdkman`
- macOS 本地 JDK payload：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/sdkman/local/java-21`
- macOS 活动候选入口：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/sdkman/candidates/java/current/bin/java`
- Windows 管理器目录：`C:\EnvSetup\.envsetup-data\toolchain\sdkman`
- Windows 本地 JDK payload：`C:\EnvSetup\.envsetup-data\toolchain\sdkman\local\java-21`
- Windows 活动候选入口：`C:\EnvSetup\.envsetup-data\toolchain\sdkman\candidates\java\current\bin\java.exe`

### 4.3 Python

#### 直装模式 `python`

- macOS 最终目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/python-3.12.10`
- macOS PATH 入口：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/python-3.12.10/bin/python3`
- Windows 最终目录：`C:\EnvSetup\.envsetup-data\toolchain\python-3.12.10`
- Windows PATH 入口：`C:\EnvSetup\.envsetup-data\toolchain\python-3.12.10\python.exe`

#### macOS 安装包模式 `pkg`

- 最终目录仍然是：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/python-3.12.10`
- PATH 入口仍然是：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/python-3.12.10/bin/python3`
- 安装过程中会使用形如：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/python-3.12.10.pkg`

#### 管理器模式 `conda`

- macOS Miniconda 根目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/miniconda3`
- macOS `base` 环境入口：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/miniconda3/bin/python`
- macOS 自定义环境示例：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/miniconda3/envs/myenv/bin/python`
- Windows Miniconda 根目录：`C:\EnvSetup\.envsetup-data\toolchain\miniconda3`
- Windows `base` 环境入口：`C:\EnvSetup\.envsetup-data\toolchain\miniconda3\python.exe`
- Windows 自定义环境示例：`C:\EnvSetup\.envsetup-data\toolchain\miniconda3\envs\myenv\python.exe`

### 4.4 Git

#### 直装模式 `git`

- macOS 最终目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/git`
- macOS PATH 入口：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/git/bin/git`
- macOS 安装过程中会使用形如：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/git-2.51.1-intel-universal-mavericks.dmg`
- Windows 最终目录：`C:\EnvSetup\.envsetup-data\toolchain\git`
- Windows PATH 入口：`C:\EnvSetup\.envsetup-data\toolchain\git\cmd\git.exe`
- Windows 安装过程中会使用形如：`C:\EnvSetup\.envsetup-data\toolchain\Git-2.51.1-64-bit.tar.bz2`

#### macOS 包管理器模式 `homebrew`

- EnvSetup 写入 PATH 的稳定入口通常是：
  - Apple Silicon: `/opt/homebrew/opt/git@2.51.1/bin/git`
  - Intel: `/usr/local/opt/git@2.51.1/bin/git`
- 如果 Homebrew 尚未安装，Git 插件默认会直接走官方在线安装脚本，不固定落在 `toolchain` 下

#### Windows 包管理器模式 `scoop`

- Scoop shim 入口：`%USERPROFILE%\scoop\shims\git.exe`
- Scoop 包目录通常为：`%USERPROFILE%\scoop\apps\git`
- 常见实际版本目录：`%USERPROFILE%\scoop\apps\git\current`

### 4.5 MySQL

#### 直装模式 `mysql`

- macOS 最终目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/mysql`
- macOS PATH 入口：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/mysql/bin/mysql`
- Windows 最终目录：`C:\EnvSetup\.envsetup-data\toolchain\mysql`
- Windows PATH 入口：`C:\EnvSetup\.envsetup-data\toolchain\mysql\bin\mysql.exe`

#### macOS 包管理器模式 `package` -> Homebrew

- 版本 `8.4.8` 对应公式：`mysql@8.4`
- PATH 入口通常是：
  - Apple Silicon: `/opt/homebrew/opt/mysql@8.4/bin/mysql`
  - Intel: `/usr/local/opt/mysql@8.4/bin/mysql`
- Homebrew 安装脚本缓存示例：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/homebrew-install.sh`

#### Windows 包管理器模式 `package` -> Scoop

- Scoop shim 入口：`%USERPROFILE%\scoop\shims\mysql.exe`
- Scoop 包目录通常为：`%USERPROFILE%\scoop\apps\mysql`
- 常见实际版本目录：`%USERPROFILE%\scoop\apps\mysql\current`

### 4.6 Redis

#### 直装模式 `redis`

- macOS 最终目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/redis`
- macOS PATH 入口：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/redis/src/redis-server`
- Windows 最终目录：`C:\EnvSetup\.envsetup-data\toolchain\redis`
- Windows PATH 入口通常为：
  - `C:\EnvSetup\.envsetup-data\toolchain\redis\memurai.exe`
  - 或 `C:\EnvSetup\.envsetup-data\toolchain\redis\redis-server.exe`
- 注意：Windows 直装虽然模板叫 `redis`，实际使用的是 Memurai Developer 安装器，最终仍落在 `WIN_TOOLCHAIN\redis`

#### macOS 包管理器模式 `package` -> Homebrew

- PATH 入口通常是：
  - Apple Silicon: `/opt/homebrew/opt/redis/bin/redis-server`
  - Intel: `/usr/local/opt/redis/bin/redis-server`
- Homebrew 安装脚本缓存示例：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/homebrew-install.sh`

#### Windows 包管理器模式 `package` -> Scoop

- Scoop shim 入口：`%USERPROFILE%\scoop\shims\redis-server.exe`
- Scoop 包目录通常为：`%USERPROFILE%\scoop\apps\redis`
- 常见实际版本目录：`%USERPROFILE%\scoop\apps\redis\current`

### 4.7 Maven

#### 直装模式 `maven`

- macOS 最终目录：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/maven-3.9.11`
- macOS PATH 入口：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/maven-3.9.11/bin/mvn`
- Windows 最终目录：`C:\EnvSetup\.envsetup-data\toolchain\maven-3.9.11`
- Windows PATH 入口：`C:\EnvSetup\.envsetup-data\toolchain\maven-3.9.11\bin\mvn.cmd`

#### macOS 包管理器模式 `package` -> Homebrew

- PATH 入口通常是：
  - Apple Silicon: `/opt/homebrew/opt/maven/bin/mvn`
  - Intel: `/usr/local/opt/maven/bin/mvn`
- Homebrew 安装脚本缓存示例：`/Users/mac/ProjectStation/EnvSetup/.envsetup-data/toolchain/homebrew-install.sh`

#### Windows 包管理器模式 `package` -> Scoop

- Scoop shim 入口：`%USERPROFILE%\scoop\shims\mvn.cmd`
- Scoop 包目录通常为：`%USERPROFILE%\scoop\apps\maven`
- 常见实际版本目录：`%USERPROFILE%\scoop\apps\maven\current`

## 5. 直装和包管理器安装的核心区别

### 5.1 会不会安装到 `toolchain`

- Node `nvm`、Java `sdkman`、Python `conda` 这三种“管理器模式”本质上仍然是安装到 `toolchain` 下面的用户自管目录。
- Git / MySQL / Redis / Maven 的包管理器模式不是安装到 `toolchain` 本体，而是安装到 Homebrew 或 Scoop 的管理目录。

### 5.2 `toolchain` 在两类模式中的作用

- 直装模式：
  - `toolchain` 既是下载目录，也是最终安装目录。
- 包管理器模式：
  - `toolchain` 通常只是下载脚本、缓存安装包或做中间处理。
  - 真正的可执行文件通常来自：
    - macOS: Homebrew `opt/<formula>/bin`
    - Windows: Scoop `shims` 和 `apps/<package>`

### 5.3 清理和回滚时的差异

- 直装模式通常回收 `toolchain` 下对应子目录，例如 `toolchain/git`、`toolchain/mysql`、`toolchain/maven-3.9.11`。
- 包管理器模式需要先走 Homebrew / Scoop 的官方卸载路径，再处理残留 PATH、shim、环境变量或缓存目录。

## 6. 一句话结论

如果你问的是“默认 `./.envsetup-data/toolchain` 最终会变成哪里”，答案是：

- 直装模式：大多数工具最终直接落在 `toolchain` 下的子目录。
- Node `nvm` / Java `sdkman` / Python `conda`：虽然是管理器模式，但也仍然落在 `toolchain` 下。
- Git / MySQL / Redis / Maven 的 Homebrew / Scoop 模式：最终不落在 `toolchain` 本体，而是落在 Homebrew / Scoop 的管理目录，`toolchain` 更多是脚本和缓存的落脚点。
