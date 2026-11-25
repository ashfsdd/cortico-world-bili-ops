/**
 * cortico-world-bili-ops —— B站运营薄入口
 *
 * 设计原则（2026-11-19 主人定的）：
 *   1) 只暴露 **一个** 工具（bili_ops），命令怎么用写在本地记忆里，按需查；
 *      绝不把 bili CLI 的 128 条命令说明书每轮塞进上下文。
 *   2) 三账号靠 BILI_CLI_HOME 切换，不重复扫码。
 *   3) 只放行 bili 的子命令，不执行任意 shell。
 *
 * 许可证：MIT
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PROMPT_FILE = join(HERE, 'ENV_PROMPT.md');
let ENV_PROMPT_CACHE = '';
try {
  ENV_PROMPT_CACHE = readFileSync(ENV_PROMPT_FILE, 'utf8');
} catch {
  ENV_PROMPT_CACHE = 'B站运营：需要查数据/发动态时用 bili_ops；命令细节查记忆。';
}

/** bili 可执行文件：默认走 PATH，配置项 `biliBin` 可覆盖成绝对路径。 */
const DEFAULT_BILI_BIN = 'bili';

/** 账号档案根目录：默认取环境变量，配置项 `profileRoot` 可覆盖；空 = 不切账号。 */
const DEFAULT_PROFILE_ROOT = process.env.BILI_PROFILE_ROOT || '';

/** 放行的子命令（只认第一个词）。写操作也在内，但账号错了顶多发错号，不会执行 shell */
const ALLOW = new Set([
  'dynamic', 'data', 'me', 'comment', 'dm', 'upload', 'video', 'feed',
  'user', 'search', 'hot', 'season', 'article', 'danmaku', 'auth', 'owner',
]);

export interface BiliOpsConfig {
  enabled: boolean;
  /** 默认账号：whale / live / main */
  account: string;
  /** 回传正文最大字符数（超了截断，防止把上下文塞爆） */
  maxOutput: number;
  /** bili 可执行文件；留空走 PATH。跨平台/非默认安装位置时填绝对路径。 */
  biliBin: string;
  /** 账号档案根目录；留空则不设置 BILI_CLI_HOME（bili 用默认配置）。 */
  profileRoot: string;
}

const DEFAULT_CONFIG: BiliOpsConfig = {
  enabled: true, account: 'whale', maxOutput: 6000,
  biliBin: DEFAULT_BILI_BIN, profileRoot: DEFAULT_PROFILE_ROOT,
};

interface RunResult {
  ok: boolean;
  account: string;
  cmd: string;
  code: number;
  out: string;
}

export class BiliOpsWorld {
  readonly id = 'bili-ops';
  private cfg: BiliOpsConfig;
  private host: any = null;

  constructor(ctx: any) {
    const raw = (ctx?.cfg ?? {}) as Partial<BiliOpsConfig>;
    this.cfg = { ...DEFAULT_CONFIG, ...raw };
  }

  /** 账号名 → BILI_CLI_HOME；目录不存在时返回 undefined 表示「未知账号」。 */
  private profileOf(acc: string): string | null {
    const root = String(this.cfg.profileRoot || '').trim();
    if (!root) return acc === 'whale' || acc === 'main' || acc === 'live' ? '' : null;
    if (acc === 'whale') return '';
    if (acc === 'main' || acc === 'live') return join(root, acc);
    return null;
  }

  private log(msg: string, extra?: any): void {
    try {
      this.host?.log?.info?.(`[bili-ops] ${msg}`, extra);
    } catch { /* 日志失败不影响主流程 */ }
  }

  envPromptVars(): Record<string, string> {
    return {
      'biliops.account': this.cfg.account || 'whale',
      'biliops.maxOutput': String(this.cfg.maxOutput ?? 6000),
    };
  }

