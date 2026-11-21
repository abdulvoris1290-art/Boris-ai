/**
 * Voris AI setup helper.
 *
 *   npm run setup    – asks for your AI provider and keys, writes .env, then tests them
 *   npm run doctor   – only tests the current .env configuration
 *
 * Keys are written to .env on this machine only. They are never sent anywhere
 * except to the provider you choose, when testing the connection.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const ENV_PATH = path.resolve('.env');
const EXAMPLE_PATH = path.resolve('.env.example');
const checkOnly = process.argv.includes('--check');

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  violet: (s: string) => `\x1b[35m${s}\x1b[0m`,
};

const PROVIDERS = [
  { id: 'groq', label: 'Groq (fast, free tier, images supported)', keyHint: 'gsk_…', keyUrl: 'https://console.groq.com/keys' },
  { id: 'anthropic', label: 'Anthropic Claude', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'openrouter', label: 'OpenRouter (many models, one key)', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'custom', label: 'Custom OpenAI-compatible server (Ollama, LM Studio, vLLM…)', keyHint: '(optional)', keyUrl: '' },
] as const;

// ── .env helpers ─────────────────────────────────────────────────────────────

function readEnvFile(file: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) map.set(m[1], m[2].replace(/^["']|["']$/g, ''));
  }
  return map;
}

/** Updates keys in place, keeping comments and order from the existing file (or .env.example). */
function writeEnv(updates: Record<string, string>) {
  const base = fs.existsSync(ENV_PATH) ? ENV_PATH : fs.existsSync(EXAMPLE_PATH) ? EXAMPLE_PATH : null;
  const lines = base ? fs.readFileSync(base, 'utf8').split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && pending.has(m[1])) {
      const v = pending.get(m[1])!;
      pending.delete(m[1]);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  for (const [k, v] of pending) out.push(`${k}=${v}`);
  fs.writeFileSync(ENV_PATH, out.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
}

// ── prompts ──────────────────────────────────────────────────────────────────

let rlInstance: readline.Interface | null = null;
const getRl = () => (rlInstance ??= readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }));
const ask = (q: string, def = '') =>
  new Promise<string>((resolve) => getRl().question(`${q}${def ? c.dim(` [${def}]`) : ''}: `, (a) => resolve(a.trim() || def)));

/** Reads a secret without echoing it. Pressing Enter keeps the current value. */
function askSecret(q: string, current: string): Promise<string> {
  const shown = current ? c.dim(` [keep ${current.slice(0, 4)}…${current.slice(-4)}]`) : '';
  return new Promise((resolve) => {
    const out = process.stdout;
    out.write(`${q}${shown}: `);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      getRl().question('', (a) => resolve(a.trim() || current));
      return;
    }
    getRl().pause();
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.off('data', onData);
          out.write('\n');
          getRl().resume();
          resolve(value.trim() || current);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') {
          if (value) {
            value = value.slice(0, -1);
            out.write('\b \b');
          }
        } else if (ch >= ' ') {
          value += ch;
          out.write('•');
        }
      }
    };
    stdin.on('data', onData);
  });
}

// ── connection tests ─────────────────────────────────────────────────────────

// 64×64 solid violet PNG, large enough for vision models that reject tiny images.
const TEST_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeElEQVR4nO3PUQkAIBTAwBfYJobWEH4cwmABbrPX+brhgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAseu0w/YdJzNdVgAAAAAElFTkSuQmCC';

const TTY = !!process.stdout.isTTY;
/** A "working…" line that the result replaces, only in an interactive terminal. */
const progress = (text: string) => {
  if (TTY) process.stdout.write(`  … ${text}`);
};
const result = (text: string) => console.log(TTY ? `\r\x1b[2K  ${text}` : `  ${text}`);

