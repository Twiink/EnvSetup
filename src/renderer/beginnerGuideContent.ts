/**
 * 提供新手知识页使用的结构化内容数据。
 */

import type { LocalizedTextInput } from '../shared/locale'

export type BeginnerGuidePlatform = 'generic' | 'darwin' | 'win32'

export type BeginnerGuideToolId =
  | 'overview'
  | 'node'
  | 'java'
  | 'python'
  | 'git'
  | 'mysql'
  | 'redis'
  | 'maven'

export type BeginnerGuideBullet = {
  text: LocalizedTextInput
  platform?: BeginnerGuidePlatform
}

export type BeginnerGuideCodeSample = {
  id: string
  label?: LocalizedTextInput
  value: string
  platform?: BeginnerGuidePlatform
}

export type BeginnerGuideEnvVar = {
  id: string
  name: string
  description: LocalizedTextInput
  example?: string
  platform?: BeginnerGuidePlatform
}

export type BeginnerGuideFaq = {
  id: string
  question: LocalizedTextInput
  answer: LocalizedTextInput
  platform?: BeginnerGuidePlatform
}

export type BeginnerGuideCard = {
  id: string
  eyebrow?: LocalizedTextInput
  title: LocalizedTextInput
  description: LocalizedTextInput
  bullets?: BeginnerGuideBullet[]
  codeSamples?: BeginnerGuideCodeSample[]
  envVars?: BeginnerGuideEnvVar[]
  faqs?: BeginnerGuideFaq[]
  tip?: LocalizedTextInput
  pitfall?: LocalizedTextInput
}

export type BeginnerGuideTopicSection = {
  id: string
  title: LocalizedTextInput
  description: LocalizedTextInput
  cards: BeginnerGuideCard[]
}

export type BeginnerGuideTopic = {
  id: BeginnerGuideToolId
  title: LocalizedTextInput
  description: LocalizedTextInput
  sections: BeginnerGuideTopicSection[]
}

function t(zh: string, en: string): LocalizedTextInput {
  return { 'zh-CN': zh, en }
}

function bullet(text: LocalizedTextInput, platform?: BeginnerGuidePlatform): BeginnerGuideBullet {
  return { text, platform }
}

function sample(
  id: string,
  value: string,
  label?: LocalizedTextInput,
  platform?: BeginnerGuidePlatform,
): BeginnerGuideCodeSample {
  return { id, value, label, platform }
}

function envVar(
  id: string,
  name: string,
  description: LocalizedTextInput,
  example?: string,
  platform?: BeginnerGuidePlatform,
): BeginnerGuideEnvVar {
  return { id, name, description, example, platform }
}

function faq(
  id: string,
  question: LocalizedTextInput,
  answer: LocalizedTextInput,
  platform?: BeginnerGuidePlatform,
): BeginnerGuideFaq {
  return { id, question, answer, platform }
}

const MAC_ROOT = '/Users/mac/ProjectStation/EnvSetup/.envsetup-data'
const WIN_ROOT = 'C:\\EnvSetup\\.envsetup-data'
const MAC_TOOLCHAIN = `${MAC_ROOT}/toolchain`
const WIN_TOOLCHAIN = `${WIN_ROOT}\\toolchain`

