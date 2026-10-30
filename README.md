# EquiCrewWeb

Die neue Website der EquiCrew FlexCo: ein vollständiger Neuaufbau des bisherigen Webauftritts mit frischem Design. Die Website besteht aus fünf deutschsprachigen Seiten – Start, Über uns, EquiCube, Kontakt und Impressum – sowie einer Datenschutzerklärung und einer eigenen 404-Seite. Sie zeigt die echten Inhalte der alten Seite, die Team-Fotos und die EquiCube-Renderings. Das Kontaktformular sendet Anfragen an eine kleine Kontakt-API, die jede Nachricht serverseitig per SMTP als E-Mail an office@equicrew.com zustellt. Es werden keine Daten gespeichert.

## Technologie

| Bereich | Technik |
|---|---|
| Website (`frontend/`, Dienst `web`) | Reines HTML, CSS und JavaScript (ES-Module), kein Build-Schritt, eine HTML-Datei pro Seite |
| Kontakt-API (`backend/`, Dienst `api`) | Python 3.12+, FastAPI, uvicorn, Pydantic, `smtplib` (Standardbibliothek) für den Mailversand |
| Tests | pytest und ruff für die API, `node --test` für die Formularlogik der Website |
| Datenhaltung | keine – Nachrichten werden nur per E-Mail weitergeleitet |

## Aufbau

```
backend/              Kontakt-API (FastAPI)
  app/main.py         App-Fabrik create_app(), Health-Route, CORS, Fehlerbehandlung
  app/contact.py      POST /api/contact
  app/config.py       Konfiguration aus Umgebungsvariablen
  app/errors.py       Gemeinsames Fehlerformat
  app/schemas.py      Datenmodell des Kontaktformulars
  app/mailer.py       SMTP-Versand
  app/ratelimit.py    Begrenzung der Anfragen pro IP (nur im Arbeitsspeicher)
  tests/              pytest-Tests
frontend/             Statische Website
  index.html          Start
  ueber-uns/          Über uns
  equicube/           EquiCube
  kontakt/            Kontakt mit Formular
  impressum/          Impressum
  datenschutz/        Datenschutzerklärung
  404.html            Seite für unbekannte Adressen
  css/ js/ fonts/ assets/
dev.sh                Startet Website und API gemeinsam für die Entwicklung
RUN.json              Maschinenlesbare Startbeschreibung der Dienste
```

## Installation

Voraussetzungen: Python 3.12 oder neuer, Node.js 20 oder neuer, Bash.

```bash
git clone <repository-url> EquiCrewWeb
cd EquiCrewWeb
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Die Website selbst braucht keine Installation und keine Abhängigkeiten.

## Entwicklung starten

Ein Befehl startet das ganze Produkt – Website und Kontakt-API:

```bash
./dev.sh
```

Danach:

- Website: http://localhost:5500/
- API: http://localhost:8000/api/health

`dev.sh` schreibt zuerst die Website-Konfiguration (`frontend/scripts/write-config.mjs` mit der Adresse der lokalen API), startet dann die API mit uvicorn aus `backend/` und einen statischen Dateiserver (`python -m http.server`) für `frontend/`. Mit `Strg+C` werden beide beendet. Die Ports lassen sich ändern:

```bash
API_PORT=8001 WEB_PORT=5501 ./dev.sh
```

Wichtig: Die Seiten nicht direkt als Datei (`file://`) öffnen – ES-Module und Anfragen an die API funktionieren nur über einen HTTP-Server, wie ihn `dev.sh` startet.

Ohne SMTP-Konfiguration startet alles ganz normal; das Kontaktformular antwortet dann mit einem Hinweis und einem mailto-Link auf office@equicrew.com. Für echten Versand die SMTP-Variablen (siehe unten) vor dem Start in der eigenen Shell setzen:

```bash
export SMTP_HOST=<smtp-server>
export SMTP_PORT=587
export SMTP_USER=<benutzer>
export SMTP_PASSWORD=<passwort>
export SMTP_FROM=<absenderadresse>
./dev.sh
```

