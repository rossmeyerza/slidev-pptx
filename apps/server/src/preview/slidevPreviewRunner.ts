import { createServer, resolveOptions } from '@slidev/cli';

interface RunnerArgs {
  entry: string;
  port: number;
  host: string;
  base: string;
  hmrHost?: string;
  hmrProtocol?: 'ws' | 'wss';
  hmrClientPort?: number;
  hmrPath?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const options = await resolveOptions({ entry: args.entry, base: args.base, routerMode: 'hash' }, 'dev');
  const viteConfig = {
    server: {
      host: args.host,
      port: args.port,
      strictPort: true,
      ...(args.hmrPath ? {
        hmr: {
          host: args.hmrHost,
          protocol: args.hmrProtocol,
          clientPort: args.hmrClientPort,
          path: args.hmrPath,
        },
      } : {}),
    },
    base: args.base,
    define: {
      __SLIDEV_HASH_ROUTE__: 'true',
    },
    logLevel: 'warn',
    plugins: [forceHashRoutePlugin()],
  };
  const server = await createServer(options, viteConfig);
  await server.listen();

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

function forceHashRoutePlugin() {
  return {
    name: 'slidev-agent-force-hash-route',
    enforce: 'post',
    transform(code: string, id: string) {
      if (!id.includes('@slidev/client')) return null;
      let nextCode = code;
      if (nextCode.includes('__SLIDEV_HASH_ROUTE__')) {
        nextCode = nextCode.replaceAll('__SLIDEV_HASH_ROUTE__', 'true');
      }
      if (id.includes('@slidev/client/logic/slides.ts')) {
        nextCode = nextCode.replace(
          'return `${import.meta.env.BASE_URL}${path}`;',
          'return `/${path}`;',
        );
      }
      if (nextCode === code) return null;
      return {
        code: nextCode,
        map: null,
      };
    },
  };
}

function parseArgs(argv: string[]): RunnerArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }
    values.set(key.slice(2), value);
  }
  const hmrProtocol = values.get('hmr-protocol');
  if (hmrProtocol && hmrProtocol !== 'ws' && hmrProtocol !== 'wss') {
    throw new Error('hmr-protocol must be ws or wss');
  }
  const narrowedProtocol = hmrProtocol === 'ws' || hmrProtocol === 'wss' ? hmrProtocol : undefined;
  return {
    entry: required(values, 'entry'),
    port: positiveInt(required(values, 'port'), 'port'),
    host: values.get('host') ?? '127.0.0.1',
    base: values.get('base') ?? '/',
    hmrHost: values.get('hmr-host'),
    hmrProtocol: narrowedProtocol,
    hmrClientPort: values.has('hmr-client-port') ? positiveInt(required(values, 'hmr-client-port'), 'hmr-client-port') : undefined,
    hmrPath: values.get('hmr-path'),
  };
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function positiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