export const beginnerGuideTopics: BeginnerGuideTopic[] = [
  {
    id: 'overview',
    title: t('总览', 'Overview'),
    description: t(
      '先把命令、目录、环境变量和默认安装路径这些底层概念看明白，再去看每个工具会轻松很多。',
      'Understand commands, folders, environment variables, and default install paths first. The individual tools become much easier after that.',
    ),
    sections: [
      {
        id: 'basics',
        title: t('基础概念', 'Foundations'),
        description: t(
          '这些概念贯穿所有工具，不只是 Git、Python 或 Node。',
          'These ideas apply to every tool, not just Git, Python, or Node.',
        ),
        cards: [
          {
            id: 'command-shape',
            eyebrow: t('先看懂命令', 'Read the Command First'),
            title: t('占位符、引号和点号是什么意思', 'What Placeholders, Quotes, and `.` Mean'),
            description: t(
              '很多教程里的命令不是整句原样复制，而是需要替换掉一部分内容。',
              'Many tutorial commands are templates. You usually need to replace part of them before running.',
            ),
            bullets: [
              bullet(
                t(
                  '`<file>`、`<name>` 这类尖括号内容表示占位符，要换成你自己的值。',
                  'Items like `<file>` and `<name>` are placeholders. Replace them with your own values.',
                ),
              ),
              bullet(
                t(
                  '`git commit -m "..."` 中双引号通常保留，但引号里的文字要改成你的提交说明。',
                  'In `git commit -m "..."`, the quotes usually stay, but the text inside them should change.',
                ),
              ),
              bullet(
                t(
                  '单独的 `.` 表示“当前目录”，常见于 `git add .`、`python -m venv .venv`。',
                  'A single `.` means “the current folder.” You see it in commands like `git add .` and `python -m venv .venv`.',
                ),
              ),
            ],
            codeSamples: [
              sample(
                'overview-command-shape-example',
                'git commit -m "新增新手知识页"',
                t('示例', 'Example'),
              ),
            ],
            pitfall: t(
              '不要把 `<file>`、`<message>`、中文说明一起原样粘进终端，它们常常只是教程写法。',
              'Do not paste `<file>`, `<message>`, or tutorial notes literally into the terminal. They are often documentation placeholders.',
            ),
          },
          {
            id: 'current-directory',
            eyebrow: t('目录意识', 'Folder Awareness'),
            title: t('先确认你现在在哪个目录', 'Always Check Your Current Folder'),
            description: t(
              '很多“命令没用”并不是命令错了，而是你在错误的目录里执行了它。',
              'A lot of “this command does not work” problems happen because you ran it in the wrong folder.',
            ),
            bullets: [
              bullet(
                t(
                  'Node 项目的 `npm install`、`npm run dev` 通常要在有 `package.json` 的目录里执行。',
                  'Node commands like `npm install` and `npm run dev` usually need to run in the folder that contains `package.json`.',
                ),
              ),
              bullet(
                t(
                  'Git 命令通常要在仓库目录里执行，否则你会看到 “not a git repository”。',
                  'Git commands usually need to run inside the repository folder, or you will see “not a git repository”.',
                ),
              ),
            ],
            codeSamples: [
              sample('overview-pwd', 'pwd', t('macOS / Linux', 'macOS / Linux'), 'darwin'),
              sample(
                'overview-get-location',
                'Get-Location',
                t('Windows PowerShell', 'Windows PowerShell'),
                'win32',
              ),
              sample(
                'overview-cd-project',
                'cd /Users/you/project-name',
                t('进入项目目录', 'Enter the project folder'),
              ),
            ],
            tip: t(
              '如果你不确定自己在哪，先查目录，再做下一步。',
              'If you are unsure where you are, check the folder first and only then continue.',
            ),
          },
          {
            id: 'path-and-env',
            eyebrow: t('环境变量', 'Environment Variables'),
            title: t('`PATH` 和环境变量到底是什么', 'What `PATH` and Environment Variables Really Are'),
            description: t(
              '环境变量是终端或进程读取的一组键值；`PATH` 是其中最常见、最重要的一项。',
              'Environment variables are key-value pairs that a terminal or process reads. `PATH` is the most common and important one.',
            ),
            bullets: [
              bullet(
                t(
                  '`PATH` 决定终端去哪些目录里寻找命令，比如 `node`、`java`、`git`。',
                  '`PATH` tells the terminal where to look for commands like `node`, `java`, and `git`.',
                ),
              ),
              bullet(
                t(
                  '`JAVA_HOME`、`MAVEN_HOME`、`NVM_DIR`、`CONDA_PREFIX` 这种变量通常告诉工具“我的安装根目录在哪里”。',
                  'Variables like `JAVA_HOME`, `MAVEN_HOME`, `NVM_DIR`, and `CONDA_PREFIX` usually tell tools where the installation root is.',
                ),
              ),
              bullet(
                t(
                  '改完环境变量后，老终端不一定会自动更新，所以常常需要开一个新的终端窗口。',
                  'After changing environment variables, existing terminal sessions may not update automatically, so a new terminal window is often needed.',
                ),
              ),
            ],
            envVars: [
              envVar(
                'overview-path',
                'PATH',
                t(
                  '告诉系统去哪里找可执行文件。大多数“command not found”都和它有关。',
                  'Tells the system where to search for executables. Many “command not found” errors are related to it.',
                ),
              ),
              envVar(
                'overview-java-home',
                'JAVA_HOME',
                t(
                  '告诉 Java 相关工具使用哪一个 JDK 根目录。',
                  'Tells Java-related tools which JDK root directory to use.',
                ),
              ),
              envVar(
                'overview-conda-prefix',
                'CONDA_PREFIX',
                t(
                  '表示当前激活的 Conda 环境目录。退出环境后它通常会消失。',
                  'Points to the currently active Conda environment. It usually disappears after deactivation.',
                ),
              ),
            ],
            tip: t(
              '如果你理解了 `PATH`，就能读懂这页里大半的“为什么命令能直接运行”。',
              'Once you understand `PATH`, you understand why most commands on this page can run directly.',
            ),
          },
        ],
      },
      {
        id: 'paths',
        title: t('默认路径与目录职责', 'Default Paths and Folder Roles'),
        description: t(
          'EnvSetup 里的很多路径都不是系统固定目录，而是基于当前工作目录展开。',
          'Many EnvSetup paths are not fixed system locations. They expand relative to the current working directory.',
        ),
        cards: [
          {
            id: 'default-root-paths',
            eyebrow: t('默认路径', 'Default Paths'),
            title: t(
              '为什么 `./.envsetup-data/toolchain` 很重要',
              'Why `./.envsetup-data/toolchain` Matters',
            ),
            description: t(
              '当前实现里，默认安装根目录是相对“应用当前工作目录”解析的，不是相对安装包或可执行文件路径。',
              'In the current implementation, the default install root is resolved relative to the app’s current working directory, not the installer or executable location.',
            ),
            codeSamples: [
              sample(
                'overview-mac-toolchain',
                MAC_TOOLCHAIN,
                t('macOS 示例', 'macOS example'),
                'darwin',
              ),
              sample(
                'overview-win-toolchain',
                WIN_TOOLCHAIN,
                t('Windows 示例', 'Windows example'),
                'win32',
              ),
            ],
            bullets: [
              bullet(
                t(
                  '同一个模板值，在不同工作目录下会展开成不同的绝对路径。',
                  'The same template value can expand to different absolute paths in different working directories.',
                ),
              ),
              bullet(
                t(
                  '这也是为什么知识页里的路径示例都写成“示例路径”，而不是唯一正确答案。',
                  'That is why the paths in this guide are examples, not the only possible answers.',
                ),
              ),
            ],
          },
          {
            id: 'install-cache-global',
            eyebrow: t('目录职责', 'Folder Roles'),
            title: t(
              '安装目录、缓存目录、全局目录不是一回事',
              'Install Roots, Cache Folders, and Global Folders Are Different',
            ),
            description: t(
              '尤其是 Node，这三个目录经常一起出现，但职责完全不同。',
              'Node especially uses several folders together, but they serve different jobs.',
            ),
            bullets: [
              bullet(
                t(
                  '`installRootDir` 存放工具本体，例如 JDK、Git、Maven 或 Miniconda。',
                  '`installRootDir` stores the tool itself, such as a JDK, Git, Maven, or Miniconda.',
                ),
              ),
              bullet(
                t(
                  '`npmCacheDir` 存放 npm 下载缓存，删掉后不影响源码，但以后会重新下载。',
                  '`npmCacheDir` stores npm download caches. Deleting it does not remove source code, but downloads will happen again later.',
                ),
              ),
              bullet(
                t(
                  '`npmGlobalPrefix` 是 npm 全局安装目录，用来放 `npm install -g` 的内容。',
                  '`npmGlobalPrefix` is the npm global install directory, used for packages installed with `npm install -g`.',
                ),
              ),
            ],
            codeSamples: [
              sample(
                'overview-npm-cache',
                `${MAC_ROOT}/npm-cache`,
                t('macOS npm cache 示例', 'macOS npm cache example'),
                'darwin',
              ),
              sample(
                'overview-npm-global',
                `${WIN_ROOT}\\npm-global`,
                t('Windows npm global 示例', 'Windows npm global example'),
                'win32',
              ),
            ],
            tip: t(
              '看到“缓存”就先想“可重新生成”，看到“安装目录”再想“工具本体”。',
              'When you see “cache”, think “can be regenerated”. When you see “install root”, think “the tool itself”.',
            ),
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: t('通用排错顺序', 'A General Troubleshooting Order'),
        description: t(
          '新手排错最怕东试一点西试一点。先按固定顺序查，效率最高。',
          'Beginners lose time by trying random fixes. Follow a stable troubleshooting order instead.',
        ),
        cards: [
          {
            id: 'global-checklist',
            eyebrow: t('排错顺序', 'Troubleshooting Order'),
            title: t('先查这 6 件事', 'Start with These 6 Checks'),
            description: t(
              '无论是 Git、Python、Node 还是 Java，大部分问题都能先用这套顺序缩小范围。',
              'Whether the problem is Git, Python, Node, or Java, this order usually narrows it down quickly.',
            ),
            faqs: [
              faq(
                'overview-check-dir',
                t('1. 你现在在正确的目录吗？', '1. Are you in the correct folder?'),
                t(
                  '先确认当前目录，再执行项目命令。很多“命令无效”只是目录不对。',
                  'Confirm the current folder before running project commands. Many “command failed” issues come from the wrong directory.',
                ),
              ),
              faq(
                'overview-check-installed',
                t('2. 工具真的安装了吗？', '2. Is the tool actually installed?'),
                t(
                  '先跑 `node -v`、`java -version`、`python --version`、`git --version` 这类命令确认工具是否可执行。',
                  'Run `node -v`, `java -version`, `python --version`, or `git --version` to confirm the tool is actually executable.',
                ),
              ),
              faq(
                'overview-check-path',
                t('3. 是不是 `PATH` 没生效？', '3. Did `PATH` fail to take effect?'),
                t(
                  '如果刚安装完就提示找不到命令，优先开一个新终端，再查环境变量。',
                  'If a newly installed command is still missing, open a new terminal first and then check environment variables.',
                ),
              ),
              faq(
                'overview-check-version',
                t('4. 版本对吗？', '4. Is the version correct?'),
                t(
                  '工具能运行，不代表版本对。很多项目失败是因为版本过高或过低。',
                  'A command running successfully does not mean the version is correct. Many projects fail because the version is too old or too new.',
                ),
              ),
              faq(
                'overview-check-permission',
                t('5. 是权限或管理员问题吗？', '5. Could this be a permission or administrator issue?'),
                t(
                  'Windows 安装器、系统目录写入、服务注册等场景，经常需要管理员权限。',
                  'Windows installers, writing to system directories, and service registration often require administrator privileges.',
                ),
              ),
              faq(
                'overview-check-network',
                t('6. 是下载或网络问题吗？', '6. Could this be a download or network issue?'),
                t(
                  '有些错误不是配置错，而是官方下载站点不可达、超时或被拦截。',
                  'Some errors are not configuration issues at all. The official download site may be unreachable, timing out, or blocked.',
                ),
              ),
            ],
            tip: t(
              '一次只改一个变量，再重试，这样最容易定位真正原因。',
              'Change one thing at a time and retry. That is the fastest way to find the real cause.',
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'node',
    title: t('Node.js', 'Node.js'),
    description: t(
      'Node 这页除了常用命令，还会把 `nvm`、`PATH`、npm 缓存目录和全局目录的关系讲清楚。',
      'This page covers common Node commands and also explains how `nvm`, `PATH`, npm cache folders, and the global prefix fit together.',
    ),
    sections: [
      {
        id: 'overview',
        title: t('概览', 'Overview'),
        description: t('先把 Node.js、npm 和 npx 分清楚。', 'Start by separating Node.js, npm, and npx.'),
        cards: [
          {
            id: 'node-basics',
            eyebrow: t('基础概念', 'Core Concepts'),
            title: t('Node.js、npm、npx 各自负责什么', 'What Node.js, npm, and npx Each Do'),
            description: t(
              '这三个词经常一起出现，但不是同一个东西。',
              'These three terms often appear together, but they are not the same thing.',
            ),
            bullets: [
              bullet(
                t(
                  '`Node.js` 是 JavaScript 运行时。你敲 `node app.js` 时，真正执行程序的是它。',
                  '`Node.js` is the JavaScript runtime. When you run `node app.js`, it is the program doing the execution.',
                ),
              ),
              bullet(
                t(
                  '`npm` 是包管理器，用来安装依赖、读取 `package.json`、执行 `npm run xxx`。',
                  '`npm` is the package manager. It installs dependencies, reads `package.json`, and runs `npm run xxx` scripts.',
                ),
              ),
              bullet(
                t(
                  '`npx` 用来临时运行包暴露出来的命令，例如 `npx vitest`。',
                  '`npx` runs commands exposed by packages temporarily, such as `npx vitest`.',
                ),
              ),
            ],
          },
          {
            id: 'node-envsetup-modes',
            eyebrow: t('项目支持', 'What EnvSetup Supports'),
            title: t('EnvSetup 支持 `node` 直装和 `nvm` 管理', 'EnvSetup Supports Direct `node` and Managed `nvm`'),
            description: t(
              '两种模式都能安装 Node，但安装结果和后续维护方式不同。',
              'Both modes install Node, but the installation result and follow-up maintenance are different.',
            ),
            bullets: [
              bullet(
                t(
                  '`node` 直装模式会把一个独立 Node 版本直接放到安装目录里。',
                  'Direct `node` mode places one standalone Node version directly into the install directory.',
                ),
              ),
              bullet(
                t(
                  '`nvm` 模式会把多个版本交给版本管理器维护，更适合经常切换版本的开发者。',
                  '`nvm` mode lets a version manager maintain multiple versions. It is better if you switch versions often.',
                ),
              ),
            ],
            tip: t(
              '如果你只维护一个固定项目，直装更直观；如果你经常切多个 Node 版本，`nvm` 更省心。',
              'If you work on one fixed project, direct install is simpler. If you switch Node versions often, `nvm` is easier to live with.',
            ),
          },
        ],
      },
      {
        id: 'install-modes',
        title: t('安装方式', 'Install Modes'),
        description: t('Node 的两种安装方式对应不同的目录布局。', 'The two Node install modes produce different folder layouts.'),
        cards: [
          {
            id: 'node-direct-mode',
            eyebrow: t('直装模式', 'Direct Install'),
            title: t('`node` 直装会得到一个固定版本目录', 'Direct `node` Install Creates One Fixed Version Folder'),
            description: t(
              '适合“这个项目只认一个 Node 版本”的场景，目录结构最直接。',
              'This is best when one project expects one fixed Node version and you want the simplest layout.',
            ),
            codeSamples: [
              sample(
                'node-direct-mac-path',
                `${MAC_TOOLCHAIN}/node-v20.11.1/bin/node`,
                t('macOS 路径示例', 'macOS path example'),
                'darwin',
              ),
              sample(
                'node-direct-win-path',
                `${WIN_TOOLCHAIN}\\node-v20.11.1\\node.exe`,
                t('Windows 路径示例', 'Windows path example'),
                'win32',
              ),
            ],
            bullets: [
              bullet(
                t(
                  '这种模式下，`PATH` 一般直接指向这个版本目录的 `bin` 或根目录。',
                  'In this mode, `PATH` usually points directly to the version folder’s `bin` or root directory.',
                ),
              ),
            ],
          },
          {
            id: 'node-nvm-mode',
            eyebrow: t('管理器模式', 'Managed Mode'),
            title: t('`nvm` 模式会维护版本目录和当前活动版本', '`nvm` Maintains Versions and an Active Selection'),
            description: t(
              '`nvm` 不只是装一个 Node，它还会维护版本列表和当前使用的版本。',
              '`nvm` does more than install one Node version. It tracks multiple versions and the active one.',
            ),
            codeSamples: [
              sample(
                'node-nvm-mac-path',
                `${MAC_TOOLCHAIN}/nvm/versions/node/v20.11.1/bin/node`,
                t('macOS 活动版本示例', 'macOS active version example'),
                'darwin',
              ),
              sample(
                'node-nvm-win-path',
                `${WIN_TOOLCHAIN}\\node-current\\node.exe`,
                t('Windows 当前版本入口', 'Windows active version entry'),
                'win32',
              ),
              sample('node-nvm-ls', 'nvm ls', t('查看已安装版本', 'List installed versions'), 'darwin'),
              sample(
                'node-nvm-use',
                'nvm use 20.11.1',
                t('切换版本', 'Switch versions'),
                'darwin',
              ),
            ],
            envVars: [
              envVar(
                'node-nvm-dir',
                'NVM_DIR',
                t(
                  '告诉 shell `nvm` 安装在哪里。没有它时，终端可能找不到 `nvm`。',
                  'Tells the shell where `nvm` is installed. Without it, the terminal may not find `nvm`.',
                ),
              ),
            ],
            pitfall: t(
              '安装了 `nvm` 但终端里没有 `nvm` 命令，很多时候不是安装失败，而是 shell 初始化脚本还没生效。',
              'If `nvm` is installed but the command is still missing, the shell init script often has not taken effect yet.',
            ),
          },
        ],
      },
      {
        id: 'commands',
        title: t('常用命令', 'Common Commands'),
        description: t('日常开发里最常敲的几类 Node 命令。', 'These are the Node commands you will type most often in daily work.'),
        cards: [
          {
            id: 'node-verify',
            eyebrow: t('版本确认', 'Version Checks'),
            title: t('先确认 Node 和 npm 是否可用', 'Check Whether Node and npm Are Available'),
            description: t(
              '开始排查前，先确认命令能跑，再看版本对不对。',
              'Before deeper debugging, first confirm the commands run at all and then check whether the versions are correct.',
            ),
            codeSamples: [
              sample('node-check-node', 'node -v'),
              sample('node-check-npm', 'npm -v'),
            ],
            tip: t(
              '如果 `node -v` 能跑但项目依旧失败，下一步就该查版本是否满足项目要求。',
              'If `node -v` works but the project still fails, the next step is checking whether the version matches the project requirement.',
            ),
          },
          {
            id: 'node-project-commands',
            eyebrow: t('项目命令', 'Project Commands'),
            title: t('最常见的 `npm` 项目命令', 'The Most Common `npm` Project Commands'),
            description: t(
              '这个仓库里最常见的就是安装依赖、启动开发环境、构建和跑测试。',
              'In this repository, the most common commands are install, dev, build, and test.',
            ),
            codeSamples: [
              sample('node-install-deps', 'npm install', t('安装依赖', 'Install dependencies')),
              sample('node-run-dev', 'npm run dev', t('启动开发环境', 'Start development environment')),
              sample('node-run-build', 'npm run build', t('构建产物', 'Build output')),
              sample('node-run-test', 'npm test', t('运行测试', 'Run tests')),
            ],
            pitfall: t(
              '`npm run dev`、`npm run build` 这种命令必须依赖 `package.json` 里的脚本定义，不是所有项目都有。',
              '`npm run dev` and `npm run build` depend on scripts defined in `package.json`. Not every project has them.',
            ),
          },
          {
            id: 'node-cache-prefix',
            eyebrow: t('npm 配置', 'npm Configuration'),
            title: t('缓存目录和全局目录怎么确认', 'How to Check npm Cache and Global Prefix'),
            description: t(
              '当你想知道 npm 把缓存或全局包装到哪里时，这两条命令最直接。',
              'When you want to know where npm stores caches or global packages, these two commands are the fastest check.',
            ),
            codeSamples: [
              sample(
                'node-cache-get',
                'npm config get cache',
                t('查看 npm cache', 'View npm cache'),
              ),
              sample(
                'node-prefix-get',
                'npm config get prefix',
                t('查看 npm global prefix', 'View npm global prefix'),
              ),
            ],
          },
        ],
      },
      {
        id: 'env-and-paths',
        title: t('环境变量与路径', 'Environment Variables and Paths'),
        description: t(
          'Node 最容易让人混淆的不是命令，而是目录和变量。',
          'With Node, confusion usually comes from folders and variables, not the commands themselves.',
        ),
        cards: [
          {
            id: 'node-vars',
            eyebrow: t('关键变量', 'Key Variables'),
            title: t('Node 里最值得记住的几个变量', 'The Node Variables Worth Remembering'),
            description: t(
              '就算你不手动改变量，也应该知道它们各自负责什么。',
              'Even if you do not edit them manually, you should still know what they control.',
            ),
            envVars: [
              envVar(
                'node-var-path',
                'PATH',
                t(
                  '让终端能直接找到 `node`、`npm` 和相关可执行文件。',
                  'Lets the terminal find `node`, `npm`, and related executables directly.',
                ),
              ),
              envVar(
                'node-var-nvm-dir',
                'NVM_DIR',
                t('告诉 shell `nvm` 根目录在哪里。', 'Tells the shell where the `nvm` root directory is.'),
              ),
              envVar(
                'node-var-cache',
                'npm_config_cache',
                t('控制 npm 下载缓存位置。', 'Controls where npm stores downloaded package caches.'),
              ),
              envVar(
                'node-var-prefix',
                'npm_config_prefix',
                t('控制 `npm install -g` 的全局安装位置。', 'Controls where `npm install -g` stores global packages.'),
              ),
            ],
          },
          {
            id: 'node-path-examples',
            eyebrow: t('路径示例', 'Path Examples'),
            title: t('Node 模板里的默认目录长什么样', 'What the Default Node Directories Look Like'),
            description: t(
              'EnvSetup 的默认模板不只定义 Node 版本，也会定义 cache 和 global prefix 目录。',
              'EnvSetup’s default template defines more than a Node version. It also defines cache and global prefix folders.',
            ),
            codeSamples: [
              sample(
                'node-path-toolchain-mac',
                `${MAC_TOOLCHAIN}`,
                t('macOS installRootDir 示例', 'macOS installRootDir example'),
                'darwin',
              ),
              sample(
                'node-path-cache-mac',
                `${MAC_ROOT}/npm-cache`,
                t('macOS npmCacheDir 示例', 'macOS npmCacheDir example'),
                'darwin',
              ),
              sample(
                'node-path-global-mac',
                `${MAC_ROOT}/npm-global`,
                t('macOS npmGlobalPrefix 示例', 'macOS npmGlobalPrefix example'),
                'darwin',
              ),
              sample(
                'node-path-toolchain-win',
                `${WIN_TOOLCHAIN}`,
                t('Windows installRootDir 示例', 'Windows installRootDir example'),
                'win32',
              ),
              sample(
                'node-path-cache-win',
                `${WIN_ROOT}\\npm-cache`,
                t('Windows npmCacheDir 示例', 'Windows npmCacheDir example'),
                'win32',
              ),
              sample(
                'node-path-global-win',
                `${WIN_ROOT}\\npm-global`,
                t('Windows npmGlobalPrefix 示例', 'Windows npmGlobalPrefix example'),
                'win32',
              ),
            ],
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: t('常见问题', 'Troubleshooting'),
        description: t('Node 报错时，最常见的是版本、PATH 和目录问题。', 'Most Node issues come from version mismatches, PATH problems, or wrong folders.'),
        cards: [
          {
            id: 'node-faq',
            eyebrow: t('排错', 'Troubleshooting'),
            title: t('Node 常见报错怎么想', 'How to Think About Common Node Errors'),
            description: t(
              '先把错误分成“找不到命令”“版本不对”“项目依赖没装”三类。',
              'Split the problem into “command not found”, “wrong version”, or “project dependencies missing” first.',
            ),
            faqs: [
              faq(
                'node-faq-not-found',
                t('`node` / `npm` 提示 command not found 怎么办？', 'What if `node` or `npm` says command not found?'),
                t(
                  '先开一个新终端；如果还是不行，再看 `PATH` 是否包含 Node 目录或 `nvm` 相关初始化脚本。',
                  'Open a new terminal first. If the error remains, check whether `PATH` includes the Node directory or the `nvm` init script.',
                ),
              ),
              faq(
                'node-faq-version',
                t('Node 能跑，但项目还是不工作？', 'What if Node runs but the project still fails?'),
                t(
                  '先用 `node -v` 看版本，再去项目文档、`.nvmrc` 或 CI 版本要求里核对。',
                  'Check `node -v` first, then compare it with the project docs, `.nvmrc`, or CI version requirements.',
                ),
              ),
              faq(
                'node-faq-package-json',
                t('`npm run dev` 报错找不到脚本？', 'What if `npm run dev` says the script is missing?'),
                t(
                  '说明当前目录的 `package.json` 里没有 `dev` 脚本。先确认目录，再打开 `package.json` 看 `scripts` 字段。',
                  'That means the current folder’s `package.json` has no `dev` script. Confirm the directory first, then inspect the `scripts` field.',
                ),
              ),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'java',
    title: t('Java', 'Java'),
    description: t(
      'Java 这页重点讲 JDK、SDKMAN、`JAVA_HOME`、`PATH` 以及 Maven/Gradle 这类工具为什么依赖它们。',
      'This page focuses on JDKs, SDKMAN, `JAVA_HOME`, `PATH`, and why tools like Maven and Gradle depend on them.',
    ),
    sections: [
      {
        id: 'overview',
        title: t('概览', 'Overview'),
        description: t('先理解 JDK 和运行命令的关系。', 'Start by understanding the relationship between the JDK and Java commands.'),
        cards: [
          {
            id: 'java-basics',
            eyebrow: t('基础概念', 'Core Concepts'),
            title: t('JDK、`java`、`javac` 各自是什么', 'What the JDK, `java`, and `javac` Are'),
            description: t(
              '新手常把 Java 语言、JDK、JRE 和命令本身混在一起看。',
              'Beginners often mix up the Java language, the JDK, the JRE, and the commands themselves.',
            ),
            bullets: [
              bullet(
                t(
                  'JDK 是完整开发包，里面包含 `java`、`javac` 和其他工具。',
                  'The JDK is the full development kit. It includes `java`, `javac`, and other tools.',
                ),
              ),
              bullet(
                t(
                  '`java -version` 主要用来确认运行时是否可用、版本是否正确。',
                  '`java -version` is mainly used to confirm that the runtime works and the version is correct.',
                ),
              ),
              bullet(
                t(
                  '很多 Java 构建工具其实不是“需要 Java 语法”，而是“需要正确的 JDK 路径”。',
                  'Many Java build tools do not merely “need Java syntax”. They need a correct JDK path.',
                ),
              ),
            ],
          },
          {
            id: 'java-envsetup-modes',
            eyebrow: t('项目支持', 'What EnvSetup Supports'),
            title: t('EnvSetup 支持 `jdk` 直装和 `sdkman` 管理', 'EnvSetup Supports Direct `jdk` and Managed `sdkman`'),
            description: t(
              '两种模式都能装 JDK，但使用体验不同：一个偏固定目录，一个偏版本管理。',
              'Both modes install a JDK, but one focuses on a fixed directory and the other on version management.',
            ),
            bullets: [
              bullet(
                t(
                  '`jdk` 模式更像“把一个确定版本的 JDK 直接放好，并把变量指过去”。',
                  '`jdk` mode is closer to “place one fixed JDK version in a directory and point variables at it.”',
                ),
              ),
              bullet(
                t(
                  '`sdkman` 模式更像“先安装管理器，再通过候选版本切换当前 JDK”。',
                  '`sdkman` mode is closer to “install a manager first, then switch the active JDK via candidates.”',
                ),
              ),
            ],
          },
        ],
      },
      {
        id: 'install-modes',
        title: t('安装方式', 'Install Modes'),
        description: t('JDK 直装和 SDKMAN 会生成不同的目录结构。', 'Direct JDK installs and SDKMAN create different layouts.'),
        cards: [
          {
            id: 'java-jdk-mode',
            eyebrow: t('直装模式', 'Direct Install'),
            title: t('`jdk` 模式的目录最直观', '`jdk` Mode Has the Most Direct Folder Layout'),
            description: t(
              '这种模式下，JDK 目录、`JAVA_HOME` 和 `PATH` 的关系最好理解。',
              'In this mode, the relationship between the JDK directory, `JAVA_HOME`, and `PATH` is easiest to understand.',
            ),
            codeSamples: [
              sample(
                'java-jdk-mac',
                `${MAC_TOOLCHAIN}/java-21/bin/java`,
                t('macOS 路径示例', 'macOS path example'),
                'darwin',
              ),
              sample(
                'java-jdk-win',
                `${WIN_TOOLCHAIN}\\java-21\\bin\\java.exe`,
                t('Windows 路径示例', 'Windows path example'),
                'win32',
              ),
            ],
            envVars: [
              envVar(
                'java-java-home',
                'JAVA_HOME',
                t('应指向 JDK 根目录，而不是 `bin` 目录。', 'Should point to the JDK root directory, not the `bin` directory.'),
              ),
            ],
          },
          {
            id: 'java-sdkman-mode',
            eyebrow: t('管理器模式', 'Managed Mode'),
            title: t('`sdkman` 会维护本地 JDK 和当前候选版本', '`sdkman` Maintains Local JDKs and the Active Candidate'),
            description: t(
              '它会生成 `candidates/java/current` 这样的目录结构，所以“当前使用哪个 JDK”是可以切换的。',
              'It creates a layout like `candidates/java/current`, so the active JDK can be switched.',
            ),
            codeSamples: [
              sample(
                'java-sdkman-mac',
                `${MAC_TOOLCHAIN}/sdkman/candidates/java/current/bin/java`,
                t('macOS 当前候选版本', 'macOS current candidate'),
                'darwin',
              ),
              sample(
                'java-sdkman-win',
                `${WIN_TOOLCHAIN}\\sdkman\\candidates\\java\\current\\bin\\java.exe`,
                t('Windows 当前候选版本', 'Windows current candidate'),
                'win32',
              ),
              sample(
                'java-sdk-list',
                'sdk list java',
                t('查看可用 JDK', 'List available JDKs'),
                'darwin',
              ),
              sample(
                'java-sdk-install',
                'sdk install java 21-tem',
                t('安装一个 JDK 候选版本', 'Install one JDK candidate'),
                'darwin',
              ),
            ],
            pitfall: t(
              '如果你在 Windows 上看 SDKMAN 相关命令，要记住它本质上依赖 shell 环境，不是普通的“点一下就完”的图形安装器。',
              'If you use SDKMAN-related commands on Windows, remember that it depends on a shell environment. It is not a simple graphical installer.',
            ),
          },
        ],
      },
      {
        id: 'commands',
        title: t('常用命令', 'Common Commands'),
        description: t('Java 日常最常用的是确认版本和确认变量。', 'In daily Java work, the most common checks are version and environment variables.'),
        cards: [
          {
            id: 'java-verify',
            eyebrow: t('版本确认', 'Version Checks'),
            title: t('先确认 Java 和编译器都可用', 'Confirm That Java and the Compiler Are Available'),
            description: t(
              '先看运行时，再看编译器，能区分“只装了运行环境”还是“完整 JDK 可用”。',
              'Check the runtime first and then the compiler. That separates “runtime only” from “a full usable JDK”.',
            ),
            codeSamples: [
              sample('java-version', 'java -version'),
              sample('javac-version', 'javac -version'),
            ],
          },
          {
            id: 'java-home-check',
            eyebrow: t('变量检查', 'Variable Checks'),
            title: t('确认 `JAVA_HOME` 指向哪里', 'Confirm Where `JAVA_HOME` Points'),
            description: t(
              '很多 Maven、Gradle、IDE 问题，根源不是 Java 语法，而是 `JAVA_HOME` 指错了。',
              'Many Maven, Gradle, and IDE problems are not Java syntax issues. They come from `JAVA_HOME` pointing to the wrong place.',
            ),
            codeSamples: [
              sample(
                'java-echo-home-mac',
                'echo $JAVA_HOME',
                t('macOS / Linux', 'macOS / Linux'),
                'darwin',
              ),
              sample(
                'java-echo-home-win',
                '$env:JAVA_HOME',
                t('Windows PowerShell', 'Windows PowerShell'),
                'win32',
              ),
            ],
          },
        ],
      },
      {
        id: 'env-and-paths',
        title: t('环境变量与路径', 'Environment Variables and Paths'),
        description: t('Java 相关问题里，变量和路径几乎永远值得先查。', 'With Java issues, variables and paths are almost always worth checking first.'),
        cards: [
          {
            id: 'java-vars',
            eyebrow: t('关键变量', 'Key Variables'),
            title: t('Java 最关键的是 `JAVA_HOME` 和 `PATH`', 'The Key Java Variables Are `JAVA_HOME` and `PATH`'),
            description: t(
              '大多数 Java 工具都会间接依赖这两个变量。',
              'Most Java tools depend on these two variables directly or indirectly.',
            ),
            envVars: [
              envVar(
                'java-var-home',
                'JAVA_HOME',
                t('指定 JDK 根目录，是很多 Java 工具查找 JDK 的第一入口。', 'Points to the JDK root directory and is the first lookup path for many Java tools.'),
              ),
              envVar(
                'java-var-path',
                'PATH',
                t('让终端直接找到 `java`、`javac` 等命令。', 'Lets the terminal find `java`, `javac`, and related commands directly.'),
              ),
            ],
          },
          {
            id: 'java-path-examples',
            eyebrow: t('路径示例', 'Path Examples'),
            title: t('Java 模板的默认目录示例', 'Default Java Template Path Examples'),
            description: t(
              '知识页里的路径示例都是为了帮助你识别目录结构，不要求和你的机器一模一样。',
              'The path examples here are meant to help you recognize the structure, not to match your machine exactly.',
            ),
            codeSamples: [
              sample(
                'java-path-mac',
                `${MAC_TOOLCHAIN}/java-21`,
                t('macOS 直装 JDK 目录', 'macOS direct JDK directory'),
                'darwin',
              ),
              sample(
                'java-sdkman-path-mac',
                `${MAC_TOOLCHAIN}/sdkman/local/java-21`,
                t('macOS SDKMAN 本地 payload', 'macOS SDKMAN local payload'),
                'darwin',
              ),
              sample(
                'java-path-win',
                `${WIN_TOOLCHAIN}\\java-21`,
                t('Windows 直装 JDK 目录', 'Windows direct JDK directory'),
                'win32',
              ),
              sample(
                'java-sdkman-path-win',
                `${WIN_TOOLCHAIN}\\sdkman\\local\\java-21`,
                t('Windows SDKMAN 本地 payload', 'Windows SDKMAN local payload'),
                'win32',
              ),
            ],
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: t('常见问题', 'Troubleshooting'),
        description: t('Java 报错时，版本和变量通常比源码更值得先查。', 'When Java fails, the version and variables usually matter more than the source code at first.'),
        cards: [
          {
            id: 'java-faq',
            eyebrow: t('排错', 'Troubleshooting'),
            title: t('Java 常见问题怎么排', 'How to Debug Common Java Problems'),
            description: t('很多问题都能先用版本和变量定位。', 'Many Java issues can be located through version and variable checks first.'),
            faqs: [
              faq(
                'java-faq-command',
                t('`java` 能跑但 `javac` 不行？', 'What if `java` works but `javac` does not?'),
                t(
                  '先怀疑不是完整 JDK，或者 `PATH` 里引用了错误目录。`javac -version` 能最快确认。',
                  'Suspect that this is not a full JDK or that `PATH` points to the wrong directory. `javac -version` confirms this quickly.',
                ),
              ),
              faq(
                'java-faq-home',
                t('Maven / IDE 提示找不到 JDK？', 'What if Maven or the IDE cannot find the JDK?'),
                t(
                  '优先检查 `JAVA_HOME`，确认它是否指向 JDK 根目录，而不是 `bin` 或旧版本目录。',
                  'Check `JAVA_HOME` first. Make sure it points to the JDK root directory, not `bin` or an outdated version folder.',
                ),
              ),
              faq(
                'java-faq-version',
                t('Java 版本不对怎么办？', 'What if the Java version is wrong?'),
                t(
                  '先跑 `java -version`；如果是 SDKMAN 模式，再看当前 `current` 候选版本是不是你想用的那个。',
                  'Run `java -version` first. If you use SDKMAN, also check whether the active `current` candidate is the one you expected.',
                ),
              ),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'python',
    title: t('Python', 'Python'),
    description: t(
      'Python 这页会同时讲解释器、`pip`、`venv`、Conda，以及它们和 EnvSetup 模板的关系。',
      'This page covers the interpreter, `pip`, `venv`, Conda, and how they relate to EnvSetup templates.',
    ),
    sections: [
      {
        id: 'overview',
        title: t('概览', 'Overview'),
        description: t('先把解释器、包管理和虚拟环境分开看。', 'Start by separating the interpreter, package management, and virtual environments.'),
        cards: [
          {
            id: 'python-basics',
            eyebrow: t('基础概念', 'Core Concepts'),
            title: t('Python、`pip`、`venv`、Conda 分别是什么', 'What Python, `pip`, `venv`, and Conda Each Are'),
            description: t(
              'Python 新手最容易混淆的是“语言本体”和“环境管理方式”。',
              'Python beginners most often confuse the language itself with environment management.',
            ),
            bullets: [
              bullet(
                t(
                  '`python` / `python3` 是解释器命令，决定代码由哪个 Python 版本执行。',
                  '`python` or `python3` is the interpreter command. It decides which Python version runs the code.',
                ),
              ),
              bullet(
                t(
                  '`pip` 是包管理器，用来安装依赖，但它会装到“当前解释器对应的环境”里。',
                  '`pip` is the package manager, but it installs into whichever environment belongs to the current interpreter.',
                ),
              ),
              bullet(
                t(
                  '`venv` 是 Python 自带的轻量隔离方案，Conda 是更完整的环境管理方案。',
                  '`venv` is Python’s built-in lightweight isolation system, while Conda is a fuller environment manager.',
                ),
              ),
            ],
          },
          {
            id: 'python-envsetup-modes',
            eyebrow: t('项目支持', 'What EnvSetup Supports'),
            title: t(
              'EnvSetup 支持 `python`、`conda`，以及 macOS 的 `pkg`',
              'EnvSetup Supports `python`, `conda`, and macOS `pkg`',
            ),
            description: t(
              '也就是说，你既可以装“一个可直接运行的 Python”，也可以装“一个带环境管理能力的 Miniconda”。',
              'That means you can install either a directly runnable Python or a Miniconda setup that also manages environments.',
            ),
            bullets: [
              bullet(
                t(
                  '`python` 模式适合“我只需要一个稳定 Python 解释器”的场景。',
                  '`python` mode is best when you just need one stable Python interpreter.',
                ),
              ),
              bullet(
                t(
                  '`conda` 模式适合多个项目、多环境切换，或者依赖更复杂的场景。',
                  '`conda` mode is better for multiple projects, multiple environments, or more complex dependencies.',
                ),
              ),
              bullet(
                t(
                  '`pkg` 只在 macOS 下出现，本质上仍然是 Python 官方安装包路径。',
                  '`pkg` only appears on macOS. It is still a Python official installer path under the hood.',
                ),
              ),
            ],
          },
        ],
      },
      {
        id: 'install-modes',
        title: t('安装方式与环境管理', 'Install Modes and Environment Management'),
        description: t('Python 不只要装解释器，还要考虑后续怎么隔离依赖。', 'With Python, installing the interpreter is only half the story. You also need to isolate dependencies.'),
        cards: [
          {
            id: 'python-direct-mode',
            eyebrow: t('直装模式', 'Direct Install'),
            title: t('`python` / `pkg` 模式先给你一个解释器', '`python` / `pkg` Mode Gives You an Interpreter First'),
            description: t(
              '装完以后，你通常还会再决定要不要给项目额外创建 `venv`。',
              'After installation, you usually still decide whether each project should get its own `venv`.',
            ),
            codeSamples: [
              sample(
                'python-direct-mac',
                `${MAC_TOOLCHAIN}/python-3.12.10/bin/python3`,
                t('macOS 路径示例', 'macOS path example'),
                'darwin',
              ),
              sample(
                'python-direct-win',
                `${WIN_TOOLCHAIN}\\python-3.12.10\\python.exe`,
                t('Windows 路径示例', 'Windows path example'),
                'win32',
              ),
              sample(
                'python-venv-create',
                'python -m venv .venv',
                t('给项目创建 venv', 'Create a project venv'),
              ),
            ],
            pitfall: t(
              '安装了 Python 不等于已经有项目级虚拟环境，这两件事是分开的。',
              'Installing Python does not mean you already have a project-level virtual environment. Those are separate steps.',
            ),
          },
          {
            id: 'python-conda-mode',
            eyebrow: t('管理器模式', 'Managed Mode'),
            title: t('`conda` 模式同时管理解释器和环境', '`conda` Manages Both the Interpreter and Environments'),
            description: t(
              'Conda 不只是装 Python，还管理 base 环境和你创建出来的其他环境。',
              'Conda does more than install Python. It manages the base environment and any environments you create later.',
            ),
            codeSamples: [
              sample(
                'python-conda-root-mac',
                `${MAC_TOOLCHAIN}/miniconda3/bin/python`,
                t('macOS base 环境入口', 'macOS base environment entry'),
                'darwin',
              ),
              sample(
                'python-conda-root-win',
                `${WIN_TOOLCHAIN}\\miniconda3\\python.exe`,
                t('Windows base 环境入口', 'Windows base environment entry'),
                'win32',
              ),
              sample(
                'python-conda-create',
                'conda create -n myenv python=3.12',
                t('创建 Conda 环境', 'Create a Conda environment'),
              ),
              sample(
                'python-conda-activate',
                'conda activate myenv',
                t('激活 Conda 环境', 'Activate a Conda environment'),
              ),
            ],
            envVars: [
              envVar(
                'python-conda-prefix',
                'CONDA_PREFIX',
                t('表示当前激活的 Conda 环境目录。', 'Points to the currently active Conda environment directory.'),
              ),
            ],
          },
          {
            id: 'python-venv-flow',
            eyebrow: t('项目隔离', 'Project Isolation'),
            title: t('`venv` 依然值得学，因为它和解释器安装不是一回事', '`venv` Is Still Worth Learning Because It Is Separate from Interpreter Installation'),
            description: t(
              '就算你已经通过 EnvSetup 装好了 Python，很多项目仍然建议你为项目单独建一个 `venv`。',
              'Even after EnvSetup installs Python, many projects still expect you to create a separate `venv` for that project.',
            ),
            codeSamples: [
              sample(
                'python-venv-activate-mac',
                'source .venv/bin/activate',
                t('macOS / Linux 激活', 'macOS / Linux activation'),
                'darwin',
              ),
              sample(
                'python-venv-activate-win',
                '.venv\\Scripts\\Activate.ps1',
                t('Windows PowerShell 激活', 'Windows PowerShell activation'),
                'win32',
              ),
              sample('python-venv-deactivate', 'deactivate', t('退出 venv', 'Leave the venv')),
            ],
          },
        ],
      },
      {
        id: 'commands',
        title: t('常用命令', 'Common Commands'),
        description: t('Python 最常见的是版本确认、包安装和环境激活。', 'With Python, the most common actions are version checks, package installation, and environment activation.'),
        cards: [
          {
            id: 'python-verify',
            eyebrow: t('版本确认', 'Version Checks'),
            title: t('先确认解释器和 `pip` 指向的是谁', 'Confirm Which Interpreter and `pip` You Are Using'),
            description: t(
              'Python 里最怕“命令能跑，但跑的不是你以为的那个解释器”。',
              'In Python, the dangerous case is when the command runs but uses a different interpreter than you expected.',
            ),
            codeSamples: [
              sample('python-version-check', 'python --version'),
              sample('python-pip-version-check', 'pip --version'),
              sample('python-which-python', 'which python', t('macOS / Linux 查解释器', 'macOS / Linux interpreter lookup'), 'darwin'),
              sample('python-which-win', 'Get-Command python', t('Windows 查解释器', 'Windows interpreter lookup'), 'win32'),
            ],
          },
          {
            id: 'python-install-packages',
            eyebrow: t('依赖安装', 'Package Installation'),
            title: t('安装依赖前先确认环境，再执行 `pip install`', 'Confirm the Environment Before Running `pip install`'),
            description: t(
              'Python 的依赖问题常常不是包本身出错，而是装到了错误的解释器里。',
              'Many Python dependency problems come not from the package itself but from installing into the wrong interpreter.',
            ),
            codeSamples: [
              sample('python-pip-install', 'pip install requests', t('安装一个包', 'Install one package')),
              sample('python-pip-freeze', 'pip freeze', t('查看当前环境依赖', 'List current environment dependencies')),
            ],
            pitfall: t(
              '如果你没有先激活 `venv` / Conda 环境，`pip install` 很可能会装到全局解释器里。',
              'If you do not activate the `venv` or Conda environment first, `pip install` often goes into the global interpreter instead.',
            ),
          },
        ],
      },
      {
        id: 'env-and-paths',
        title: t('环境变量与路径', 'Environment Variables and Paths'),
        description: t('Python 的变量问题通常表现成“装对了，但运行错了”。', 'Python variable issues usually look like “installation succeeded, but the wrong thing runs”.'),
        cards: [
          {
            id: 'python-vars',
            eyebrow: t('关键变量', 'Key Variables'),
            title: t('Python 里最重要的是 `PATH` 和 Conda 活动环境', 'The Most Important Python Signals Are `PATH` and the Active Conda Environment'),
            description: t(
              'Python 没有一个统一的 `PYTHON_HOME` 约定，所以“当前解释器是谁”通常靠路径和环境激活状态来判断。',
              'Python has no single standard `PYTHON_HOME` convention, so the active interpreter is usually inferred from paths and environment activation.',
            ),
            envVars: [
              envVar(
                'python-var-path',
                'PATH',
                t('决定终端默认先找到哪个 Python 可执行文件。', 'Decides which Python executable the terminal finds first.'),
              ),
              envVar(
                'python-var-conda-prefix',
                'CONDA_PREFIX',
                t('当你激活 Conda 环境时，它会指向当前环境目录。', 'When you activate a Conda environment, it points to that environment directory.'),
              ),
            ],
          },
          {
            id: 'python-path-examples',
            eyebrow: t('路径示例', 'Path Examples'),
            title: t('Python 模板里的默认目录示例', 'Default Python Template Path Examples'),
            description: t(
              '理解这些路径后，你就更容易看懂“base 环境”和“项目 venv”为什么是两层概念。',
              'Once these paths make sense, it becomes clearer why the Conda base environment and a project `venv` are separate layers.',
            ),
            codeSamples: [
              sample(
                'python-path-mac',
                `${MAC_TOOLCHAIN}/python-3.12.10/bin/python3`,
                t('macOS 直装 Python', 'macOS direct Python'),
                'darwin',
              ),
              sample(
                'python-path-conda-mac',
                `${MAC_TOOLCHAIN}/miniconda3/envs/myenv/bin/python`,
                t('macOS Conda 环境示例', 'macOS Conda environment example'),
                'darwin',
              ),
              sample(
                'python-path-win',
                `${WIN_TOOLCHAIN}\\python-3.12.10\\python.exe`,
                t('Windows 直装 Python', 'Windows direct Python'),
                'win32',
              ),
              sample(
                'python-path-conda-win',
                `${WIN_TOOLCHAIN}\\miniconda3\\envs\\myenv\\python.exe`,
                t('Windows Conda 环境示例', 'Windows Conda environment example'),
                'win32',
              ),
            ],
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: t('常见问题', 'Troubleshooting'),
        description: t('Python 出问题时，先分清“解释器错了”还是“包没装对”。', 'When Python fails, first decide whether the interpreter is wrong or the package installation is wrong.'),
        cards: [
          {
            id: 'python-faq',
            eyebrow: t('排错', 'Troubleshooting'),
            title: t('Python 常见问题怎么排', 'How to Debug Common Python Problems'),
            description: t('优先围绕解释器、环境激活和 `pip` 指向来排。', 'Start with the interpreter, environment activation, and where `pip` points.'),
            faqs: [
              faq(
                'python-faq-pip',
                t('明明装了包，运行时却说模块不存在？', 'What if a package was installed but import still fails?'),
                t(
                  '通常是包装到了错误环境。先查 `python --version`、`pip --version`、再确认当前虚拟环境是否已激活。',
                  'The package is usually installed into the wrong environment. Check `python --version`, `pip --version`, and confirm the current virtual environment is activated.',
                ),
              ),
              faq(
                'python-faq-conda',
                t('`conda activate` 不生效怎么办？', 'What if `conda activate` does not work?'),
                t(
                  '很多时候是当前 shell 还没有加载 Conda 初始化脚本。优先开一个新终端，再确认 Conda 安装路径。',
                  'Often the current shell has not loaded the Conda initialization script. Open a new terminal first, then confirm the Conda install path.',
                ),
              ),
              faq(
                'python-faq-venv',
                t('激活 `venv` 后依然像没激活？', 'What if a `venv` still seems inactive after activation?'),
                t(
                  '先看提示符是否变化，再跑 `which python` 或 `Get-Command python` 确认当前解释器路径。',
                  'Check whether the prompt changed, then run `which python` or `Get-Command python` to confirm the active interpreter path.',
                ),
              ),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'git',
    title: t('Git', 'Git'),
    description: t(
      'Git 这页会讲工作区、暂存区、提交、远端同步，以及项目里支持的直装 / Homebrew / Scoop 模式。',
      'This page covers the working tree, staging area, commits, remote sync, and the direct / Homebrew / Scoop modes supported in the project.',
    ),
    sections: [
      {
        id: 'overview',
        title: t('概览', 'Overview'),
        description: t('Git 先学概念，再学命令。', 'With Git, learn the model first and the commands second.'),
        cards: [
          {
            id: 'git-concepts',
            eyebrow: t('基础概念', 'Core Concepts'),
            title: t('工作区、暂存区、提交的关系', 'How the Working Tree, Staging Area, and Commits Relate'),
            description: t(
              '很多 Git 命令看起来难，是因为你没把这三层分开。',
              'Many Git commands only seem hard because these three layers are not separated clearly.',
            ),
            bullets: [
              bullet(
                t(
                  '工作区是你当前正在编辑的文件状态。',
                  'The working tree is the current state of the files you are editing.',
                ),
              ),
              bullet(
                t(
                  '暂存区是“准备进入下一次提交”的内容集合。',
                  'The staging area is the set of changes prepared for the next commit.',
                ),
              ),
              bullet(
                t('提交是已经被 Git 正式记录的一次快照。', 'A commit is the snapshot Git has officially recorded.'),
              ),
            ],
          },
          {
            id: 'git-envsetup-modes',
            eyebrow: t('项目支持', 'What EnvSetup Supports'),
            title: t('Git 支持直装、Homebrew 和 Scoop', 'Git Supports Direct Install, Homebrew, and Scoop'),
            description: t(
              'Git 功能本身变化不大，主要差异在安装目录和后续卸载方式。',
              'Git behaves similarly in all modes. The real differences are install paths and cleanup flows.',
            ),
            bullets: [
              bullet(
                t('`git` 直装会把 Git 本体放到 `toolchain/git` 下。', 'Direct `git` install places Git itself under `toolchain/git`.'),
              ),
              bullet(
                t(
                  'macOS 下的 Homebrew、Windows 下的 Scoop 更像“把 Git 交给系统包管理器维护”。',
                  'Homebrew on macOS and Scoop on Windows are closer to “let the package manager own Git.”',
                ),
              ),
            ],
          },
        ],
      },
      {
        id: 'commands',
        title: t('常用命令', 'Common Commands'),
        description: t('新手最常用的是查看改动、暂存、提交、拉取和推送。', 'Beginners mostly use status, staging, committing, pulling, and pushing.'),
        cards: [
          {
            id: 'git-daily',
            eyebrow: t('日常协作', 'Daily Collaboration'),
            title: t('最常用的 Git 命令组合', 'The Git Command Sequence You Will Use Most'),
            description: t(
              '日常最典型的一套流程是：看状态 -> 暂存 -> 提交 -> 同步远端。',
              'The most typical daily flow is: inspect -> stage -> commit -> sync with the remote.',
            ),
            codeSamples: [
              sample('git-status', 'git status'),
              sample('git-add-all', 'git add .'),
              sample('git-add-file', 'git add src/renderer/App.tsx'),
              sample('git-commit', 'git commit -m "新增新手知识页"'),
              sample('git-pull', 'git pull'),
              sample('git-push', 'git push'),
            ],
            pitfall: t(
              '不要把“还没确认的所有改动”直接 `git add .`。先看 `git status`，再决定范围。',
              'Do not `git add .` before confirming everything that changed. Inspect with `git status` first and only then decide the scope.',
            ),
          },
          {
            id: 'git-inspection',
            eyebrow: t('补充命令', 'Extra Inspection Commands'),
            title: t('查看分支和提交历史也很重要', 'Viewing Branches and History Is Also Important'),
            description: t(
              '当你不知道自己现在在哪个分支、最近发生了什么时，这些命令很好用。',
              'These commands are useful when you are unsure which branch you are on or what happened recently.',
            ),
            codeSamples: [
              sample('git-branch', 'git branch', t('查看本地分支', 'Show local branches')),
              sample('git-log', 'git log --oneline -5', t('查看最近 5 次提交', 'Show the latest 5 commits')),
            ],
          },
        ],
      },
      {
        id: 'env-and-paths',
        title: t('环境变量与路径', 'Environment Variables and Paths'),
        description: t('Git 的变量不如 Java 那么多，但 `PATH` 仍然很关键。', 'Git uses fewer variables than Java, but `PATH` still matters a lot.'),
        cards: [
          {
            id: 'git-vars',
            eyebrow: t('关键变量', 'Key Variables'),
            title: t('Git 最重要的仍然是 `PATH`', 'For Git, `PATH` Is Still the Main Variable'),
            description: t(
              '大多数“终端里没有 git 命令”的问题，本质上都是找不到可执行文件。',
              'Most “git command is missing” errors are simply executable lookup problems.',
            ),
            envVars: [
              envVar(
                'git-var-path',
                'PATH',
                t(
                  '告诉终端去哪里找 `git` 可执行文件。',
                  'Tells the terminal where to look for the `git` executable.',
                ),
              ),
            ],
          },
          {
            id: 'git-path-examples',
            eyebrow: t('路径示例', 'Path Examples'),
            title: t('Git 不同安装方式的典型路径', 'Typical Paths for Different Git Install Modes'),
            description: t(
              '同样叫 Git，直装和包管理器模式的最终路径并不一样。',
              'Even though the tool is still Git, direct install and package manager modes end in different directories.',
            ),
            codeSamples: [
              sample(
                'git-path-direct-mac',
                `${MAC_TOOLCHAIN}/git/bin/git`,
                t('macOS 直装 Git', 'macOS direct Git'),
                'darwin',
              ),
              sample(
                'git-path-homebrew',
                '/opt/homebrew/opt/git@2.51.1/bin/git',
                t('macOS Homebrew Git 示例', 'macOS Homebrew Git example'),
                'darwin',
              ),
              sample(
                'git-path-direct-win',
                `${WIN_TOOLCHAIN}\\git\\cmd\\git.exe`,
                t('Windows 直装 Git', 'Windows direct Git'),
                'win32',
              ),
              sample(
                'git-path-scoop',
                '%USERPROFILE%\\scoop\\shims\\git.exe',
                t('Windows Scoop Git 示例', 'Windows Scoop Git example'),
                'win32',
              ),
            ],
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: t('常见问题', 'Troubleshooting'),
        description: t('Git 报错时，先分清是不是仓库问题、提交问题还是同步问题。', 'When Git fails, first decide whether the problem is the repository, the commit, or remote sync.'),
        cards: [
          {
            id: 'git-faq',
            eyebrow: t('排错', 'Troubleshooting'),
            title: t('Git 常见报错怎么分类型', 'How to Classify Common Git Errors'),
            description: t('先把问题归类，会比一味记命令更有效。', 'Classifying the problem first is more useful than memorizing more commands.'),
            faqs: [
              faq(
                'git-faq-repo',
                t('`not a git repository` 是什么意思？', 'What does `not a git repository` mean?'),
                t(
                  '你当前目录不是一个 Git 仓库，或者不在该仓库内部。先 `cd` 到正确目录。',
                  'The current folder is not a Git repository, or you are not inside it. `cd` into the correct folder first.',
                ),
              ),
              faq(
                'git-faq-commit',
                t('为什么 `git commit` 说没有内容可提交？', 'Why does `git commit` say there is nothing to commit?'),
                t(
                  '通常是因为你还没 `git add`，或者你已经提交过了。',
                  'Usually because you have not run `git add` yet, or because everything is already committed.',
                ),
              ),
              faq(
                'git-faq-push',
                t('为什么 `git push` 被拒绝？', 'Why was `git push` rejected?'),
                t(
                  '常见原因是远端比你更新。先 `git pull`，解决冲突后再继续。',
                  'A common reason is that the remote is ahead of you. Run `git pull` first, resolve conflicts if needed, and then continue.',
                ),
              ),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'mysql',
    title: t('MySQL', 'MySQL'),
    description: t(
      'MySQL 这页重点讲客户端 / 服务端、直装与包管理器模式差异、`MYSQL_HOME` / `PATH` 和基本验证命令。',
      'This page focuses on the MySQL client vs. server, direct vs. package-manager modes, `MYSQL_HOME` / `PATH`, and basic verification commands.',
    ),
    sections: [
      {
        id: 'overview',
        title: t('概览', 'Overview'),
        description: t('先分清客户端和服务端。', 'Start by separating the client from the server.'),
        cards: [
          {
            id: 'mysql-basics',
            eyebrow: t('基础概念', 'Core Concepts'),
            title: t('`mysql` 和 `mysqld` 不是同一个命令', '`mysql` and `mysqld` Are Not the Same Command'),
            description: t(
              '很多新手看到 MySQL 能运行，就以为数据库服务一定也已经启动了。',
              'Many beginners assume that if MySQL runs, the database server must also be running. That is not always true.',
            ),
            bullets: [
              bullet(
                t('`mysql` 更偏客户端，用来连数据库、执行 SQL。', '`mysql` is more client-oriented. It connects to the database and runs SQL.'),
              ),
              bullet(
                t('`mysqld` 更偏服务端，用来表示数据库服务程序。', '`mysqld` is the server process for the database service itself.'),
              ),
            ],
          },
          {
            id: 'mysql-envsetup-modes',
            eyebrow: t('项目支持', 'What EnvSetup Supports'),
            title: t('MySQL 支持官方归档直装，也支持平台包管理器', 'MySQL Supports Official Archives and Platform Package Managers'),
            description: t(
              'macOS 包管理器模式是 Homebrew，Windows 包管理器模式是 Scoop。',
              'On macOS the package-manager mode uses Homebrew. On Windows it uses Scoop.',
            ),
            bullets: [
              bullet(
                t('直装模式更像“把 MySQL 本体解到自己的工具目录里”。', 'Direct mode is closer to “unpack MySQL itself into your own tool directory.”'),
              ),
              bullet(
                t('包管理器模式更像“让 Homebrew / Scoop 负责真实安装与卸载”。', 'Package-manager mode is closer to “let Homebrew or Scoop own the real install and uninstall.”'),
              ),
            ],
          },
        ],
      },
      {
        id: 'commands',
        title: t('常用命令', 'Common Commands'),
        description: t('先学确认安装，再学确认能否连上。', 'Learn to verify the install first, then verify the connection.'),
        cards: [
          {
            id: 'mysql-verify',
            eyebrow: t('版本确认', 'Version Checks'),
            title: t('先确认 MySQL 客户端是否可用', 'Confirm the MySQL Client Works First'),
            description: t(
              '这一步只说明命令可用，不等于服务已经启动。',
              'This only proves that the command exists. It does not prove the server is already running.',
            ),
            codeSamples: [
              sample('mysql-version', 'mysql --version'),
              sample('mysql-server-version', 'mysqld --version', t('查看服务端版本', 'Check the server version')),
            ],
          },
          {
            id: 'mysql-connect',
            eyebrow: t('连接验证', 'Connection Checks'),
            title: t('确认你能不能连到数据库', 'Confirm That You Can Reach the Database'),
            description: t(
              '客户端能跑之后，下一步就是看服务是否在监听、账号是否正确。',
              'Once the client runs, the next question is whether the server is listening and the credentials are correct.',
            ),
            codeSamples: [
              sample('mysql-connect-root', 'mysql -u root -p', t('使用 root 登录', 'Sign in as root')),
            ],
          },
        ],
      },
      {
        id: 'env-and-paths',
        title: t('环境变量与路径', 'Environment Variables and Paths'),
        description: t('MySQL 常见问题里也绕不开路径。', 'Path-related issues matter for MySQL too.'),
        cards: [
          {
            id: 'mysql-vars',
            eyebrow: t('关键变量', 'Key Variables'),
            title: t('MySQL 里最常见的是 `MYSQL_HOME` 和 `PATH`', 'The Most Common MySQL Variables Are `MYSQL_HOME` and `PATH`'),
            description: t(
              '不是所有安装方式都会显式设置 `MYSQL_HOME`，但你应该理解它代表什么。',
              'Not every install mode explicitly sets `MYSQL_HOME`, but you should still understand what it means.',
            ),
            envVars: [
              envVar(
                'mysql-var-home',
                'MYSQL_HOME',
                t('通常表示 MySQL 安装根目录。', 'Usually refers to the MySQL installation root directory.'),
              ),
              envVar(
                'mysql-var-path',
                'PATH',
                t('决定终端是否能直接找到 `mysql` 和相关命令。', 'Determines whether the terminal can find `mysql` and related commands directly.'),
              ),
            ],
          },
          {
            id: 'mysql-path-examples',
            eyebrow: t('路径示例', 'Path Examples'),
            title: t('MySQL 默认路径示例', 'Default MySQL Path Examples'),
            description: t(
              '直装与包管理器模式最大的差异之一，就是最终真正的可执行文件在哪里。',
              'One of the biggest differences between direct and package-manager modes is where the real executables finally live.',
            ),
            codeSamples: [
              sample(
                'mysql-direct-mac',
                `${MAC_TOOLCHAIN}/mysql/bin/mysql`,
                t('macOS 直装示例', 'macOS direct example'),
                'darwin',
              ),
              sample(
                'mysql-package-mac',
                '/opt/homebrew/opt/mysql@8.4/bin/mysql',
                t('macOS Homebrew 示例', 'macOS Homebrew example'),
                'darwin',
              ),
              sample(
                'mysql-direct-win',
                `${WIN_TOOLCHAIN}\\mysql\\bin\\mysql.exe`,
                t('Windows 直装示例', 'Windows direct example'),
                'win32',
              ),
              sample(
                'mysql-package-win',
                '%USERPROFILE%\\scoop\\shims\\mysql.exe',
                t('Windows Scoop 示例', 'Windows Scoop example'),
                'win32',
              ),
            ],
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: t('常见问题', 'Troubleshooting'),
        description: t('MySQL 问题通常分为“命令找不到”和“数据库连不上”两类。', 'MySQL problems usually split into “command missing” and “database unavailable”.'),
        cards: [
          {
            id: 'mysql-faq',
            eyebrow: t('排错', 'Troubleshooting'),
            title: t('MySQL 常见问题怎么排', 'How to Debug Common MySQL Problems'),
            description: t('先判断是客户端问题还是服务端问题。', 'First decide whether the problem is on the client side or the server side.'),
            faqs: [
              faq(
                'mysql-faq-command',
                t('`mysql` 命令找不到怎么办？', 'What if the `mysql` command is missing?'),
                t(
                  '先确认安装方式，再看 `PATH` 是否包含 MySQL 的 `bin` 或包管理器 shim 目录。',
                  'Confirm the install mode first, then check whether `PATH` includes the MySQL `bin` directory or the package-manager shim directory.',
                ),
              ),
              faq(
                'mysql-faq-connect',
                t('客户端能跑，但连接不上数据库？', 'What if the client works but cannot connect to the database?'),
                t(
                  '这通常说明命令本体没问题，下一步要查的是服务是否已启动、端口是否可用、账号密码是否正确。',
                  'That usually means the command itself is fine. Next, check whether the service is running, the port is available, and the credentials are correct.',
                ),
              ),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'redis',
    title: t('Redis', 'Redis'),
    description: t(
      'Redis 这页会讲 `redis-server`、`redis-cli`、直装与包管理器差异，以及 Windows 直装为何会出现 Memurai。',
      'This page explains `redis-server`, `redis-cli`, direct vs. package-manager installs, and why Memurai appears in direct Windows installs.',
    ),
    sections: [
      {
        id: 'overview',
        title: t('概览', 'Overview'),
        description: t('先分清服务端和客户端。', 'Start by separating the server from the client.'),
        cards: [
          {
            id: 'redis-basics',
            eyebrow: t('基础概念', 'Core Concepts'),
            title: t('`redis-server` 和 `redis-cli` 分别负责什么', 'What `redis-server` and `redis-cli` Each Do'),
            description: t(
              '一个是服务端，一个是客户端，角色和用途不同。',
              'One is the server and the other is the client. Their roles are different.',
            ),
            bullets: [
              bullet(
                t('`redis-server` 负责真正提供 Redis 服务。', '`redis-server` is the actual Redis server process.'),
              ),
              bullet(
                t('`redis-cli` 是用来连服务、执行命令、做健康检查的客户端。', '`redis-cli` is the client used to connect, run commands, and perform health checks.'),
              ),
            ],
          },
          {
            id: 'redis-envsetup-modes',
            eyebrow: t('项目支持', 'What EnvSetup Supports'),
            title: t('Redis 直装和包管理器模式在 Windows 上差异更大', 'Redis Direct and Package Modes Differ More on Windows'),
            description: t(
              'macOS 直装用的是 Redis 官方源码包；Windows 直装对应的是 Redis 官方合作方 Memurai 开发版。',
              'On macOS, direct install uses the official Redis source archive. On Windows, direct install maps to the Redis partner Memurai Developer build.',
            ),
            pitfall: t(
              '如果你在 Windows 上看到 Memurai，不代表装错了；这正是当前直装模式的真实实现。',
              'If you see Memurai on Windows, that does not mean the install is wrong. That is the current direct-install implementation.',
            ),
          },
        ],
      },
      {
        id: 'commands',
        title: t('常用命令', 'Common Commands'),
        description: t('先确认命令存在，再确认服务是否可连。', 'Confirm the commands exist first, then confirm the service is reachable.'),
        cards: [
          {
            id: 'redis-verify',
            eyebrow: t('版本确认', 'Version Checks'),
            title: t('先看 Redis 命令能不能跑', 'Check Whether the Redis Commands Run'),
            description: t(
              '这一步能告诉你安装和 `PATH` 是否大致正常。',
              'This step tells you whether installation and `PATH` are roughly correct.',
            ),
            codeSamples: [
              sample('redis-server-version', 'redis-server --version'),
              sample('redis-cli-version', 'redis-cli --version'),
            ],
          },
          {
            id: 'redis-connect',
            eyebrow: t('连接验证', 'Connection Checks'),
            title: t('确认 Redis 服务能否响应', 'Confirm That the Redis Service Responds'),
            description: t(
              'Redis 安装好了不等于服务已经在跑，`ping` 是最常见的验证命令。',
              'Installing Redis does not guarantee the service is already running. `ping` is the most common verification command.',
            ),
            codeSamples: [
              sample('redis-cli-ping', 'redis-cli ping'),
            ],
          },
        ],
      },
      {
        id: 'env-and-paths',
        title: t('环境变量与路径', 'Environment Variables and Paths'),
        description: t('Redis 的变量不多，但路径差异非常明显。', 'Redis does not use many variables, but the path differences are very visible.'),
        cards: [
          {
            id: 'redis-vars',
            eyebrow: t('关键变量', 'Key Variables'),
            title: t('Redis 里常见的是 `REDIS_HOME` 和 `PATH`', 'Redis Commonly Uses `REDIS_HOME` and `PATH`'),
            description: t(
              '和 MySQL 类似，不是每种安装方式都会强依赖 `REDIS_HOME`，但理解它有助于识别目录结构。',
              'Like MySQL, not every install mode depends heavily on `REDIS_HOME`, but understanding it helps you read the directory structure.',
            ),
            envVars: [
              envVar(
                'redis-var-home',
                'REDIS_HOME',
                t('通常表示 Redis 安装根目录。', 'Usually refers to the Redis installation root directory.'),
              ),
              envVar(
                'redis-var-path',
                'PATH',
                t('决定终端是否能直接找到 `redis-server` 和 `redis-cli`。', 'Determines whether the terminal can find `redis-server` and `redis-cli` directly.'),
              ),
            ],
          },
          {
            id: 'redis-path-examples',
            eyebrow: t('路径示例', 'Path Examples'),
            title: t('Redis 默认路径示例', 'Default Redis Path Examples'),
            description: t(
              'Redis 在 Windows 直装里最特别，因为最终目录可能带 Memurai 可执行文件。',
              'Redis is especially unusual on Windows direct installs because the final directory may contain Memurai executables.',
            ),
            codeSamples: [
              sample(
                'redis-direct-mac',
                `${MAC_TOOLCHAIN}/redis/src/redis-server`,
                t('macOS 直装示例', 'macOS direct example'),
                'darwin',
              ),
              sample(
                'redis-package-mac',
                '/opt/homebrew/opt/redis/bin/redis-server',
                t('macOS Homebrew 示例', 'macOS Homebrew example'),
                'darwin',
              ),
              sample(
                'redis-direct-win',
                `${WIN_TOOLCHAIN}\\redis\\memurai.exe`,
                t('Windows 直装示例', 'Windows direct example'),
                'win32',
              ),
              sample(
                'redis-package-win',
                '%USERPROFILE%\\scoop\\shims\\redis-server.exe',
                t('Windows Scoop 示例', 'Windows Scoop example'),
                'win32',
              ),
            ],
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: t('常见问题', 'Troubleshooting'),
        description: t('Redis 问题常见在“服务没启动”而不是“客户端命令坏了”。', 'Redis issues often come from the service not running rather than the client command being broken.'),
        cards: [
          {
            id: 'redis-faq',
            eyebrow: t('排错', 'Troubleshooting'),
            title: t('Redis 常见问题怎么排', 'How to Debug Common Redis Problems'),
            description: t('先分清命令是否存在，再看服务是否正在响应。', 'First confirm the commands exist, then check whether the service is actually responding.'),
            faqs: [
              faq(
                'redis-faq-command',
                t('`redis-cli` 找不到怎么办？', 'What if `redis-cli` is missing?'),
                t(
                  '先确认安装方式，再检查 `PATH` 是否指向 Redis 目录或包管理器 shim 目录。',
                  'Confirm the install mode first, then check whether `PATH` points to the Redis directory or the package-manager shim directory.',
                ),
              ),
              faq(
                'redis-faq-ping',
                t('`redis-cli ping` 不返回 `PONG` 怎么办？', 'What if `redis-cli ping` does not return `PONG`?'),
                t(
                  '优先怀疑 Redis 服务没有启动、端口不对，或者连接的不是预期实例。',
                  'First suspect that the Redis service is not running, the port is wrong, or you are connecting to an unexpected instance.',
                ),
              ),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'maven',
    title: t('Maven', 'Maven'),
    description: t(
      'Maven 这页会讲 `pom.xml`、常用构建命令、`MAVEN_HOME` / `M2_HOME`，以及它和 Java 的依赖关系。',
      'This page covers `pom.xml`, common build commands, `MAVEN_HOME` / `M2_HOME`, and how Maven depends on Java.',
    ),
    sections: [
      {
        id: 'overview',
        title: t('概览', 'Overview'),
        description: t('先明确 Maven 是“构建工具”，不是 Java 本身。', 'Start by remembering that Maven is a build tool, not Java itself.'),
        cards: [
          {
            id: 'maven-basics',
            eyebrow: t('基础概念', 'Core Concepts'),
            title: t('Maven 和 `pom.xml` 是什么关系', 'How Maven and `pom.xml` Relate'),
            description: t(
              '大多数 Maven 命令都不是“无条件可用”，而是要在有 `pom.xml` 的项目目录里执行。',
              'Most Maven commands are not universally valid. They should run in a project folder that contains `pom.xml`.',
            ),
            bullets: [
              bullet(
                t('Maven 负责依赖下载、编译、测试、打包。', 'Maven handles dependency downloads, compilation, testing, and packaging.'),
              ),
              bullet(
                t('`pom.xml` 是 Maven 项目的核心配置文件。', '`pom.xml` is the main configuration file of a Maven project.'),
              ),
            ],
          },
          {
            id: 'maven-envsetup-modes',
            eyebrow: t('项目支持', 'What EnvSetup Supports'),
            title: t('Maven 支持官方归档直装和包管理器模式', 'Maven Supports Official Archive Installs and Package Managers'),
            description: t(
              '直装模式目录更清晰，包管理器模式更接近系统统一维护。',
              'Direct mode gives a clearer directory layout, while package-manager mode fits system-level maintenance better.',
            ),
          },
        ],
      },
      {
        id: 'commands',
        title: t('常用命令', 'Common Commands'),
        description: t('Maven 常用命令都围绕版本、测试和构建。', 'The most common Maven commands revolve around version checks, testing, and building.'),
        cards: [
          {
            id: 'maven-verify',
            eyebrow: t('版本确认', 'Version Checks'),
            title: t('先确认 `mvn` 能跑', 'Confirm That `mvn` Runs First'),
            description: t(
              'Maven 一旦能跑，输出里通常还会顺带告诉你它绑定的是哪个 Java。',
              'Once Maven runs, its output also often tells you which Java it is bound to.',
            ),
            codeSamples: [
              sample('maven-version', 'mvn -version'),
            ],
          },
          {
            id: 'maven-build-commands',
            eyebrow: t('构建命令', 'Build Commands'),
            title: t('最常见的 Maven 构建命令', 'The Most Common Maven Build Commands'),
            description: t(
              '测试、打包和清理是最常见的日常动作。',
              'Testing, packaging, and cleaning are the most common daily actions.',
            ),
            codeSamples: [
              sample('maven-test', 'mvn test', t('运行测试', 'Run tests')),
              sample('maven-package', 'mvn clean package', t('清理并打包', 'Clean and package')),
            ],
          },
        ],
      },
      {
        id: 'env-and-paths',
        title: t('环境变量与路径', 'Environment Variables and Paths'),
        description: t('Maven 的变量问题通常会和 Java 连在一起出现。', 'Maven variable issues usually appear together with Java issues.'),
        cards: [
          {
            id: 'maven-vars',
            eyebrow: t('关键变量', 'Key Variables'),
            title: t('Maven 常见变量：`MAVEN_HOME`、`M2_HOME`、`PATH`', 'Common Maven Variables: `MAVEN_HOME`, `M2_HOME`, and `PATH`'),
            description: t(
              '如果 `mvn` 找不到，或者 Maven 绑定了错误 Java，这几个变量都值得看。',
              'If `mvn` is missing or Maven uses the wrong Java, these variables are all worth checking.',
            ),
            envVars: [
              envVar(
                'maven-var-home',
                'MAVEN_HOME',
                t('通常表示 Maven 安装根目录。', 'Usually refers to the Maven installation root directory.'),
              ),
              envVar(
                'maven-var-m2-home',
                'M2_HOME',
                t('很多老文档仍会提到它，本质上也是 Maven 根目录概念。', 'Many older docs still mention it. It also refers to the Maven root concept.'),
              ),
              envVar(
                'maven-var-path',
                'PATH',
                t('让终端能直接找到 `mvn`。', 'Lets the terminal find `mvn` directly.'),
              ),
            ],
          },
          {
            id: 'maven-path-examples',
            eyebrow: t('路径示例', 'Path Examples'),
            title: t('Maven 默认路径示例', 'Default Maven Path Examples'),
            description: t(
              '直装模式通常在 `toolchain` 下直接看到版本号目录；包管理器模式则更像系统路径。',
              'Direct mode usually shows a versioned directory under `toolchain`, while package-manager mode looks more like a system path.',
            ),
            codeSamples: [
              sample(
                'maven-direct-mac',
                `${MAC_TOOLCHAIN}/maven-3.9.11/bin/mvn`,
                t('macOS 直装示例', 'macOS direct example'),
                'darwin',
              ),
              sample(
                'maven-package-mac',
                '/opt/homebrew/opt/maven/bin/mvn',
                t('macOS Homebrew 示例', 'macOS Homebrew example'),
                'darwin',
              ),
              sample(
                'maven-direct-win',
                `${WIN_TOOLCHAIN}\\maven-3.9.11\\bin\\mvn.cmd`,
                t('Windows 直装示例', 'Windows direct example'),
                'win32',
              ),
              sample(
                'maven-package-win',
                '%USERPROFILE%\\scoop\\shims\\mvn.cmd',
                t('Windows Scoop 示例', 'Windows Scoop example'),
                'win32',
              ),
            ],
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: t('常见问题', 'Troubleshooting'),
        description: t('Maven 出问题时，先查 Java，再查 Maven。', 'When Maven fails, check Java first and Maven second.'),
        cards: [
          {
            id: 'maven-faq',
            eyebrow: t('排错', 'Troubleshooting'),
            title: t('Maven 常见问题怎么排', 'How to Debug Common Maven Problems'),
            description: t(
              'Maven 很多错误消息看起来像构建失败，其实是底层 Java 路径或版本问题。',
              'Many Maven errors look like build failures but are actually Java path or version problems underneath.',
            ),
            faqs: [
              faq(
                'maven-faq-command',
                t('`mvn` 找不到怎么办？', 'What if `mvn` is missing?'),
                t(
                  '先确认 Maven 是否安装，再检查 `PATH` 是否包含 Maven 的 `bin` 目录或包管理器 shim 目录。',
                  'Confirm Maven is installed first, then check whether `PATH` contains Maven’s `bin` directory or the package-manager shim directory.',
                ),
              ),
              faq(
                'maven-faq-java',
                t('Maven 能跑，但提示 Java 版本不对？', 'What if Maven runs but says the Java version is wrong?'),
                t(
                  '优先跑 `java -version` 和 `mvn -version` 对照看。很多时候 Maven 绑定到的是另一个 JDK。',
                  'Run `java -version` and `mvn -version` together and compare them. Maven is often bound to a different JDK than expected.',
                ),
              ),
            ],
          },
        ],
      },
    ],
  },
]

export function getBeginnerGuideTopic(toolId: BeginnerGuideToolId): BeginnerGuideTopic {
  return beginnerGuideTopics.find((topic) => topic.id === toolId) ?? beginnerGuideTopics[0]
}