### Dienste einzeln starten

API (aus `backend/`):

```bash
cd backend
CORS_ORIGIN=http://localhost:5500 python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Website (aus `frontend/`):

```bash
cd frontend
API_BASE_URL=http://localhost:8000 node scripts/write-config.mjs
python3 -m http.server 5500
```

### Produktion

Es gibt keinen Build-Schritt. Der Inhalt von `frontend/` wird als statische Dateien ausgeliefert (jeder statische Webserver genügt; unbekannte Pfade sollen `404.html` mit Status 404 liefern), die API läuft mit `uvicorn app.main:app --host 0.0.0.0 --port $PORT` aus `backend/`. `CORS_ORIGIN` muss dabei genau die Adresse der Website enthalten.

## Konfiguration (Umgebungsvariablen)

### Kontakt-API

| Variable | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `SMTP_HOST` | extern | – | SMTP-Server. Ohne ihn antwortet `POST /api/contact` mit 503. |
| `SMTP_PORT` | extern | `587` | Port des SMTP-Servers |
| `SMTP_USER` | extern | – | SMTP-Benutzername (optional) |
| `SMTP_PASSWORD` | extern | – | SMTP-Passwort (optional) |
| `SMTP_FROM` | extern | – | Absenderadresse der Kontakt-Mails. Ohne sie antwortet `POST /api/contact` mit 503. |
| `CONTACT_TO` | nein | `office@equicrew.com` | Empfänger der Kontakt-Mails |
| `CORS_ORIGIN` | nein | – | Die einzige Browser-Adresse (Origin) der Website, die die API aufrufen darf. Ohne Wert erlaubt die API keinem fremden Origin den Zugriff. |
| `PORT` | nein | `8000` | Port der API (wird beim Start an uvicorn übergeben) |

Die SMTP-Zugangsdaten sind extern: Sie werden nie ins Repository eingecheckt, sondern nur in der Umgebung des Servers gesetzt.

### Website

| Variable | Bedeutung |
|---|---|
| `API_BASE_URL` | Adresse der Kontakt-API; `frontend/scripts/write-config.mjs` schreibt sie in die Website-Konfiguration |
| `PORT` | Port des statischen Servers |

## Benutzung

### Seiten

| Adresse | Seite |
|---|---|
| `/` | Start – Mission, Crew-Teaser, EquiCube-Teaser, Aufruf „Neugierig geworden?“ |
| `/ueber-uns/` | Über uns – Crew-Text, Teamfoto, die drei Gründer mit mailto-Links |
| `/equicube/` | EquiCube – Produkttext, Rendering, Features und „Vorteile des EquiCubes“, Button „Jetzt anfragen!“ |
| `/kontakt/` | Kontakt – Adresse, E-Mail, Telefon und Kontaktformular |
| `/impressum/` | Impressum inkl. Offenlegung nach § 25 MedienG |
| `/datenschutz/` | Datenschutzerklärung nach Art. 13 DSGVO |
| unbekannte Adresse | deutsche 404-Seite mit Link zur Startseite |

Jede Seite hat eine Kopfzeile mit Navigation (Start, Über uns, EquiCube, Kontakt, Impressum; die aktuelle Seite ist markiert) und eine Fußzeile mit Adresse, E-Mail, Telefon und Links zu Kontakt, Impressum und Datenschutz. Auf schmalen Bildschirmen klappt die Navigation in einen Menü-Button zusammen, der sich mit Maus, Touch und Tastatur bedienen lässt.

### Kontaktformular

1. Auf `/kontakt/` Vorname, Nachname, E-Mail und Nachricht (höchstens 5000 Zeichen) eingeben.
2. Hinweise zu fehlerhaften Feldern erscheinen erst, wenn ein Feld verlassen oder „Senden“ gedrückt wurde.
3. „Senden“ schickt die Daten an `POST /api/contact`; währenddessen ist der Button gesperrt.
4. Bei Erfolg erscheint „Danke für deine Nachricht!“ und das Formular wird geleert. Die API sendet eine E-Mail an `CONTACT_TO` mit Vor- und Nachname, der Absenderadresse als Reply-To und der Nachricht.
5. Bei einem Fehler bleibt die Eingabe erhalten und eine deutsche Meldung erscheint – bei fehlender SMTP-Konfiguration mit einem mailto-Link auf office@equicrew.com, bei zu vielen Anfragen mit dem Hinweis „zu viele Anfragen“.

### API-Endpunkte

#### `GET /api/health`

Antwortet immer mit 200, auch ohne SMTP-Konfiguration.

```json
{"status": "ok"}
```

#### `POST /api/contact`

Body (JSON):

```json
{
  "first_name": "Erika",
  "last_name": "Muster",
  "email": "erika@example.com",
  "message": "Hallo EquiCrew!",
  "website": ""
}
```

`website` ist ein verstecktes Feld gegen Spam-Bots und muss leer bleiben. Vorname, Nachname und E-Mail dürfen keine Zeilenumbrüche enthalten, die Nachricht höchstens 5000 Zeichen lang sein.

Antworten:

| Status | Bedeutung |
|---|---|
| 200 | `{"ok": true}` – Nachricht versendet (bei ausgefülltem Honeypot-Feld ebenfalls, aber ohne Versand) |
| 413 | `payload_too_large` – Anfrage zu groß |
| 422 | `validation_error` – ungültige Felder, mit deutscher Meldung pro Feld |
| 429 | `rate_limited` – mehr als 5 Anfragen pro IP innerhalb von 10 Minuten |
| 500 | `mail_failed` – der Versand ist fehlgeschlagen |
| 503 | `mail_unavailable` – SMTP ist nicht konfiguriert |

Jede Fehlerantwort hat dasselbe Format, mit einer deutschen Meldung und ohne technische Details (keine Stacktraces, keine SMTP-Daten):

```json
{
  "error": {
    "code": "validation_error",
    "message": "Bitte überprüfe deine Eingaben.",
    "fields": {"email": "Bitte gib eine gültige E-Mail-Adresse ein."}
  }
}
```

`fields` gibt es nur bei 422 (Schlüssel `first_name`, `last_name`, `email`, `message`). Unerwartete Fehler antworten mit 500 und dem Code `internal_error`; die Details landen nur im Server-Log.

## Tests

API (aus `backend/`):

```bash
cd backend
PYTHONPATH=. python -m pytest
ruff format --check .
ruff check .
```

Website (aus `frontend/`):

```bash
cd frontend
node --test tests/*.test.mjs
```

## Funktionen

- Fünf Seiten (Start, Über uns, EquiCube, Kontakt, Impressum) plus Datenschutz und 404-Seite, jede mit eigenem deutschen Titel, Meta-Beschreibung und Open-Graph-Angaben; alle Inhalte stehen direkt im HTML
- Responsive Gestaltung ohne horizontales Scrollen, Menü-Button auf kleinen Bildschirmen
- Kontaktformular mit Validierung erst nach Interaktion, Sendezustand, Erfolgs- und Fehlermeldungen
- Serverseitiger Mailversand per SMTP an office@equicrew.com (Empfänger konfigurierbar)
- Schutz der API: Honeypot-Feld, Begrenzung auf 5 Anfragen pro IP in 10 Minuten (nur im Arbeitsspeicher, höchstens 10 Minuten), Größenlimit für Anfragen, keine Zeilenumbrüche in Mail-Kopfzeilen
- CORS erlaubt ausschließlich die konfigurierte Website-Adresse, ohne Credentials
- Einheitliches Fehlerformat mit deutschen Meldungen, ohne interne Details
- Läuft ohne SMTP-Konfiguration weiter: Health-Route antwortet 200, das Formular verweist dann per mailto-Link auf office@equicrew.com
