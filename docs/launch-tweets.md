# Launch tweets (borrador, rioplatense)

`[corchetes]` = completar con datos reales. Nunca inventar números.

## Pre-lanzamiento (uno cada 2-3 días)

**1. El problema**
> Tengo 4 mails. Trabajo, facultad, personal y uno viejo que no puedo abandonar.
>
> Claude se conecta a UNO solo. Para el resto, nada.
>
> Así que lo estoy construyendo: un MCP que le da a cualquier agente todas tus casillas en una sola consulta. Gratis y open source.

📎 Captura del conector de Gmail con una sola cuenta.

**2. Decisión técnica**
> Dato que nadie te cuenta: si querés que tu app lea Gmail con OAuth "de verdad", Google te pide una auditoría de seguridad anual que sale miles de dólares.
>
> Por eso mi MCP usa contraseñas de aplicación por IMAP. Configurarlo tarda 60 segundos en vez de 20 minutos en Google Cloud.

**3. Seguridad**
> "¿Le vas a dar tu mail a una IA?"
>
> Así lo armé:
> → solo lectura (IMAP EXAMINE: ni siquiera marca como leído)
> → no tiene código para enviar mails
> → cada mail viene marcado como "contenido no confiable", con una etiqueta aleatoria que un mail no puede falsificar
> → contraseñas en el llavero del sistema

**4. Momento humano**
> 3 horas peleando con Docker en Windows porque quedó un socket viejo que ni Windows podía borrar.
>
> Solución: renombrar la carpeta. Docker la recreó y listo.
>
> Construir en público también es esto.

📎 Captura del error de Docker.

## Hilo de lanzamiento

**1/**
> Lancé allinbox: todas tus casillas de mail, una sola consulta, para cualquier agente.
>
> Claude, Codex, Gemini, Cursor. Gmail, iCloud, Yahoo, tu dominio.
>
> Le preguntás "¿qué tengo pendiente esta semana?" y busca en TODAS tus cuentas a la vez.
>
> Gratis, open source y corre en tu compu 🧵

📎 Video de 20 a 30 segundos (lo más importante del lanzamiento).

**2/**
> Se instala así:
>
> npx allinbox
>
> Un asistente te lleva de la mano: detecta tu proveedor, te abre la página para crear la contraseña de app, prueba la conexión y se conecta solo a los agentes que tengas instalados.

📎 GIF del onboarding.

**3/**
> Por qué y no otro MCP de mail:
>
> → una sola consulta para todas las cuentas, sin duplicados
> → limpia citas, firmas y HTML: [X]% menos tokens que [otro MCP]
> → lee hilos enteros en una llamada
> → borradores opcionales que nunca se envían

⚠️ Sin benchmark corrido, sacar la línea del %.

**4/**
> Es mi primer proyecto open source. Si te sirve, una ⭐ ayuda un montón.
>
> Lo que viene: Outlook, búsqueda en años de historial y uso desde el celular.
>
> [link al repo]

## Una semana después
> allinbox en 7 días:
> [N] ⭐ · [N] instalaciones en npm · [N] issues
>
> Lo que más me pidieron: [X]. Ya está en camino.
