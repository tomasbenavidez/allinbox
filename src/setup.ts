// Account setup from inside the chat. The chat view (setup.html) only guides; everything that
// changes trust (app passwords, removing accounts, the drafts allowlist) happens on a one-time
// page served by this process on 127.0.0.1 and opened in the user's own browser. Secrets never
// travel through MCP, so they never reach the model, the host app or a chat transcript, and a
// prompt-injected model has no tool that can change the configuration.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Account, Config } from './config.js';
import { detectProvider, type Preset } from './providers.js';
import type { L } from './i18n.js';

export interface SetupDeps {
  loadConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;
  /** Throws when the login fails. */
  testLogin(account: Account, password: string): Promise<void>;
  setPassword(id: string, password: string): void;
  deletePassword(id: string): void;
  openUrl(url: string): void;
  friendlyError(e: unknown, account: Account): L;
}

export type Lang = keyof L;
export type SetupState = 'idle' | 'waiting' | 'testing' | 'connected' | 'failed' | 'saved' | 'expired';

export interface SetupStatus {
  state: SetupState;
  mode?: 'add' | 'manage';
  email?: string;
  message?: string;
}

export interface ProviderInfo {
  email: string;
  known: boolean;
  label?: string;
  warning?: L;
  twoStep?: { url: string; symptom: L };
  appPassword?: { url: string; steps: L };
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TTL_MS = 15 * 60_000;
const MAX_BODY = 8 * 1024;

export async function describeProvider(email: string): Promise<ProviderInfo> {
  const preset = await detectProvider(email);
  if (!preset) return { email, known: false };
  const page = (url: string) => preset.forAccount?.(url, email) ?? url;
  return {
    email,
    known: true,
    label: preset.label,
    warning: preset.warning,
    twoStep: preset.twoStep && { url: page(preset.twoStep.url), symptom: preset.twoStep.symptom },
    appPassword: preset.appPassword && { url: page(preset.appPassword.url), steps: preset.appPassword.steps },
  };
}

interface Session {
  token: string;
  mode: 'add' | 'manage';
  email?: string;
  preset?: Preset;
  expires: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** One per MCP server process. The HTTP listener only runs while a session is open. */
export class SetupDesk {
  private server?: Server;
  private session?: Session;
  private status: SetupStatus = { state: 'idle' };
  private timer?: NodeJS.Timeout;
  private lang: Lang = 'en';

  constructor(
    private deps: SetupDeps,
    /** Called after every saved change so the MCP server picks up accounts and drafts at once. */
    private onChange: (config: Config) => void,
  ) {}

  getStatus(): SetupStatus {
    if (this.session && Date.now() > this.session.expires) this.close('expired');
    return this.status;
  }

  /** Opens the local page in the browser and returns its URL (also shown in the chat as a fallback). */
  async open(mode: 'add' | 'manage', lang: Lang, email?: string): Promise<string> {
    if (mode === 'add' && !(email && EMAIL_RE.test(email))) throw new Error('A valid email is required');
    const config = await this.deps.loadConfig();
    if (mode === 'add' && config.accounts.some((a) => a.id === email)) throw new Error(`${email} is already connected`);
    const preset = mode === 'add' ? await detectProvider(email!) : undefined;
    this.lang = lang;
    this.session = { token: randomBytes(24).toString('base64url'), mode, email, preset, expires: Date.now() + TTL_MS };
    this.status = { state: 'waiting', mode, email };
    const port = await this.listen();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.close('expired'), TTL_MS).unref();
    const url = `http://127.0.0.1:${port}/${mode}?t=${this.session.token}`;
    this.deps.openUrl(url);
    return url;
  }

  close(state: SetupState = 'idle'): void {
    clearTimeout(this.timer);
    this.session = undefined;
    if (state !== 'idle' || this.status.state === 'waiting') this.status = { ...this.status, state };
    this.server?.close();
    this.server = undefined;
  }

