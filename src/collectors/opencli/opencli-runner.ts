import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { OpenCliCommandSummary, OpenCliStatus } from './opencli-capability.js';

export type SpawnOpenCli = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface OpenCliRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
  parseJson?: boolean;
}

export interface OpenCliRunResult extends OpenCliCommandSummary {
  stdout: string;
  stderr: string;
  data: unknown | null;
}

function boundedMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function classifyOpenCliFailure(text: string, spawnError?: Error): OpenCliStatus {
  const normalized = `${spawnError?.message ?? ''} ${text}`.toLocaleLowerCase();
  if (/enoent|command not found|browser bridge extension not connected|browser not connected|daemon.*not running/.test(normalized)) {
    return 'unavailable';
  }
  if (/auth_required|login required|not logged|no ct0 cookie|登录后|请登录|login wall/.test(normalized)) {
    return 'login_required';
  }
  if (/security_block|安全限制|验证码|captcha|risk control|rate limit|too many requests|verification required|异常访问|blocked/.test(normalized)) {
    return 'blocked';
  }
  return 'command_failed';
}

export class OpenCliRunner {
  constructor(
    private readonly spawnOpenCli: SpawnOpenCli = (command, args, options) => spawn(command, args, options),
    private readonly defaultTimeoutMs = 30_000,
  ) {}

  run(args: readonly string[], options: OpenCliRunOptions = {}): Promise<OpenCliRunResult> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const parseJson = options.parseJson ?? true;

    return new Promise((resolve) => {
      let child: ChildProcess;
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let spawnError: Error | undefined;
      let timeout: NodeJS.Timeout | undefined;

      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        child?.stdout?.destroy();
        child?.stderr?.destroy();

        let data: unknown | null = null;
        let status: OpenCliStatus = exitCode === 0 ? 'success' : classifyOpenCliFailure(`${stderr}\n${stdout}`, spawnError);
        let error = spawnError ? boundedMessage(spawnError.message) : null;

        if (timedOut) {
          status = 'command_failed';
          error = `OpenCLI command timed out after ${timeoutMs}ms`;
        } else if (cancelled) {
          status = 'command_failed';
          error = 'OpenCLI command cancelled';
        } else if (exitCode === 0 && parseJson) {
          try {
            data = JSON.parse(stdout);
          } catch (parseError) {
            status = 'command_failed';
            error = `OpenCLI JSON parse failed: ${boundedMessage(parseError instanceof Error ? parseError.message : String(parseError))}`;
          }
        } else if (exitCode === 0) {
          data = stdout;
          const reportedFailure = classifyOpenCliFailure(`${stderr}\n${stdout}`);
          if (reportedFailure !== 'command_failed') {
            status = reportedFailure;
            error = boundedMessage(stderr || stdout);
          }
        }

        if (!error && status !== 'success') error = boundedMessage(stderr || stdout) || `OpenCLI exited with code ${exitCode ?? 'unknown'}`;
        resolve({
          args: [...args],
          status,
          exit_code: exitCode,
          duration_ms: Math.max(0, Date.now() - startedAt),
          timed_out: timedOut,
          cancelled,
          error,
          stdout,
          stderr,
          data,
        });
      };

      const abort = (): void => {
        cancelled = true;
        child?.kill('SIGTERM');
        const forceKill = setTimeout(() => {
          if (!settled) child?.kill('SIGKILL');
        }, 1_000);
        forceKill.unref();
      };

      if (options.signal?.aborted) {
        cancelled = true;
        finish(null);
        return;
      }

      try {
        child = this.spawnOpenCli('opencli', args, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        spawnError = error instanceof Error ? error : new Error(String(error));
        finish(null);
        return;
      }

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string | Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: string | Buffer) => { stderr += chunk.toString(); });
      child.on('error', (error) => {
        spawnError = error;
        finish(null);
      });
      child.on('close', (code) => finish(code));
      child.on('exit', (code) => {
        const fallback = setTimeout(() => finish(code), 50);
        fallback.unref();
      });
      options.signal?.addEventListener('abort', abort, { once: true });

      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, 1_000).unref();
      }, timeoutMs);
      timeout.unref();
    });
  }
}

export function toCommandSummary(result: OpenCliRunResult): OpenCliCommandSummary {
  const { args, status, exit_code, duration_ms, timed_out, cancelled, error } = result;
  return { args, status, exit_code, duration_ms, timed_out, cancelled, error };
}
