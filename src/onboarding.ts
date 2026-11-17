// Interactive, bilingual setup: accounts -> drafts opt-in -> connect agents.
import { createInterface, type Interface } from 'node:readline';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { stdin, stdout } from 'node:process';
import { styleText } from 'node:util';
import { Writable } from 'node:stream';
import { loadConfig, saveConfig, setPassword, type Account, type Config } from './config.js';
import { resolveMx } from 'node:dns/promises';
import { presetFor, presetForMx, type Preset } from './providers.js';
import { searchAccount } from './imap.js';
import { OAuthError, forgetAccessToken, msClientId, msTenant, pollDeviceLogin, startDeviceLogin } from './oauth.js';
import { AGENTS, type InstallResult } from './agents.js';
import { tr, isYes, type L } from './i18n.js';

const bold = (s: string) => styleText('bold', s);
const dim = (s: string) => styleText('dim', s);
const ok = (s: string) => console.log(`${styleText('green', '✓')} ${s}`);
const warn = (s: string) => console.log(`${styleText('yellow', '!')} ${s}`);
const say = (l: L) => console.log(tr(l));

// One readline for the whole session, with our own line queue: readline emits every pasted or
// piped line at once, and lines arriving before the next question must wait for it, not vanish.
let rl: Interface | null = null;
let muted = false;
let closed = false;
const pending: string[] = [];
const waiting: ((line: string | null) => void)[] = [];

// readline echoes keystrokes through this stream; while muted (typing a password) nothing shows.
const echo = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) stdout.write(chunk);
    done();
  },
});

function nextLine(): Promise<string> {
  if (!rl) {
    rl = createInterface({ input: stdin, output: echo, terminal: Boolean(stdin.isTTY), prompt: '' });
    rl.on('line', (line) => (waiting.length ? waiting.shift()!(line) : pending.push(line)));
    rl.on('close', () => {
      closed = true;
      waiting.splice(0).forEach((resolve) => resolve(null));
    });
  }
  if (pending.length) return Promise.resolve(pending.shift()!);
  if (closed) return Promise.reject(new Error('input closed'));
  return new Promise((resolve, reject) =>
    waiting.push((line) => (line === null ? reject(new Error('input closed')) : resolve(line))),
  );
}

export function closePrompts(): void {
  rl?.close();
  rl = null;
}

async function ask(l: L | string, hidden = false): Promise<string> {
  stdout.write(typeof l === 'string' ? l : tr(l));
  muted = hidden;
  try {
    const line = (await nextLine()).trim();
    if (!stdin.isTTY && !hidden) stdout.write(`${line}\n`); // show piped answers in the transcript
    return line;
  } finally {
    if (hidden) stdout.write('\n');
    muted = false;
  }
}

async function confirm(l: L, fallback: boolean): Promise<boolean> {
  const hint = fallback ? tr({ en: '(Y/n)', es: '(S/n)' }) : tr({ en: '(y/N)', es: '(s/N)' });
  return isYes(await ask(`${tr(l)} ${hint} `), fallback);
}

