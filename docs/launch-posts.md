# Launch posts: X (English) and LinkedIn (ES / EN)

Spanish X version: [launch-tweets.md](launch-tweets.md). `[brackets]` = fill with real data, never invent numbers.
Video for X: 1080p60 render. Video/GIF for the README: `docs/media/`.

## X, English

### Pre-launch (one every 2-3 days)

**1. The problem**
> I have 4 email accounts. Work, university, personal, and an old one I can't let go of.
>
> Claude connects to ONE.
>
> So I'm building an MCP that gives any AI agent all your inboxes in a single query. Free and open source.

📎 Screenshot of the email connector with a single account.

**2. The technical decision**
> Nobody tells you this: to read Gmail through a "proper" shared OAuth app, Google requires a paid yearly security assessment.
>
> So my MCP uses app passwords over IMAP instead. Setup takes 60 seconds, not 20 minutes in Google Cloud Console.

**3. Security**
> "You're giving an AI your email?"
>
> Here's how I built it:
> → read-only (IMAP EXAMINE: it doesn't even mark mail as read)
> → there is no code that can send email
> → every email is tagged "untrusted", with a random tag an email can't forge
> → passwords live in your OS keychain

**4. The human moment**
> Lost 3 hours to Docker on Windows because of a stale socket file that not even Windows could delete.
>
> Fix: rename the folder. Docker recreated it and moved on.
>
> Building in public is also this.

📎 Screenshot of the Docker error.

### Launch thread

**1/**
> I just launched allinbox: all your inboxes, one query, any agent.
>
> Claude, Codex, Gemini, Cursor. Gmail, iCloud, Yahoo, your own domain.
>
> Ask "what do I have pending this week?" and it searches ALL your accounts at once.
>
> Free, open source, runs on your machine 🧵

📎 1080p60 video.

**2/**
> Install:
>
> npx allinbox
>
> A guided setup does the rest: it detects your provider, opens the app-password page already signed in to the right account, tests the login, and connects the agents you have installed.

📎 Onboarding GIF.

**3/**
> Why not just another email MCP:
>
> → one query across every account, duplicates merged
> → strips quoted replies, signatures and HTML: [X]% fewer tokens than [other MCP]
> → reads whole threads in one call
> → optional drafts that can never be sent

⚠️ Drop the % line until the benchmark has run.

**4/**
> It's my first open-source project. If it's useful to you, a ⭐ helps a lot.
>
> Next up: Outlook, search across years of mail, and use from your phone.
>
> [repo link]

### One week later
> allinbox, week one:
> [N] ⭐ · [N] npm installs · [N] issues
>
> Most requested: [X]. Already on it.

## LinkedIn, español

> Tengo cuatro cuentas de mail: trabajo, facultad, personal y una vieja que nunca cerré. El conector de mail de mi asistente de IA llega a una sola.
>
> Así que construí allinbox, mi primer proyecto open source: un servidor MCP que le permite a cualquier agente de IA (Claude, Codex, Gemini, Cursor) buscar en todas tus casillas con una sola consulta.
>
> Le preguntás "¿qué tengo pendiente esta semana?" y te responde con una lista unificada de todas tus cuentas, sin duplicados y sin el ruido de firmas, citas y HTML que consume tokens.
>
> Tres decisiones que me enseñaron más que el código:
>
> 1️⃣ Contraseñas de aplicación en lugar de OAuth. Para leer Gmail con una app OAuth compartida, Google exige una auditoría de seguridad anual paga. Con IMAP y contraseñas de aplicación, la configuración tarda dos minutos y el proyecto puede seguir siendo gratis.
>
> 2️⃣ La seguridad como funcionalidad, no como nota al pie. No tiene código capaz de enviar mails. Abre las casillas en modo solo lectura y trata cada mail como contenido no confiable, para que un mail malicioso no pueda darle órdenes al agente.
>
> 3️⃣ El onboarding es el producto. El asistente de instalación detecta tu proveedor, te abre la página correcta en el navegador y prueba la conexión antes de guardar nada. Lo aprendí probándolo con mis propias cuentas: lo primero que me encontré fue un error de Google que ningún usuario sabría resolver solo.
>
> Corre en tu computadora, sin servidores ni cuentas, y es gratis.
>
> Si lo probás, me encantaría saber qué te funciona y qué no: [link al repo]
>
> #OpenSource #IA #MCP #Productividad

## LinkedIn, English

> I have four email accounts: work, university, personal, and an old one I never closed. My AI assistant's email connector reaches one.
>
> So I built allinbox, my first open-source project: an MCP server that lets any AI agent (Claude, Codex, Gemini, Cursor) search all of your inboxes with a single query.
>
> Ask "what do I have pending this week?" and you get one unified list from every account, deduplicated, without the signatures, quoted replies and HTML noise that burn tokens.
>
> Three decisions that taught me more than the code did:
>
> 1️⃣ App passwords instead of OAuth. Reading Gmail through a shared OAuth app requires a paid yearly security assessment from Google. IMAP with app passwords keeps setup at two minutes and keeps the project free.
>
> 2️⃣ Security as a feature, not a footnote. There is no code that can send email. Mailboxes are opened read-only, and every email is treated as untrusted content, so a malicious message can't give orders to your agent.
>
> 3️⃣ Onboarding is the product. The setup wizard detects your provider, opens the right page in your browser and tests the login before saving anything. I learned this by testing with my own accounts: the first thing I hit was a Google error that no user would know how to fix alone.
>
> It runs on your computer, with no servers and no accounts, and it's free.
>
> If you try it, I'd love to hear what works and what doesn't: [repo link]
>
> #OpenSource #AI #MCP #Productivity