  private listen(): Promise<number> {
    if (this.server) return Promise.resolve((this.server.address() as AddressInfo).port);
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch((e) => this.send(res, 500, this.page('Error', `<p>${esc(String(e?.message ?? e))}</p>`)));
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.unref(); // never keep the MCP server alive just for this page
        this.server = server;
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  private t(l: L): string {
    return l[this.lang];
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = (this.server!.address() as AddressInfo).port;
    // DNS rebinding: only our own host name. CSRF: POSTs must come from this page.
    if (req.headers.host !== `127.0.0.1:${port}`) return this.send(res, 403, 'Forbidden');
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) {
      return this.send(res, 403, 'Forbidden');
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const s = this.session;
    const form = req.method === 'POST' ? await readForm(req) : undefined;
    const token = form?.get('t') ?? url.searchParams.get('t');
    if (!s || !token || token !== s.token || Date.now() > s.expires) {
      return this.send(res, 410, this.page(this.t({ en: 'Link expired', es: 'Link vencido' }), `<p>${esc(this.t({
        en: 'This setup link is no longer valid. Go back to the chat and start again.',
        es: 'Este link de configuración ya no es válido. Volvé al chat y empezá de nuevo.',
      }))}</p>`));
    }
    const route = `${req.method} ${url.pathname}`;
    if (s.mode === 'add' && route === 'GET /add') return this.send(res, 200, this.addForm());
    if (s.mode === 'add' && route === 'POST /add') return this.add(res, form!);
    if (s.mode === 'manage' && route === 'GET /manage') return this.send(res, 200, await this.manageForm());
    if (s.mode === 'manage' && route === 'POST /remove') return this.remove(res, form!);
    if (s.mode === 'manage' && route === 'POST /drafts') return this.drafts(res, form!);
    return this.send(res, 404, 'Not found');
  }

  private addForm(error?: string, host = '', port = ''): string {
    const s = this.session!;
    const domain = s.email!.split('@')[1];
    const custom = s.preset
      ? ''
      : `<p class="muted">${esc(this.t({ en: `I don't know ${domain} yet: your provider's IMAP settings.`, es: `Todavía no conozco ${domain}: necesito los datos IMAP de tu proveedor.` }))}</p>
         <label>Host<input name="host" required value="${esc(host || `imap.${domain}`)}" autocomplete="off"></label>
         <label>${esc(this.t({ en: 'Port', es: 'Puerto' }))}<input name="port" required inputmode="numeric" value="${esc(port || '993')}"></label>`;
    return this.page(
      this.t({ en: 'Connect', es: 'Conectar' }) + ` ${s.email}`,
      `${error ? `<p class="error">${esc(error)}</p>` : ''}
       <form method="post" action="/add">
         <input type="hidden" name="t" value="${s.token}">
         <p class="muted">${esc(s.preset?.label ?? '')}</p>
         ${custom}
         <label>${esc(this.t(s.preset?.appPassword ? { en: 'App password', es: 'Contraseña de aplicación' } : { en: 'Password', es: 'Contraseña' }))}
           <input name="password" type="password" required autofocus autocomplete="off" spellcheck="false"></label>
         <button type="submit">${esc(this.t({ en: 'Test and save', es: 'Probar y guardar' }))}</button>
       </form>
       <p class="muted small">${esc(this.t({
         en: 'allinbox tests the login first and only then saves the password in your system keychain. It never leaves this computer.',
         es: 'allinbox primero prueba el login y recién ahí guarda la contraseña en el llavero del sistema. Nunca sale de esta compu.',
       }))}</p>`,
    );
  }

  private async add(res: ServerResponse, form: URLSearchParams): Promise<void> {
    const s = this.session!;
    const email = s.email!;
    const host = s.preset?.host ?? (form.get('host') ?? '').trim();
    const port = s.preset?.port ?? Number(form.get('port'));
    if (!host || !Number.isInteger(port) || port <= 0 || port >= 65536) {
      return this.send(res, 400, this.addForm(this.t({ en: 'Check host and port (usually 993).', es: 'Revisá host y puerto (casi siempre 993).' }), host, String(form.get('port') ?? '')));
    }
    // Known providers show app passwords in groups ("abcd efgh ..."): spaces are never part of them.
    const typed = form.get('password') ?? '';
    const password = s.preset?.appPassword ? typed.replace(/\s+/g, '') : typed;
    const account: Account = { id: email, email, host, port, secure: port === 993, user: email };
    this.status = { state: 'testing', mode: 'add', email };
    try {
      await this.deps.testLogin(account, password); // test first, store after
    } catch (e) {
      const message = this.t(this.deps.friendlyError(e, account));
      this.status = { state: 'failed', mode: 'add', email, message };
      return this.send(res, 200, this.addForm(message, host, String(port)));
    }
    this.deps.setPassword(account.id, password);
    const config = await this.deps.loadConfig(); // re-read: never clobber changes made elsewhere
    const next = { ...config, accounts: [...config.accounts.filter((a) => a.id !== email), account] };
    await this.deps.saveConfig(next);
    this.onChange(next);
    this.close('connected');
    this.status = { state: 'connected', mode: 'add', email };
    this.send(res, 200, this.page('✓ ' + this.t({ en: `${email} connected`, es: `${email} conectada` }), `<p>${esc(this.t({
      en: 'Done. You can close this tab and go back to the chat.',
      es: 'Listo. Podés cerrar esta pestaña y volver al chat.',
    }))}</p>`));
  }

  private async manageForm(note?: string, error?: string): Promise<string> {
    const s = this.session!;
    const config = await this.deps.loadConfig();
    const rows = config.accounts.map((a) => `
      <li><span>${esc(a.id)}</span>
        <form method="post" action="/remove" onsubmit="return confirm(${esc(JSON.stringify(this.t({ en: `Remove ${a.id}?`, es: `¿Quitar ${a.id}?` })))})">
          <input type="hidden" name="t" value="${s.token}"><input type="hidden" name="id" value="${esc(a.id)}">
          <button class="secondary" type="submit">${esc(this.t({ en: 'Remove', es: 'Quitar' }))}</button>
        </form></li>`).join('');
    const d = config.drafts;
    return this.page(this.t({ en: 'Accounts and drafts', es: 'Cuentas y borradores' }), `
      ${note ? `<p class="ok">${esc(note)}</p>` : ''}${error ? `<p class="error">${esc(error)}</p>` : ''}
      <h2>${esc(this.t({ en: 'Accounts', es: 'Cuentas' }))}</h2>
      <ul class="accounts">${rows || `<li class="muted">${esc(this.t({ en: 'No accounts yet.', es: 'Todavía no hay cuentas.' }))}</li>`}</ul>
      <h2>${esc(this.t({ en: 'Reply drafts', es: 'Borradores de respuesta' }))}</h2>
      <p class="muted small">${esc(this.t({
        en: 'Your agent can leave drafts in your Drafts folder. It can NEVER send. Limit recipients so a malicious email cannot make it draft your data to a stranger.',
        es: 'Tu agente puede dejar borradores en tu carpeta Borradores. NUNCA puede enviar. Limitá los destinatarios para que un mail malicioso no lo haga armar un borrador con tus datos hacia un extraño.',
      }))}</p>
      <form method="post" action="/drafts">
        <input type="hidden" name="t" value="${s.token}">
        <label class="check"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''}> ${esc(this.t({ en: 'Allow drafts', es: 'Permitir borradores' }))}</label>
        <label>${esc(this.t({ en: 'Allowed recipients (comma separated; @domain.com or * for anyone)', es: 'Destinatarios permitidos (separados por coma; @dominio.com o * para cualquiera)' }))}
          <input name="allow" value="${esc(d.allowRecipients.join(', '))}" autocomplete="off" spellcheck="false"></label>
        <button type="submit">${esc(this.t({ en: 'Save', es: 'Guardar' }))}</button>
      </form>`);
  }

  private async remove(res: ServerResponse, form: URLSearchParams): Promise<void> {
    const id = form.get('id') ?? '';
    const config = await this.deps.loadConfig();
    if (!config.accounts.some((a) => a.id === id)) return this.send(res, 400, await this.manageForm(undefined, `Unknown account ${id}`));
    const next = { ...config, accounts: config.accounts.filter((a) => a.id !== id) };
    await this.deps.saveConfig(next);
    try { this.deps.deletePassword(id); } catch { /* already gone */ }
    this.onChange(next);
    this.status = { state: 'saved', mode: 'manage' };
    this.send(res, 200, await this.manageForm(this.t({ en: `${id} removed.`, es: `${id} quitada.` })));
  }

  private async drafts(res: ServerResponse, form: URLSearchParams): Promise<void> {
    const allowRecipients = (form.get('allow') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const enabled = form.get('enabled') === 'on';
    // Fails closed: drafts on with nobody allowed is refused, not silently "anyone".
    if (enabled && !allowRecipients.length) {
      return this.send(res, 400, await this.manageForm(undefined, this.t({
        en: 'Add at least one recipient (or * for anyone) to allow drafts.',
        es: 'Agregá al menos un destinatario (o * para cualquiera) para permitir borradores.',
      })));
    }
    const config = await this.deps.loadConfig();
    const next = { ...config, drafts: { enabled, allowRecipients: enabled ? allowRecipients : [] } };
    await this.deps.saveConfig(next);
    this.onChange(next);
    this.status = { state: 'saved', mode: 'manage' };
    this.send(res, 200, await this.manageForm(this.t({ en: 'Saved.', es: 'Guardado.' })));
  }

  private send(res: ServerResponse, code: number, body: string): void {
    res.writeHead(code, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin', // no-referrer would make browsers send "Origin: null" and fail our CSRF check
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    });
    res.end(body);
  }

  private page(title: string, body: string): string {
    return `<!doctype html><html lang="${this.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>allinbox · ${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#faf9f5; --card:#fff; --fg:#1f1e1d; --muted:#6b6a65; --line:rgba(31,30,29,.14); --accent:#c96442; --err:#b3261e; --ok:#2e7d4f; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1f1e1d; --card:#262624; --fg:#f5f4ef; --muted:#a3a19a; --line:rgba(245,244,239,.14); --accent:#d97757; --err:#f2b8b5; --ok:#8fd1a8; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding:24px 16px; }
  main { width:100%; max-width:440px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:24px; }
  .brand { color:var(--muted); font-size:13px; margin:0 0 4px; } h1 { font-size:19px; margin:0 0 16px; overflow-wrap:anywhere; } h2 { font-size:14px; margin:20px 0 8px; }
  label { display:block; font-size:13px; color:var(--muted); margin:12px 0 0; }
  input:not([type=checkbox]) { display:block; width:100%; margin-top:4px; padding:9px 11px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--fg); font:inherit; }
  input:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  .check { display:flex; gap:8px; align-items:center; color:var(--fg); font-size:14px; }
  button { margin-top:16px; padding:9px 16px; border:0; border-radius:8px; background:var(--fg); color:var(--bg); font:inherit; font-weight:600; cursor:pointer; }
  button.secondary { margin:0; padding:4px 10px; background:transparent; color:var(--fg); border:1px solid var(--line); font-weight:500; font-size:13px; }
  .accounts { list-style:none; padding:0; margin:0; } .accounts li { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
  .muted { color:var(--muted); } .small { font-size:13px; } .error { color:var(--err); } .ok { color:var(--ok); }
</style></head><body><main><p class="brand">🔒 allinbox · ${esc(this.t({ en: 'local setup, only on this computer', es: 'configuración local, solo en esta compu' }))}</p>
<h1>${esc(title)}</h1>${body}</main></body></html>`;
  }
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new Error('Request too large');
  }
  return new URLSearchParams(body);
}