// explorer.exe on Windows (not `cmd /c start`): the URL carries an email, and cmd would parse & ^ %.
// The URL is always printed too, so a missing opener (headless Linux) only costs a copy-paste.
function openUrl(url: string): void {
  const opener = platform() === 'win32' ? 'explorer.exe' : platform() === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [url], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

/** Turn IMAP/network errors into something a non-developer can act on. */
export function friendlyError(e: unknown, account: Pick<Account, 'host' | 'port'> & Partial<Pick<Account, 'email' | 'oauth'>>): L {
  if (e instanceof OAuthError) {
    if (e.code === 'authorization_declined') {
      return { en: 'The Microsoft sign-in was cancelled.', es: 'Se canceló el inicio de sesión de Microsoft.' };
    }
    if (e.code === 'expired_token') {
      return { en: 'The code expired before the sign-in finished.', es: 'El código venció antes de terminar el inicio de sesión.' };
    }
    if (e.code === 'invalid_grant') {
      return {
        en: `The Microsoft sign-in expired or was revoked. Run "npx allinbox login ${account.email ?? '<email>'}".`,
        es: `El inicio de sesión de Microsoft venció o fue revocado. Corré "npx allinbox login ${account.email ?? '<email>'}".`,
      };
    }
    return { en: `Microsoft refused the sign-in: ${e.message}`, es: `Microsoft rechazó el inicio de sesión: ${e.message}` };
  }
  const err = e as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  const text = `${err.responseText ?? ''} ${err.message ?? ''}`;
  const authFailed = err.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|AUTHENTICATE failed/i.test(text);
  if (authFailed && account.oauth) {
    // The sign-in itself worked (we hold a token); it is the mailbox that said no.
    const who = account.email ?? '';
    return {
      en: `Microsoft signed you in, but the mailbox refused IMAP. Check that you signed in as ${who} (not another Microsoft account or an alias) and that IMAP is on: outlook.com > Settings > Mail > Forwarding and IMAP.`,
      es: `Microsoft te dejó entrar, pero la casilla rechazó IMAP. Fijate que hayas entrado como ${who} (no con otra cuenta de Microsoft ni un alias) y que IMAP esté activado: outlook.com > Configuración > Correo > Reenvío e IMAP.`,
    };
  }
  if (authFailed) {
    return {
      en: 'The password did not work. Make sure it is an APP password, not your normal one.',
      es: 'La contraseña no funcionó. Fijate que sea una contraseña DE APLICACIÓN, no la normal.',
    };
  }
  if (err.code === 'ENOTFOUND') {
    return { en: `Server ${account.host} does not exist. Typo?`, es: `El servidor ${account.host} no existe. ¿Está bien escrito?` };
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || /timeout/i.test(text)) {
    return {
      en: `Could not reach ${account.host}:${account.port}. Wrong port, firewall or no internet?`,
      es: `No pude conectar con ${account.host}:${account.port}. ¿Puerto equivocado, firewall o sin internet?`,
    };
  }
  return { en: `Connection failed: ${text.trim()}`, es: `Falló la conexión: ${text.trim()}` };
}

async function detectByMx(domain: string): Promise<Preset | undefined> {
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('mx timeout')), 5000).unref()),
    ]);
    return presetForMx(records.map((r) => r.exchange));
  } catch {
    return undefined; // no MX or no network: fall back to asking for host/port
  }
}