  /** 跑一条 bili 命令 */
  async run(command: string, args: string[], account?: string): Promise<RunResult> {
    const head = String(command || '').trim().split(/\s+/)[0];
    if (!ALLOW.has(head)) {
      return { ok: false, account: '', cmd: head, code: 2, out: `不允许的子命令：${head || '(空)'}` };
    }
    const acc = String(account || this.cfg.account || 'whale');
    const home = this.profileOf(acc);
    if (home === null) {
      return { ok: false, account: acc, cmd: head, code: 2, out: `未知账号：${acc}（可选 main / live / whale）` };
    }

    const env = { ...process.env } as NodeJS.ProcessEnv;
    if (home) env.BILI_CLI_HOME = home;
    else delete env.BILI_CLI_HOME;

    const argv = [String(this.cfg.biliBin || DEFAULT_BILI_BIN), ...String(command).trim().split(/\s+/), ...(args || []).map(String)];
    return await new Promise<RunResult>((resolve) => {
      let out = '';
      let done = false;
      const finish = (code: number) => {
        if (done) return;
        done = true;
        const max = Number(this.cfg.maxOutput) || 6000;
        resolve({
          ok: code === 0,
          account: acc,
          cmd: argv.slice(1).join(' '),
          code,
          out: out.length > max ? `${out.slice(0, max)}\n…（已截断，共 ${out.length} 字）` : out.trim(),
        });
      };
      try {
        const p = spawn(argv[0], argv.slice(1), { env, windowsHide: true });
        const timer = setTimeout(() => {
          try { p.kill(); } catch { /* ignore */ }
          finish(124);
        }, 120_000);
        p.stdout.on('data', (d) => { out += String(d); });
        p.stderr.on('data', (d) => { out += String(d); });
        p.on('error', (e) => { out += String(e); clearTimeout(timer); finish(127); });
        p.on('close', (code) => { clearTimeout(timer); finish(code ?? 1); });
      } catch (e) {
        out += String(e);
        finish(127);
      }
    });
  }

  tools(): any[] {
    return [
      {
        name: 'bili_ops',
        tags: ['read', 'write'],
        description:
          'B站运营唯一入口：转发 bili 命令行并把 JSON 结果带回来。command 只写子命令（如 "data overview"、"dynamic post"），args 按顺序给参数。具体命令清单和注意事项见记忆「B站运营手册」，不确定就先查记忆，不要猜。account 默认 whale，发收尾动态用 live。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            command: {
              type: 'string',
              description: '子命令，空格分隔，例如 "data overview" / "dynamic post" / "upload status"。第一个词必须是 bili 的顶层命令。',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: '按顺序传给命令的参数，例如 ["--room","123456789"]；正文这类长文本也放这里，避免被空格拆开。',
            },
            account: {
              type: 'string',
              enum: ['whale', 'live', 'main'],
              description: '用哪个号跑：whale=AI 小鲸鱼（默认）/ live=直播号 / main=主号。',
            },
          },
          required: ['command'],
        },
        handler: async (p: any) => {
          const r = await this.run(
            String(p?.command ?? ''),
            Array.isArray(p?.args) ? p.args.map(String) : [],
            p?.account ? String(p.account) : undefined,
          );
          this.log('bili_ops', { cmd: r.cmd, account: r.account, ok: r.ok, code: r.code });
          return r.out || `（无输出，退出码 ${r.code}）`;
        },
      },
    ];
  }

  webUi(_language: 'zh' | 'en' = 'zh'): any {
    return {
      label: 'B站运营',
      lamps: [{ label: '入口', state: 'online', hint: 'bili CLI 转发' }],
      badges: [{ label: '默认账号', value: this.cfg.account || 'whale', tone: 'plain' }],
      promptDocs: [
        {
          key: 'worlds.bili-ops.envPrompt',
          title: 'B站运营索引',
          description: '只放工具索引，命令细节在记忆里按需查（不要写进系统提示词）。',
          role: 'envPrompt',
          path: ENV_PROMPT_FILE,
          vars: [
            { name: 'biliops.account', description: '默认用哪个账号跑命令。' },
            { name: 'biliops.maxOutput', description: '单次回传最大字符数。' },
          ],
        },
      ],
    };
  }

  async start(host: any): Promise<void> {
    this.host = host;
    this.log('started', { account: this.cfg.account });
  }

  async stop(): Promise<void> {
    this.host = null;
  }
}

export const BILI_OPS = {
  id: 'bili-ops',
  label: 'B站运营',
  defaults: (): BiliOpsConfig => ({ ...DEFAULT_CONFIG }),
  describe: {
    tools: [
      {
        name: 'bili_ops',
        description: 'B站运营唯一入口：转发 bili 命令行，具体命令见记忆「B站运营手册」。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            command: { type: 'string', description: '子命令，例如 data overview' },
            args: { type: 'array', items: { type: 'string' }, description: '按顺序的参数' },
            account: { type: 'string', enum: ['whale', 'live', 'main'], description: '用哪个号' },
          },
          required: ['command'],
        },
        tags: ['read', 'write'],
        summary: { zh: 'B站运营：发动态 / 看数据 / 回评论 / 查投稿', en: 'Bilibili ops via CLI' },
      },
    ],
  },
  create: (ctx: any) => new BiliOpsWorld(ctx),
};

export default BILI_OPS;
