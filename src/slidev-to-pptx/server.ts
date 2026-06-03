import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';

export interface ServerOptions {
  deckPath: string;
  port: number;
  timeout: number;
}

export class SlidevServer {
  private proc: ChildProcess | null = null;
  private port: number;

  constructor(private opts: ServerOptions) {
    this.port = opts.port;
  }

  async start(): Promise<string> {
    const url = `http://localhost:${this.port}`;

    // Check if already running
    if (await this.isReady(url)) {
      console.log(`Slidev already running on ${url}`);
      return url;
    }

    console.log(`Starting Slidev on port ${this.port}...`);
    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    this.proc = spawn(cmd, ['slidev', this.opts.deckPath, '--port', String(this.port), '--remote'], {
      cwd: path.dirname(this.opts.deckPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    this.proc.stdout?.on('data', (d) => {
      const line = d.toString();
      if (process.env.DEBUG) process.stderr.write(line);
    });
    this.proc.stderr?.on('data', (d) => {
      const line = d.toString();
      if (process.env.DEBUG) process.stderr.write(line);
    });

    // Wait for server to be ready
    const deadline = Date.now() + this.opts.timeout;
    while (Date.now() < deadline) {
      if (await this.isReady(url)) {
        console.log(`Slidev ready on ${url}`);
        return url;
      }
      await sleep(500);
    }

    this.stop();
    throw new Error(`Slidev failed to start within ${this.opts.timeout}ms`);
  }

  stop() {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  private isReady(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