/** Opens the right pages in the browser by itself; the user only copies and pastes. */
async function guideAppPassword(preset: Preset, email: string): Promise<void> {
  const page = (url: string) => preset.forAccount?.(url, email) ?? url;
  const { appPassword, twoStep } = preset;
  if (!appPassword) return;
  console.log(`\n${bold(tr({ en: 'You need an app password', es: 'Necesitás una contraseña de aplicación' }))}`);
  console.log(dim(tr({
    en: 'It is a separate password just for allinbox. You can revoke it anytime without changing your real one.',
    es: 'Es una contraseña aparte, solo para allinbox. La podés revocar cuando quieras sin tocar la tuya.',
  })));

  if (twoStep) {
    const hasIt = await confirm({
      en: `Is 2-Step Verification already on for ${email}?`,
      es: `¿${email} ya tiene activada la Verificación en 2 pasos?`,
    }, true);
    if (!hasIt) {
      openUrl(page(twoStep.url));
      say({ en: 'I opened the page to turn it on in your browser:', es: 'Te abrí en el navegador la página para activarla:' });
      console.log(`  ${styleText('cyan', page(twoStep.url))}`);
      await ask({ en: 'Press Enter when it is on... ', es: 'Apretá Enter cuando esté activada... ' });
    }
  }

  openUrl(page(appPassword.url));
  say({ en: 'I opened the app password page in your browser:', es: 'Te abrí en el navegador la página de contraseñas de aplicación:' });
  console.log(`  ${styleText('cyan', page(appPassword.url))}`);
  console.log(`  ${tr(appPassword.steps)}`);
  if (twoStep) {
    console.log(dim(`  ${tr(twoStep.symptom)} → ${page(twoStep.url)}`));
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_TRIES = 3;

/**
 * Microsoft accounts: the user signs in on Microsoft's own page and types a short code; allinbox
 * never sees the password. Also used by `allinbox login` when a sign-in expires.
 */
export async function microsoftSignIn(account: Account): Promise<boolean> {
  const oauth = account.oauth;
  if (!oauth) throw new Error(`${account.id} does not use Microsoft sign-in`);
  console.log(`\n${bold(tr({ en: 'Sign in with Microsoft', es: 'Iniciá sesión con Microsoft' }))}`);
  console.log(dim(tr({
    en: 'You sign in on Microsoft\'s page; allinbox never sees your password. You can revoke it anytime at https://account.microsoft.com/privacy/app-access',
    es: 'Entrás en la página de Microsoft; allinbox nunca ve tu contraseña. Lo podés revocar cuando quieras en https://account.microsoft.com/privacy/app-access',
  })));
  // The IMAP permission is all-or-nothing on Microsoft's side; say so before their consent screen does.
  console.log(dim(tr({
    en: 'Microsoft will ask for "read and write access to your mail": it is the only IMAP permission it offers. allinbox opens every mailbox read-only and has no permission to send.',
    es: 'Microsoft va a pedir "acceso de lectura y escritura a tu correo": es el único permiso IMAP que ofrece. allinbox abre todo en solo lectura y no tiene permiso para enviar.',
  })));

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const device = await startDeviceLogin(oauth);
      openUrl(device.verification_uri);
      say({ en: '\nI opened this page in your browser:', es: '\nTe abrí esta página en el navegador:' });
      console.log(`  ${styleText('cyan', device.verification_uri)}`);
      console.log(`  ${tr({ en: 'Type this code there:', es: 'Escribí ahí este código:' })} ${bold(device.user_code)}`);
      console.log(dim(`  ${tr({ en: `Then sign in as ${account.email}.`, es: `Después entrá como ${account.email}.` })}`));
      if (oauth.tenant !== 'consumers') {
        // Seen on a real university tenant: Microsoft stops at this screen and the code never completes.
        console.log(dim(`  ${tr({
          en: 'If Microsoft says "Need admin approval", your organization has to approve allinbox first: send the request from that screen, then press Ctrl+C here and run "npx allinbox add" once it is approved.',
          es: 'Si Microsoft dice "Aprobación necesaria", tu organización tiene que aprobar allinbox primero: mandá la solicitud desde esa pantalla, apretá Ctrl+C acá y corré "npx allinbox add" cuando esté aprobada.',
        })}`));
      }
      stdout.write(dim(tr({ en: 'Waiting for you to finish in the browser... ', es: 'Esperando a que termines en el navegador... ' })));
      const tokens = await pollDeviceLogin(oauth, device);
      // Test first, store after: a failed retry must never overwrite a working sign-in.
      await searchAccount(account, { sinceDays: 1, limit: 1 }, tokens.access_token);
      setPassword(account.id, tokens.refresh_token);
      forgetAccessToken(account.id);
      console.log('');
      ok(tr({ en: `${account.email} connected.`, es: `${account.email} conectada.` }));
      return true;
    } catch (e) {
      console.log('');
      warn(tr(friendlyError(e, account)));
      if (attempt === MAX_TRIES || !(await confirm({ en: 'Try again?', es: '¿Probamos de nuevo?' }, true))) break;
    }
  }
  return false;
}

