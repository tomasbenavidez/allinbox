import type { L } from './i18n.js';

export interface Preset {
  label: string;
  host: string;
  port: number;
  /** Where the user creates the app password, plus how to get there. */
  appPassword?: { url: string; steps: L };
  /** App passwords only exist once 2-step verification is on: where to turn it on. */
  twoStep?: { url: string; symptom: L };
  /** Builds a URL that opens the page signed in as `email` (users often have several accounts). */
  forAccount?: (url: string, email: string) => string;
  warning?: L;
}

const gmail: Preset = {
  label: 'Gmail',
  host: 'imap.gmail.com',
  port: 993,
  appPassword: {
    url: 'https://myaccount.google.com/apppasswords',
    steps: {
      en: 'On that page type a name (e.g. "allinbox"), click Create and copy the 16-letter password.',
      es: 'En esa página escribí un nombre (ej. "allinbox"), tocá Crear y copiá la contraseña de 16 letras.',
    },
  },
  twoStep: {
    url: 'https://myaccount.google.com/signinoptions/twosv',
    symptom: {
      en: 'If Google says "The setting you are looking for is not available for your account", 2-Step Verification is off.',
      es: 'Si Google dice "La opción de configuración que buscas no está disponible para tu cuenta", te falta la Verificación en 2 pasos.',
    },
  },
  // authuser picks the right signed-in Google account instead of the browser's default one.
  forAccount: (url, email) => `${url}?authuser=${encodeURIComponent(email)}`,
};
const icloud: Preset = {
  label: 'iCloud',
  host: 'imap.mail.me.com',
  port: 993,
  appPassword: {
    url: 'https://account.apple.com/account/manage',
    steps: {
      en: 'Sign-In and Security > App-Specific Passwords > "+". Copy the generated password.',
      es: 'Inicio de sesión y seguridad > Contraseñas de apps > "+". Copiá la contraseña generada.',
    },
  },
};
const yahoo: Preset = {
  label: 'Yahoo',
  host: 'imap.mail.yahoo.com',
  port: 993,
  appPassword: {
    url: 'https://login.yahoo.com/account/security/app-passwords',
    steps: { en: 'Generate an app password and copy it.', es: 'Generá una contraseña de app y copiala.' },
  },
};
const outlook: Preset = {
  label: 'Outlook',
  host: 'outlook.office365.com',
  port: 993,
  warning: {
    en: 'Microsoft blocks password login for most personal Outlook/Hotmail accounts. It may fail; OAuth support is planned.',
    es: 'Microsoft bloquea el login con contraseña en la mayoría de las cuentas personales de Outlook/Hotmail. Puede fallar; el soporte OAuth está planeado.',
  },
};

const PRESETS: Record<string, Preset> = {
  'gmail.com': gmail,
  'googlemail.com': gmail,
  'icloud.com': icloud,
  'me.com': icloud,
  'mac.com': icloud,
  'yahoo.com': yahoo,
  'yahoo.com.ar': yahoo,
  'outlook.com': outlook,
  'hotmail.com': outlook,
  'live.com': outlook,
  'aol.com': { label: 'AOL', host: 'imap.aol.com', port: 993 },
  'fastmail.com': { label: 'Fastmail', host: 'imap.fastmail.com', port: 993 },
  'zoho.com': { label: 'Zoho', host: 'imap.zoho.com', port: 993 },
  'gmx.com': { label: 'GMX', host: 'imap.gmx.com', port: 993 },
  'proton.me': {
    label: 'Proton',
    host: '127.0.0.1',
    port: 1143,
    warning: { en: 'Proton needs Proton Mail Bridge running.', es: 'Proton necesita Proton Mail Bridge abierto.' },
  },
};

export const presetFor = (email: string): Preset | undefined =>
  PRESETS[email.split('@')[1]?.toLowerCase() ?? ''];

export const isGmailHost = (host: string): boolean => host === gmail.host;

/**
 * Custom domains (a university, a company) usually run on Google Workspace or Microsoft 365.
 * Their MX records tell which, so the user never has to know an IMAP host.
 */
export function presetForMx(exchanges: string[]): Preset | undefined {
  const mx = exchanges.map((e) => e.toLowerCase().replace(/\.$/, ''));
  if (mx.some((e) => e.endsWith('.google.com') || e.endsWith('.googlemail.com'))) {
    return { ...gmail, label: 'Google Workspace' };
  }
  if (mx.some((e) => e.endsWith('.protection.outlook.com'))) return { ...outlook, label: 'Microsoft 365' };
  return undefined;
}
