# LHC-Forms Demo – FHIR Questionnaire Renderer

Dieses Projekt ist eine **Minimal-Demo**, die zeigt, wie man mit [LHC-Forms](https://lhncbc.github.io/lforms/) FHIR Questionnaires im Browser rendert.  
Es basiert auf **Vite** und nutzt die **WebComponent/Classic API** von LHC-Forms.

Live-Demo: https://gematik.github.io/poc-isik-formular/

---

## Features

- **Questionnaire per URL** laden (`?_format=json`)
- **Von FHIR-Server per ID** laden (Base + ID)
- **Direktes Einfügen** von Questionnaire JSON
- **Beispiel-Questionnaire** laden
- Rendern des Formulars im `<lhc-forms>` WebComponent
- Unterstützung für **URL-Parameter**:
  - `?q=URL` oder `?questionnaire=URL` → rendert direkt und blendet den linken Panel aus
  - `?base=FHIRBase&id=QuestionnaireId` → lädt und rendert direkt
  - `?minimal=true` → Minimal-Layout ohne Export-Buttons (für schlanke Embeds)
  - `?minimal=withButtons` → Minimal-Layout mit Export-Buttons
- Erkennung von `modifierExtension` im Questionnaire: Bei Vorkommen wird ein roter Hinweis über dem Formular angezeigt (inkl. der Extension-URL[s])
  - Prepopulation-Support (SDC): Wenn `base` gesetzt ist, wird diese URL als FHIR-Server-Kontext genutzt. Optional können Launch-Context-IDs übergeben werden:
    - `?patient=123` → lädt `Patient/123` von `base`
    - `?encounter=456` → lädt `Encounter/456` von `base`
    - `?user=789` → lädt `Practitioner/789` von `base`
    Diese Ressourcen werden als Launch-Context an LHC-Forms übergeben. Zusätzlich werden relative x-fhir-query Aufrufe über denselben FHIR-Server ausgeführt.
- Eingebaute UCUM-Unterstützung (`@lhncbc/ucum-lhc`)
 - **Extraction/Export**: Zwei Buttons unter dem Formular öffnen eine Ergebnis-Seite (`result.html`) mit Tabs:
   - „Zeige QuestionnaireResponse“ → extrahierte QuestionnaireResponse als JSON
   - „Zeige QR + Observations“ → QuestionnaireResponse plus per SDC-Observation-Extraction erzeugte Observations
   - Ergebnis-Seite zeigt Ressourcen als JSON (kopierbar) im Vollbild
  
Zusätzlich:
- Eigene Resolver-Seite `resolve.html` zur Auflösung logischer Identifier vor dem Start:
  - `pid`: Patient.identifier → sucht `Patient?identifier={pid}` und wählt/erzwingt Auswahl
  - `fid`: Account.identifier → sucht `Account?identifier={fid}` und wählt/erzwingt Auswahl
  - `qCanonical`: Questionnaire canonical (`url` bzw. `url|version`) → sucht `Questionnaire?url=... [&version=...]`
  - Weiterleitung zu `index.html` mit aufgelösten IDs (`base+id` oder `q`) und vorhandenen Kontext-Parametern
  - Eingebauter URL‑Builder inkl. „Kopieren“-Button
  - Hinweis: `index.html` setzt den FHIR‑Kontext jetzt auch, wenn nur `base`/`prepopBase` und z. B. `patient` übergeben werden (ohne Auto‑Render)

---

## Nutzung

### Über die Benutzeroberfläche
- Links im Panel eine **Questionnaire-URL** eingeben, oder **FHIR Base + ID**, oder direkt ein **JSON** einfügen.
- Mit Klick auf **Rendern** wird das Formular im rechten Panel angezeigt.

#### Bespiel zur Einbindung von extern

Hier genutzt im ISiK IG des Formular-Moduls
```
<iframe
  src="https://gematik.github.io/poc-isik-formular/?q=https://fhir.simplifier.net/isik-stufe-5/Questionnaire/QuestionnaireDemo&minimal=true" style="width:100%; height:800px; border:none; display:block;"></iframe>
```

### Über URL-Parameter
Du kannst Questionnaires auch direkt per URL laden, ohne das linke Panel zu benutzen:

- Komplettes Questionnaire-JSON per URL:
  ```text
  https://gematik.github.io/poc-isik-formular/?q=https://server/fhir/Questionnaire/123?_format=json
  ```

- Basis-URL + ID:
  ```text
  https://gematik.github.io/poc-isik-formular/?base=https://server/fhir&id=123
  ```

Optional kann zusätzlich `&minimal=true` (ohne Buttons) bzw. `&minimal=withButtons` (mit Buttons) gesetzt werden, um den Seitentitel und den Rahmen um das Formular auszublenden.

---

## Resolver-Seite (resolve.html)

Wenn statt interner IDs logische Identifier verwendet werden sollen, hilft die Resolver-Seite dabei, vor dem Start passende Ressourcen zu finden und die richtigen Parameter für `index.html` zusammenzustellen.

Unterstützte Parameter auf `resolve.html`:
- `base`: FHIR‑Basis‑URL (benötigt für alle Suchen)
- `pid`: Patient‑Identifier (z. B. `SYS|VAL`), Suche: `Patient?identifier=...`
- `fid`: Account‑Identifier, Suche: `Account?identifier=...`
- `qCanonical`: Canonical des Questionnaires, optional mit Version `url|version`, Suche: `Questionnaire?url=... [&version=...]`
- Pass‑through: `prepopBase`, `patient`, `encounter`, `user`, `id`, `q`, `minimal`

Ablauf:
- `resolve.html` führt die Suchen aus. Bei genau einem Treffer wird automatisch ausgewählt; bei mehreren wirst du um Auswahl gebeten (es werden sinnvolle Infos angezeigt: Patient Name/Geburtsdatum/Geschlecht/Identifier, Account Name/Status/Identifier, Questionnaire Titel/Version/URL).
- Danach Weiterleitung zu `index.html` mit den aufgelösten Parametern:
  - Bevorzugt `base` + `id` für den Questionnaire, ansonsten `q` (komplette URL)
  - Kontext‑Parameter (`patient`, `encounter`, `user`, optional `prepopBase`) werden übernommen; `account` wird ebenfalls übergeben (kann später genutzt werden)
- Auf der Resolver‑Seite gibt es einen URL‑Builder mit Kopier‑Button, der die aktuelle `resolve.html`‑URL zusammenstellt.

Beispiele:
- Patient per Identifier und Questionnaire per Canonical auflösen:
  ```text
  resolve.html?base=http://localhost:8080/fhir&pid=INS|12345&qCanonical=http://example.org/fhir/Questionnaire/my-form|1.0.0
  ```
- Account per Identifier auflösen:
  ```text
  resolve.html?base=http://localhost:8080/fhir&fid=ACCTSYS|9988
  ```

Hinweis zu `index.html`:
- Der FHIR‑Kontext wird jetzt auch gesetzt, wenn nur `base`/`prepopBase` und eines von `patient`/`encounter`/`user` per URL übergeben werden – selbst wenn kein Questionnaire automatisch geladen wird. Dadurch greift die Prepopulation sofort, sobald später ein Formular geladen wird.

---

## SMART App Launch

- Einstieg ueber `launch.html`, z. B. `launch.html?iss=https://launch.smarthealthit.org/v/r4/sim/eyJrIjoiMSJ9/fhir&launch=123`, optional mit eigenen Parametern `client_id`, `scope` oder `redirect_uri`.
- Standardwerte fuer `client_id` und `scope` stehen in `src/lib/smart.js` als `SMART_DEFAULTS` und koennen dort angepasst oder per Query-Parameter ueberschrieben werden.
- Die Launch-Seite fuehrt SMART Discovery (Well-Known oder FHIR CapabilityStatement), erzeugt ein PKCE-Paar, speichert den Pending-State in `sessionStorage` und leitet zum Authorization Server weiter.
- Nach dem Redirect zu `index.html` tauscht die App den Code gegen Tokens, uebernimmt Patient/Encounter/User aus dem Token und sendet automatisch `Authorization`-Header bei allen FHIR-Requests.
- Die erhaltenen Tokens gelten fuer die laufende Browser-Session; laeuft ein Token ab oder der Austausch scheitert, erscheint ein Hinweis und der Launch muss erneut gestartet werden.

## Projektstruktur

```text
LHC-Forms-Demo/
├── index.html       # Einstiegspunkt, enthält Panels und Render-Target
├── resolve.html     # Resolver-Seite für pid/fid/qCanonical und Weiterleitung
├── src/
│   ├── main.js      # App-Logik, UI-Handler, Auto-Init per URL-Param
│   ├── resolve.js   # Logik der Resolver-Seite (FHIR-Suchen, Auswahl, Redirect)
│   ├── result.js    # Ergebnis-Seite mit Tab-JSON-Ausgabe für Export
│   └── main.css     # Minimale Styles (helles Theme)
├── package.json     # Projektdefinition mit Vite und gh-pages
└── vite.config.js   # Vite-Konfiguration (Base-Pfad für GitHub Pages)
```

---

## Installation & Entwicklung

1. Repository klonen
   ```bash
   git clone https://github.com/<USER>/<REPO>.git
   cd <REPO>
   ```

2. Abhängigkeiten installieren
   ```bash
   npm install
   ```

3. Dev-Server starten
   ```bash
   npm run dev
   ```
   → Anwendung läuft unter `http://localhost:5173`

---

## Tests

Wir nutzen Vitest (mit jsdom) für Unit-Tests der Hilfsfunktionen.

- Installation: `npm install`
- Ausführen: `npm test`
- Watch-Mode: `npm run test:watch`
- Coverage: `npm run coverage`

Die Tests liegen unter `tests/` und greifen über einen dedizierten `__test__`‑Export sowie reine Helfer in `src/lib/helpers.js` auf ausgewählte Funktionen zu. UI‑lastige und netzwerkende Funktionen werden über jsdom und Fetch‑Mocks isoliert.

Hinweis: Für das Ausführen der Tests wird eine lokale Node.js‑Umgebung (empfohlen: Node 18+) benötigt.

---

## Build & Deployment (GitHub Pages)

1. Produktions-Build erstellen
   ```bash
   npm run build
   ```

2. Deployment auf GitHub Pages (Branch `gh-pages`)
   - Automatisiert über GitHub Actions: Bei `push` auf `main` werden die **Tests** ausgeführt und bei Erfolg der **Build** nach `gh-pages` veröffentlicht.
   - Manuell (optional): `npm run deploy`

3. GitHub Pages konfigurieren: In den Repository-Einstellungen → **Settings > Pages** den Branch `gh-pages` als Quelle auswählen.  
   Live-Demo: https://gematik.github.io/poc-isik-formular

---


## License

Copyright 2025 gematik GmbH

Apache License, Version 2.0

See the [LICENSE](./LICENSE) for the specific language governing permissions and limitations under the License

## Additional Notes and Disclaimer from gematik GmbH

1. Copyright notice: Each published work result is accompanied by an explicit statement of the license conditions for use. These are regularly typical conditions in connection with open source or free software. Programs described/provided/linked here are free software, unless otherwise stated.
2. Permission notice: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
    1. The copyright notice (Item 1) and the permission notice (Item 2) shall be included in all copies or substantial portions of the Software.
    2. The software is provided "as is" without warranty of any kind, either express or implied, including, but not limited to, the warranties of fitness for a particular purpose, merchantability, and/or non-infringement. The authors or copyright holders shall not be liable in any manner whatsoever for any damages or other claims arising from, out of or in connection with the software or the use or other dealings with the software, whether in an action of contract, tort, or otherwise.
    3. The software is the result of research and development activities, therefore not necessarily quality assured and without the character of a liable product. For this reason, gematik does not provide any support or other user assistance (unless otherwise stated in individual cases and without justification of a legal obligation). Furthermore, there is no claim to further development and adaptation of the results to a more current state of the art.
3. Gematik may remove published results temporarily or permanently from the place of publication at any time without prior notice or justification.
4. Please note: Parts of this code may have been generated using AI-supported technology. Please take this into account, especially when troubleshooting, for security analyses and possible adjustments.