/** One account, start to finish. Returns null if the user gave up. */
export async function addAccount(existing: Account[]): Promise<Account | null> {
  let email = '';
  while (!EMAIL_RE.test(email)) {
    email = (await ask({ en: '\nEmail address: ', es: '\nDirección de email: ' })).toLowerCase();
    if (!EMAIL_RE.test(email)) warn(tr({ en: 'That does not look like an email.', es: 'Eso no parece un email.' }));
  }
  if (existing.some((a) => a.id === email)) {
    warn(tr({ en: `${email} is already added.`, es: `${email} ya está agregada.` }));
    return null;
  }

  const domain = email.split('@')[1];
  const preset = presetFor(email) ?? (await detectByMx(domain));
  let host = preset?.host ?? '';
  let port = preset?.port ?? 993;
  if (preset) {
    ok(`${preset.label}`);
    if (preset.warning) warn(tr(preset.warning));
  } else {
    say({ en: `I don't know ${domain} yet. Your provider's IMAP settings:`, es: `Todavía no conozco ${domain}. Necesito los datos IMAP de tu proveedor:` });
    host = (await ask(`  Host [imap.${domain}]: `)) || `imap.${domain}`;
    port = NaN;
    while (!(Number.isInteger(port) && port > 0 && port < 65536)) {
      port = Number((await ask('  Port [993]: ')) || 993);
      if (Number.isNaN(port)) warn(tr({ en: 'Port must be a number (usually 993).', es: 'El puerto es un número (casi siempre 993).' }));
    }
  }

  if (preset?.oauth) {
    const oauth = { provider: preset.oauth.provider, clientId: msClientId(), tenant: msTenant(preset.oauth.tenant) };
    const msAccount: Account = { id: email, email, host, port, secure: true, user: email, oauth };
    if (await microsoftSignIn(msAccount)) return msAccount;
    warn(tr({ en: `Skipped ${email}. Run "npx allinbox add" to retry.`, es: `Salteé ${email}. Corré "npx allinbox add" para reintentar.` }));
    return null;
  }

  if (preset?.appPassword) await guideAppPassword(preset, email);

  const account: Account = { id: email, email, host, port, secure: port === 993, user: email };
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const typed = await ask({ en: 'Paste the app password (hidden): ', es: 'Pegá la contraseña de aplicación (no se ve): ' }, true);
    // Known providers show app passwords in groups ("abcd efgh ..."): spaces are never part of them.
    // Custom servers may use real passwords, where spaces are legal.
    const password = preset?.appPassword ? typed.replace(/\s+/g, '') : typed;
    if (!password) {
      warn(tr({
        en: 'Nothing was pasted. In some terminals paste is right-click or Ctrl+Shift+V.',
        es: 'No se pegó nada. En algunas terminales se pega con clic derecho o Ctrl+Shift+V.',
      }));
      attempt--; // an empty paste is not a failed login
      continue;
    }
    stdout.write(dim(tr({ en: 'Connecting... ', es: 'Conectando... ' })));
    try {
      // Test first, store after: a failed retry must never overwrite a working password.
      await searchAccount(account, { sinceDays: 1, limit: 1 }, password);
      setPassword(account.id, password);
      console.log('');
      ok(tr({ en: `${email} connected.`, es: `${email} conectada.` }));
      return account;
    } catch (e) {
      console.log('');
      warn(tr(friendlyError(e, account)));
      if (attempt < MAX_TRIES) say({ en: `Let's try again (${attempt}/${MAX_TRIES}).`, es: `Probemos de nuevo (${attempt}/${MAX_TRIES}).` });
    }
  }
  warn(tr({ en: `Skipped ${email}. Run "npx allinbox add" to retry.`, es: `Salteé ${email}. Corré "npx allinbox add" para reintentar.` }));
  return null;
}