async function runChecks(): Promise<boolean> {
  const env = readEnvFile(ENV_PATH);
  for (const [k, v] of env) process.env[k] = v;

  console.log(`\n${c.bold('Checking your configuration…')}\n`);
  // Imported after the environment is loaded, because the server reads it at import time.
  const { aiProvider, providerStatus } = await import('../server/providers/index.ts');
  const { searchConfigured, webSearch } = await import('../server/search.ts');
  let ok = true;

  const status = providerStatus();
  if (!aiProvider) {
    console.log(`  ${c.red('✗')} AI provider: ${status.problem}`);
    ok = false;
  } else {
    let chatOk = false;
    progress(`Chat model ${c.bold(aiProvider.model)} (${aiProvider.label})`);
    try {
      const reply = await aiProvider.complete({
        system: 'You are a connectivity test. Reply with the single word OK.',
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 16,
        signal: AbortSignal.timeout(30_000),
      });
      chatOk = true;
      result(`${c.green('✓')} Chat model ${c.bold(aiProvider.model)} responded${reply ? c.dim(` (“${reply.slice(0, 30)}”)`) : ''}`);
    } catch (err) {
      result(`${c.red('✗')} Chat model ${c.bold(aiProvider.model)}: ${(err as Error).message}`);
      ok = false;
    }

    if (aiProvider.visionModel) {
      progress(`Image model ${c.bold(aiProvider.visionModel)}`);
      try {
        await aiProvider.complete({
          system: 'You are a connectivity test. Reply with one word.',
          messages: [{ role: 'user', content: 'What colour is this image?', images: [{ mediaType: 'image/png', data: TEST_PNG }] }],
          maxTokens: 16,
          signal: AbortSignal.timeout(45_000),
        });
        result(`${c.green('✓')} Image understanding works with ${c.bold(aiProvider.visionModel)}`);
      } catch (err) {
        result(`${c.yellow('!')} Image model ${c.bold(aiProvider.visionModel)}: ${(err as Error).message}`);
        if (chatOk) console.log(c.dim('    Chat still works. To fix images, set AI_VISION_MODEL in .env to a vision model your account can use.'));
      }
    } else {
      console.log(`  ${c.yellow('!')} Image understanding is off (no vision model). Set AI_VISION_MODEL to enable it.`);
    }
  }

  if (searchConfigured()) {
    progress(`Web search (${process.env.SEARCH_PROVIDER})`);
    try {
      const results = await webSearch('Voris AI connectivity test');
      result(`${c.green('✓')} Web search works (${results.length} results)`);
    } catch (err) {
      result(`${c.red('✗')} Web search: ${(err as Error).message}. Check SEARCH_API_KEY.`);
      ok = false;
    }
  } else {
    console.log(`  ${c.dim('–')} Web search not configured ${c.dim('(optional: run npm run setup to add a Tavily key)')}`);
  }

  console.log(ok ? `\n${c.green('All set.')} Start Voris AI with ${c.bold('npm run dev')}.\n` : `\n${c.yellow('Some checks failed.')} Fix the items above, then run ${c.bold('npm run doctor')} again.\n`);
  return ok;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function setup() {
  const env = readEnvFile(ENV_PATH);
  console.log(`\n${c.violet('◆')} ${c.bold('Voris AI setup')}`);
  console.log(c.dim('  Your keys are saved to .env on this computer and never sent to the browser.\n'));

  const currentId = env.get('AI_PROVIDER') || 'groq';
  PROVIDERS.forEach((p, i) => console.log(`  ${i + 1}. ${p.label}${p.id === currentId ? c.dim('  (current)') : ''}`));
  const defIndex = Math.max(0, PROVIDERS.findIndex((p) => p.id === currentId)) + 1;
  const pick = Number(await ask('\nChoose a provider', String(defIndex)));
  const provider = PROVIDERS[(pick >= 1 && pick <= PROVIDERS.length ? pick : defIndex) - 1];
  const updates: Record<string, string> = { AI_PROVIDER: provider.id };

  if (provider.keyUrl) console.log(c.dim(`  Get a key at ${provider.keyUrl}`));
  const sameProvider = provider.id === env.get('AI_PROVIDER');
  const key = await askSecret(`${provider.label.split(' (')[0]} API key ${c.dim(provider.keyHint)}`, sameProvider ? (env.get('AI_API_KEY') ?? '') : '');
  if (!key && provider.id !== 'custom') {
    console.log(c.red('\nAn API key is required for this provider. Nothing was changed.\n'));
    process.exit(1);
  }
  updates.AI_API_KEY = key;

  if (provider.id === 'custom') {
    updates.AI_BASE_URL = await ask('Base URL', env.get('AI_BASE_URL') || 'http://localhost:11434/v1');
    updates.AI_MODEL = await ask('Model name', env.get('AI_MODEL') || 'llama3.1');
    updates.AI_VISION_MODEL = await ask('Vision model (blank = images off)', env.get('AI_VISION_MODEL') || '');
  } else if (!sameProvider) {
    // Provider changed: clear model overrides so the new provider's defaults apply.
    updates.AI_MODEL = '';
    updates.AI_VISION_MODEL = '';
    updates.AI_BASE_URL = '';
  }

  const wantSearch = (await ask('\nEnable web search with Tavily? (y/n)', env.get('SEARCH_API_KEY') ? 'y' : 'n')).toLowerCase().startsWith('y');
  if (wantSearch) {
    console.log(c.dim('  Get a free key at https://app.tavily.com'));
    const sameSearch = env.get('SEARCH_PROVIDER') === 'tavily';
    const sk = await askSecret(`Tavily API key ${c.dim('tvly-…')}`, sameSearch ? (env.get('SEARCH_API_KEY') ?? '') : '');
    if (sk) {
      updates.SEARCH_PROVIDER = 'tavily';
      updates.SEARCH_API_KEY = sk;
    }
  } else {
    updates.SEARCH_PROVIDER = '';
    updates.SEARCH_API_KEY = '';
  }

  writeEnv(updates);
  console.log(`\n${c.green('✓')} Saved ${c.bold('.env')}`);
  (rlInstance as readline.Interface | null)?.close();
  await runChecks();
  console.log(c.dim('If the dev server is already running, restart it to pick up the new settings.\n'));
}

if (checkOnly) {
  (rlInstance as readline.Interface | null)?.close();
  const ok = await runChecks();
  process.exit(ok ? 0 : 1);
} else {
  await setup();
  process.exit(0);
}
