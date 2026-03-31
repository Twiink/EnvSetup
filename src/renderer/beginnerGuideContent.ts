/**
 * 提供新手知识页使用的静态内容数据和类型。
 */

import type { LocalizedTextInput } from '../shared/locale'

export type BeginnerGuideCodeSample = {
  label?: LocalizedTextInput
  value: string
}

export type BeginnerGuideStep = {
  id: string
  title: LocalizedTextInput
  description?: LocalizedTextInput
  commands?: BeginnerGuideCodeSample[]
}

export type BeginnerGuideItem = {
  id: string
  title: LocalizedTextInput
  description: LocalizedTextInput
  command?: string
  example?: string
  bullets?: LocalizedTextInput[]
  steps?: BeginnerGuideStep[]
  tip?: LocalizedTextInput
  pitfall?: LocalizedTextInput
}

export type BeginnerGuideSection = {
  id: string
  eyebrow: LocalizedTextInput
  title: LocalizedTextInput
  description: LocalizedTextInput
  items: BeginnerGuideItem[]
}

export const beginnerGuideSections: BeginnerGuideSection[] = [
  {
    id: 'start',
    eyebrow: {
      'zh-CN': '开始前先看',
      en: 'Start Here',
    },
    title: {
      'zh-CN': '先看懂命令长什么样',
      en: 'Read Commands Before Running Them',
    },
    description: {
      'zh-CN': '先搞清楚占位符、引号和当前目录，再复制命令，能避免一半以上的新手错误。',
      en: 'Understand placeholders, quotes, and the current folder before pasting commands. That avoids most beginner mistakes.',
    },
    items: [
      {
        id: 'command-shape',
        title: {
          'zh-CN': '命令里的符号是什么意思',
          en: 'What the Symbols Mean',
        },
        description: {
          'zh-CN': '很多教程里的命令不是原样照抄，而是需要把一部分内容替换成你自己的信息。',
          en: 'Many tutorial commands are templates. You usually need to replace part of the text with your own values.',
        },
        bullets: [
          {
            'zh-CN': '`<file>` 表示占位符，要换成真实文件名，比如 `src/renderer/App.tsx`。',
            en: '`<file>` is a placeholder. Replace it with a real file name such as `src/renderer/App.tsx`.',
          },
          {
            'zh-CN': '`\"...\"` 里的内容通常也要换，但引号本身一般保留。',
            en: 'Text inside `\"...\"` usually changes, but the quotes themselves usually stay.',
          },
          {
            'zh-CN': '单独的 `.` 表示“当前目录”，不是随便写的标点。',
            en: 'A single `.` means “the current directory.” It is not random punctuation.',
          },
        ],
        example: 'git commit -m "修复登录页按钮样式"',
        pitfall: {
          'zh-CN':
            '不要把 `<file>`、`<message>` 这种占位符原样复制进去，它们不是命令本身的一部分。',
          en: 'Do not paste placeholders like `<file>` or `<message>` literally. They are not part of the final command.',
        },
      },
      {
        id: 'current-directory',
        title: {
          'zh-CN': '先确认你当前在哪个目录',
          en: 'Check Your Current Directory First',
        },
        description: {
          'zh-CN': '很多命令报错不是命令写错了，而是你在错误的目录里执行了它。',
          en: 'A lot of command failures happen because you ran them in the wrong folder, not because the command is wrong.',
        },
        command: 'pwd',
        example: 'cd /Users/you/project-name',
        bullets: [
          {
            'zh-CN': '`pwd` 会显示你现在所在的目录。',
            en: '`pwd` prints the folder you are currently in.',
          },
          {
            'zh-CN': '`cd 文件夹名` 用来进入目标目录，再执行项目命令。',
            en: 'Use `cd folder-name` to enter the target folder before running project commands.',
          },
        ],
        tip: {
          'zh-CN': '如果你在 Windows PowerShell 里，常用的目录查看命令还包括 `Get-Location`。',
          en: 'If you are in Windows PowerShell, `Get-Location` is another common way to check the current folder.',
        },
      },
    ],
  },
  {
    id: 'git',
    eyebrow: {
      'zh-CN': 'Git',
      en: 'Git',
    },
    title: {
      'zh-CN': '最常见的 Git 命令',
      en: 'The Git Commands You Will Use Most',
    },
    description: {
      'zh-CN': '先掌握查看改动、暂存、提交、拉取和推送，已经够你完成大部分日常协作。',
      en: 'If you can inspect changes, stage them, commit them, pull, and push, you can already handle most daily collaboration.',
    },
    items: [
      {
        id: 'git-status',
        title: {
          'zh-CN': '`git status`',
          en: '`git status`',
        },
        description: {
          'zh-CN': '查看当前仓库有哪些文件改了、哪些已暂存、哪些还没被 Git 跟踪。',
          en: 'Check which files changed, which ones are staged, and which ones are still untracked.',
        },
        command: 'git status',
        bullets: [
          {
            'zh-CN': '几乎所有 Git 操作前都值得先看一眼。',
            en: 'It is worth running before almost every Git action.',
          },
          {
            'zh-CN': '它不会修改文件，属于很安全的检查命令。',
            en: 'It does not change files, so it is a very safe inspection command.',
          },
        ],
        tip: {
          'zh-CN': '如果你只记一个 Git 命令，先记住它。',
          en: 'If you only remember one Git command, remember this one first.',
        },
      },
      {
        id: 'git-add-all',
        title: {
          'zh-CN': '`git add .`',
          en: '`git add .`',
        },
        description: {
          'zh-CN': '把当前目录及其子目录里的改动加入暂存区，准备提交。',
          en: 'Stage changes from the current directory and its subfolders so they are ready to commit.',
        },
        command: 'git add .',
        bullets: [
          {
            'zh-CN': '适合你确认“这批改动都要提交”时使用。',
            en: 'Use it when you are sure all current changes in this area should be committed together.',
          },
          {
            'zh-CN': '它会按你当前所在目录生效，所以目录位置很重要。',
            en: 'It works relative to your current folder, so the folder matters.',
          },
        ],
        pitfall: {
          'zh-CN': '执行前先看 `git status`，避免把不想提交的文件一起暂存。',
          en: 'Run `git status` first so you do not stage files you did not mean to commit.',
        },
      },
      {
        id: 'git-add-file',
        title: {
          'zh-CN': '`git add <file>`',
          en: '`git add <file>`',
        },
        description: {
          'zh-CN': '只暂存一个指定文件，适合你想把改动拆成更小、更清晰的提交。',
          en: 'Stage one specific file. This is useful when you want smaller and cleaner commits.',
        },
        command: 'git add <file>',
        example: 'git add src/renderer/App.tsx',
        bullets: [
          {
            'zh-CN': '比 `git add .` 更稳，更适合新手控制提交范围。',
            en: 'It is safer than `git add .` and better for beginners who want tighter control.',
          },
          {
            'zh-CN': '如果文件路径较长，可以先用 `git status` 复制路径。',
            en: 'If the file path is long, copy it from `git status` first.',
          },
        ],
      },
      {
        id: 'git-commit',
        title: {
          'zh-CN': '`git commit -m "..."`',
          en: '`git commit -m "..."`',
        },
        description: {
          'zh-CN': '把暂存区里的内容保存成一次提交，并写一条说明这次改动的消息。',
          en: 'Save the staged changes as a commit and attach a message that explains what changed.',
        },
        command: 'git commit -m "描述这次改动"',
        example: 'git commit -m "新增新手知识页"',
        bullets: [
          {
            'zh-CN': '`-m` 后面需要有空格，再跟一对引号。',
            en: 'There must be a space after `-m`, followed by a quoted message.',
          },
          {
            'zh-CN': '消息要写“做了什么”，而不是写“终于搞定了”。',
            en: 'The message should explain what changed, not just how you feel about it.',
          },
        ],
        pitfall: {
          'zh-CN': '如果你还没有 `git add`，这条命令通常会提示没有内容可提交。',
          en: 'If you did not run `git add` first, Git will usually say there is nothing to commit.',
        },
      },
      {
        id: 'git-pull',
        title: {
          'zh-CN': '`git pull`',
          en: '`git pull`',
        },
        description: {
          'zh-CN': '把远端仓库的最新提交拉到本地，并尝试和你当前分支合并。',
          en: 'Fetch the latest commits from the remote repository and merge them into your current branch.',
        },
        command: 'git pull',
        bullets: [
          {
            'zh-CN': '开始一天工作前、准备提交前都很常见。',
            en: 'It is common at the start of the day and before pushing your own work.',
          },
          {
            'zh-CN': '如果远端和本地改了同一段内容，可能会出现冲突。',
            en: 'If both local and remote changed the same lines, you may get a merge conflict.',
          },
        ],
        tip: {
          'zh-CN': '先提交或暂存自己的改动，再 `git pull`，通常更稳。',
          en: 'Commit or stash your own work before `git pull` when possible.',
        },
      },
      {
        id: 'git-push',
        title: {
          'zh-CN': '`git push`',
          en: '`git push`',
        },
        description: {
          'zh-CN': '把你本地已经提交的内容上传到远端仓库，让团队成员也能看到。',
          en: 'Upload your local commits to the remote repository so the team can see them.',
        },
        command: 'git push',
        bullets: [
          {
            'zh-CN': '只有提交过的内容才能被推送。',
            en: 'Only committed changes can be pushed.',
          },
          {
            'zh-CN': '如果远端比你更新，通常要先 `git pull` 再继续。',
            en: 'If the remote is ahead of you, you usually need to `git pull` first.',
          },
        ],
        pitfall: {
          'zh-CN': '“我明明改了代码却推不上去” 很多时候是因为你忘了先 `git commit`。',
          en: '“I changed code but cannot push it” often just means you forgot to `git commit` first.',
        },
      },
    ],
  },
  {
    id: 'python',
    eyebrow: {
      'zh-CN': 'Python',
      en: 'Python',
    },
    title: {
      'zh-CN': 'Python 虚拟环境怎么建',
      en: 'How to Create Python Virtual Environments',
    },
    description: {
      'zh-CN': '虚拟环境可以把不同项目的依赖隔离开，避免“这个项目能跑，那个项目却坏了”的连锁问题。',
      en: 'Virtual environments isolate project dependencies so one Python project does not break another.',
    },
    items: [
      {
        id: 'python-choice',
        title: {
          'zh-CN': '先选 `conda` 还是 `venv`',
          en: 'Choose `conda` or `venv` First',
        },
        description: {
          'zh-CN': '两种方式都能创建隔离环境，区别主要在工具生态和适用场景。',
          en: 'Both create isolated environments. The main difference is the surrounding tool ecosystem and the use case.',
        },
        bullets: [
          {
            'zh-CN': '你已经在用 Anaconda / Miniconda 时，优先选 `conda`。',
            en: 'If you already use Anaconda or Miniconda, `conda` is usually the better choice.',
          },
          {
            'zh-CN': '只是普通 Python 项目，电脑里已有 Python 时，`python -m venv` 足够简单。',
            en: 'For a normal Python project with Python already installed, `python -m venv` is usually enough.',
          },
          {
            'zh-CN': '无论选哪种，进入环境后再装依赖，习惯最重要。',
            en: 'Whichever you use, install dependencies after entering the environment.',
          },
        ],
      },
      {
        id: 'conda-workflow',
        title: {
          'zh-CN': '用 Conda 创建和删除环境',
          en: 'Create and Remove an Environment with Conda',
        },
        description: {
          'zh-CN': '适合你已经安装了 Miniconda / Anaconda，或者项目文档明确写了使用 Conda。',
          en: 'Use this when Miniconda or Anaconda is already installed, or when the project docs explicitly use Conda.',
        },
        steps: [
          {
            id: 'conda-create',
            title: {
              'zh-CN': '1. 创建环境',
              en: '1. Create the Environment',
            },
            commands: [{ value: 'conda create -n myenv python=3.12' }],
          },
          {
            id: 'conda-activate',
            title: {
              'zh-CN': '2. 激活环境',
              en: '2. Activate the Environment',
            },
            commands: [{ value: 'conda activate myenv' }],
          },
          {
            id: 'conda-install',
            title: {
              'zh-CN': '3. 安装依赖',
              en: '3. Install Packages',
            },
            commands: [{ value: 'pip install requests' }],
          },
          {
            id: 'conda-deactivate',
            title: {
              'zh-CN': '4. 退出环境',
              en: '4. Leave the Environment',
            },
            commands: [{ value: 'conda deactivate' }],
          },
          {
            id: 'conda-remove',
            title: {
              'zh-CN': '5. 删除环境',
              en: '5. Remove the Environment',
            },
            commands: [{ value: 'conda remove -n myenv --all' }],
          },
        ],
        tip: {
          'zh-CN': '`myenv` 是环境名，换成你自己的项目名会更容易管理。',
          en: '`myenv` is just the environment name. Replace it with your own project name.',
        },
      },
      {
        id: 'venv-workflow',
        title: {
          'zh-CN': '用 `python -m venv` 创建和删除环境',
          en: 'Create and Remove an Environment with `python -m venv`',
        },
        description: {
          'zh-CN': '这是 Python 自带的方案，足够轻量，很多项目都会直接使用。',
          en: 'This is Python’s built-in option. It is lightweight and works well for many projects.',
        },
        steps: [
          {
            id: 'venv-create',
            title: {
              'zh-CN': '1. 创建环境',
              en: '1. Create the Environment',
            },
            commands: [{ value: 'python -m venv .venv' }],
          },
          {
            id: 'venv-activate',
            title: {
              'zh-CN': '2. 激活环境',
              en: '2. Activate the Environment',
            },
            commands: [
              {
                label: {
                  'zh-CN': 'macOS / Linux',
                  en: 'macOS / Linux',
                },
                value: 'source .venv/bin/activate',
              },
              {
                label: {
                  'zh-CN': 'Windows PowerShell',
                  en: 'Windows PowerShell',
                },
                value: '.venv\\Scripts\\Activate.ps1',
              },
            ],
          },
          {
            id: 'venv-install',
            title: {
              'zh-CN': '3. 安装依赖',
              en: '3. Install Packages',
            },
            commands: [{ value: 'pip install requests' }],
          },
          {
            id: 'venv-deactivate',
            title: {
              'zh-CN': '4. 退出环境',
              en: '4. Leave the Environment',
            },
            commands: [{ value: 'deactivate' }],
          },
          {
            id: 'venv-remove',
            title: {
              'zh-CN': '5. 删除环境目录',
              en: '5. Delete the Environment Folder',
            },
            commands: [
              {
                label: {
                  'zh-CN': 'macOS / Linux',
                  en: 'macOS / Linux',
                },
                value: 'rm -rf .venv',
              },
              {
                label: {
                  'zh-CN': 'Windows PowerShell',
                  en: 'Windows PowerShell',
                },
                value: 'Remove-Item -Recurse -Force .venv',
              },
            ],
          },
        ],
        pitfall: {
          'zh-CN': '没有激活环境就直接 `pip install`，依赖很可能会被装到全局 Python 里。',
          en: 'If you run `pip install` before activating the environment, packages often land in global Python instead.',
        },
      },
    ],
  },
  {
    id: 'node',
    eyebrow: {
      'zh-CN': 'Node.js',
      en: 'Node.js',
    },
    title: {
      'zh-CN': 'Node 基础知识和常见命令',
      en: 'Node Basics and Common Commands',
    },
    description: {
      'zh-CN': '很多前端项目都离不开 Node。先分清概念，再记常用命令，学习成本会低很多。',
      en: 'A lot of frontend projects depend on Node. Once the basic terms are clear, the common commands become much easier to learn.',
    },
    items: [
      {
        id: 'node-basics',
        title: {
          'zh-CN': '先分清 Node.js、npm、npx',
          en: 'Know the Difference Between Node.js, npm, and npx',
        },
        description: {
          'zh-CN': '这三个名字经常一起出现，但它们不是一回事。',
          en: 'These three names often appear together, but they are not the same thing.',
        },
        bullets: [
          {
            'zh-CN': '`Node.js` 是运行 JavaScript 的环境。',
            en: '`Node.js` is the runtime that executes JavaScript outside the browser.',
          },
          {
            'zh-CN': '`npm` 是包管理器，用来安装依赖、执行脚本。',
            en: '`npm` is the package manager used to install dependencies and run scripts.',
          },
          {
            'zh-CN': '`npx` 用来临时运行某个包暴露出来的命令。',
            en: '`npx` runs commands exposed by packages, often without a global install.',
          },
        ],
      },
      {
        id: 'node-package-json',
        title: {
          'zh-CN': '`package.json` 和 `node_modules` 是什么',
          en: 'What `package.json` and `node_modules` Are',
        },
        description: {
          'zh-CN': '大多数 Node 项目都围绕这两个名字展开。',
          en: 'Most Node projects revolve around these two names.',
        },
        bullets: [
          {
            'zh-CN': '`package.json` 记录项目名、依赖和可执行脚本。',
            en: '`package.json` stores the project name, dependencies, and runnable scripts.',
          },
          {
            'zh-CN': '`node_modules` 是依赖实际被安装到的目录。',
            en: '`node_modules` is the folder where dependencies are actually installed.',
          },
          {
            'zh-CN': '删除 `node_modules` 不会删掉项目源码，但通常需要重新 `npm install`。',
            en: 'Deleting `node_modules` does not delete your source code, but you will usually need to run `npm install` again.',
          },
        ],
      },
      {
        id: 'node-version',
        title: {
          'zh-CN': '`node -v`',
          en: '`node -v`',
        },
        description: {
          'zh-CN': '查看当前机器正在使用的 Node 版本。',
          en: 'Check which Node version your machine is currently using.',
        },
        command: 'node -v',
        bullets: [
          {
            'zh-CN': '项目跑不起来时，先确认版本是不是项目要求的版本。',
            en: 'If a project will not run, check whether your Node version matches the project requirement.',
          },
        ],
      },
      {
        id: 'npm-version',
        title: {
          'zh-CN': '`npm -v`',
          en: '`npm -v`',
        },
        description: {
          'zh-CN': '查看当前 npm 版本，通常和 Node 一起确认。',
          en: 'Check the npm version. People often verify it together with Node.',
        },
        command: 'npm -v',
      },
      {
        id: 'npm-install',
        title: {
          'zh-CN': '`npm install`',
          en: '`npm install`',
        },
        description: {
          'zh-CN': '根据 `package.json` 和锁文件安装项目依赖。',
          en: 'Install project dependencies based on `package.json` and the lockfile.',
        },
        command: 'npm install',
        bullets: [
          {
            'zh-CN': '克隆项目后通常先执行它。',
            en: 'This is usually the first command you run after cloning a project.',
          },
          {
            'zh-CN': '依赖更新后，别人也常会提醒你重新执行一次。',
            en: 'When dependencies change, people often ask you to run it again.',
          },
        ],
      },
      {
        id: 'npm-run-dev',
        title: {
          'zh-CN': '`npm run dev`',
          en: '`npm run dev`',
        },
        description: {
          'zh-CN': '执行 `package.json` 里的 `dev` 脚本，通常用来启动本地开发环境。',
          en: 'Run the `dev` script from `package.json`. It usually starts the local development environment.',
        },
        command: 'npm run dev',
        example: 'npm run dev',
        tip: {
          'zh-CN': '不是所有项目都有 `dev` 脚本，真正能运行什么要看 `package.json`。',
          en: 'Not every project has a `dev` script. The actual scripts are defined in `package.json`.',
        },
      },
      {
        id: 'npm-run-build',
        title: {
          'zh-CN': '`npm run build`',
          en: '`npm run build`',
        },
        description: {
          'zh-CN': '执行构建脚本，通常把源码打包成可发布产物。',
          en: 'Run the build script, usually to package source code into a deployable output.',
        },
        command: 'npm run build',
      },
      {
        id: 'npm-test',
        title: {
          'zh-CN': '`npm test`',
          en: '`npm test`',
        },
        description: {
          'zh-CN': '执行项目测试。这个仓库里它会运行 Vitest。',
          en: 'Run the project tests. In this repository it runs Vitest.',
        },
        command: 'npm test',
        tip: {
          'zh-CN': '改完代码后跑一次测试，是最基础也最划算的自检。',
          en: 'Running tests after a change is one of the cheapest and most useful self-checks you can do.',
        },
      },
    ],
  },
  {
    id: 'pitfalls',
    eyebrow: {
      'zh-CN': '避坑',
      en: 'Avoid These Mistakes',
    },
    title: {
      'zh-CN': '新手最容易踩的坑',
      en: 'Common Beginner Mistakes',
    },
    description: {
      'zh-CN': '下面这些问题很常见，记住它们能帮你少掉很多重复排查。',
      en: 'These issues come up all the time. Remembering them saves a lot of repeated debugging.',
    },
    items: [
      {
        id: 'pitfall-list',
        title: {
          'zh-CN': '这几条值得反复提醒自己',
          en: 'These Are Worth Repeating to Yourself',
        },
        description: {
          'zh-CN': '如果你一时不知道为什么命令报错，就先按这份清单排查。',
          en: 'If a command fails and you do not know why, start with this checklist.',
        },
        bullets: [
          {
            'zh-CN': '做 Git 提交前，先看 `git status`，再决定是否 `git add .`。',
            en: 'Before committing with Git, run `git status` and only then decide whether `git add .` is appropriate.',
          },
          {
            'zh-CN': 'Python 依赖安装前，先确认自己已经进入了目标虚拟环境。',
            en: 'Before installing Python packages, confirm that you are already inside the intended virtual environment.',
          },
          {
            'zh-CN': 'Node 项目的命令通常要在有 `package.json` 的目录里执行。',
            en: 'Node project commands usually need to be run inside the folder that contains `package.json`.',
          },
          {
            'zh-CN':
              '看到 `command not found`，优先检查：有没有安装、终端有没有重开、目录是不是对的。',
            en: 'When you see `command not found`, check installation, restart the terminal, and confirm the current folder first.',
          },
          {
            'zh-CN': '不要把教程里的占位符、中文说明或尖括号一起复制进终端。',
            en: 'Do not paste placeholders, tutorial notes, or angle brackets directly into the terminal.',
          },
          {
            'zh-CN': '一次只做一件事，出错时就更容易知道是哪一步出了问题。',
            en: 'Do one thing at a time so it is easier to see which step caused the problem.',
          },
        ],
      },
    ],
  },
]