async function draftsStep(config: Config): Promise<Config> {
  console.log(`\n${bold(tr({ en: 'Reply drafts (optional)', es: 'Borradores de respuesta (opcional)' }))}`);
  console.log(dim(tr({
    en: 'Your agent can leave drafts in your Drafts folder. It can NEVER send: you review and send them yourself.',
    es: 'Tu agente puede dejar borradores en tu carpeta Borradores. NUNCA puede enviar: los revisás y mandás vos.',
  })));
  if (!(await confirm({ en: 'Allow drafts?', es: '¿Permitir borradores?' }, false))) {
    return { ...config, drafts: { enabled: false, allowRecipients: [] } };
  }
  console.log(dim(tr({
    en: 'A malicious email could trick an agent into drafting your data to a stranger. Limiting recipients prevents it.',
    es: 'Un mail malicioso podría engañar al agente para que te arme un borrador con tus datos hacia un extraño. Limitar destinatarios lo evita.',
  })));
  // Real users pressed Enter here expecting "no limit": ask again once, with the reason, before giving up.
  let allowRecipients: string[] = [];
  for (let attempt = 0; attempt < 2 && !allowRecipients.length; attempt++) {
    if (attempt === 1) {
      warn(tr({
        en: 'The list cannot be empty (empty = drafts to nobody). Type at least one, or * for anyone.',
        es: 'La lista no puede quedar vacía (vacía = borradores a nadie). Escribí al menos uno, o * para cualquiera.',
      }));
    }
    const list = await ask({
      en: 'Allowed recipients, comma separated (e.g. @mycompany.com, ana@x.com; * = anyone): ',
      es: 'Destinatarios permitidos, separados por coma (ej. @miempresa.com, ana@x.com; * = cualquiera): ',
    });
    allowRecipients = list.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  if (!allowRecipients.length) {
    warn(tr({ en: 'No recipients given: drafts stay off.', es: 'No indicaste destinatarios: los borradores quedan apagados.' }));
    return { ...config, drafts: { enabled: false, allowRecipients: [] } };
  }
  ok(tr({ en: 'Drafts enabled.', es: 'Borradores activados.' }));
  return { ...config, drafts: { enabled: true, allowRecipients } };
}

export async function connectAgents(): Promise<void> {
  console.log(`\n${bold(tr({ en: 'Connect your agents', es: 'Conectar tus agentes' }))}`);
  const found = AGENTS.filter((a) => a.detected());
  if (!found.length) say({ en: 'No agents detected.', es: 'No detecté agentes instalados.' });
  for (const agent of found) {
    if (!(await confirm({ en: `Connect to ${agent.name}?`, es: `¿Conectar con ${agent.name}?` }, true))) continue;
    const blocked = agent.blockedReason?.();
    if (blocked) {
      warn(`${agent.name}: ${tr(blocked)}`);
      continue;
    }
    try {
      const result = await agent.install();
      const note: Record<InstallResult, L> = {
        added: { en: '', es: '' },
        updated: { en: ' (updated)', es: ' (actualizado)' },
        unchanged: { en: ' (already connected)', es: ' (ya estaba conectado)' },
      };
      ok(`${agent.name}${tr(note[result])}`);
    } catch (e) {
      warn(`${agent.name}: ${e instanceof Error ? e.message : e}`);
      console.log(dim(`  ${tr({ en: 'Manual:', es: 'A mano:' })} ${agent.manual}`));
    }
  }
  console.log(dim(tr({
    en: 'Other agents: see "Connect your agent" at https://www.npmjs.com/package/allinbox',
    es: 'Otros agentes: ver "Connect your agent" en https://www.npmjs.com/package/allinbox',
  })));
}

export async function onboarding(): Promise<void> {
  console.log(`\n${bold('allinbox')} ${dim('— ' + tr({ en: 'all your inboxes, one query, any agent', es: 'todas tus casillas, una consulta, cualquier agente' }))}\n`);
  ok(tr({ en: 'Read-only: it never sends, deletes or marks anything as read.', es: 'Solo lectura: nunca envía, borra ni marca nada como leído.' }));
  ok(tr({ en: 'Everything stays on your computer. Passwords go to your OS keychain.', es: 'Todo queda en tu compu. Las contraseñas van al llavero del sistema.' }));

  let config = await loadConfig();
  if (config.accounts.length) {
    say({ en: `\nAlready connected: ${config.accounts.map((a) => a.id).join(', ')}`, es: `\nYa conectadas: ${config.accounts.map((a) => a.id).join(', ')}` });
  }
  let more = !config.accounts.length || (await confirm({ en: 'Add another account?', es: '¿Agregar otra cuenta?' }, false));
  while (more) {
    const account = await addAccount(config.accounts);
    if (account) {
      config = { ...config, accounts: [...config.accounts, account] };
      await saveConfig(config);
    }
    more = await confirm({ en: 'Add another account?', es: '¿Agregar otra cuenta?' }, false);
  }
  if (!config.accounts.length) {
    warn(tr({ en: 'No accounts yet. Run "npx allinbox" again when ready.', es: 'Todavía no hay cuentas. Corré "npx allinbox" de nuevo cuando quieras.' }));
    return;
  }

  config = await draftsStep(config);
  await saveConfig(config);
  await connectAgents();

  console.log(`\n${bold(tr({ en: 'Done!', es: '¡Listo!' }))} ${tr({
    en: 'Restart your agent and ask it:',
    es: 'Reiniciá tu agente y preguntale:',
  })}`);
  console.log(styleText('cyan', `  "${tr({ en: 'What do I have pending this week across all my email?', es: '¿Qué tengo pendiente esta semana en todos mis mails?' })}"\n`));
}
