# LHC-Forms Demo – FHIR Questionnaire Renderer

Dieses Projekt ist eine **Minimal-Demo**, die zeigt, wie man mit [LHC-Forms](https://lhncbc.github.io/lforms/) FHIR Questionnaires im Browser rendert.  
Es basiert auf **Vite** und nutzt die **WebComponent/Classic API** von LHC-Forms.

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
  - `?minimal=true` → blendet Titel und den Kasten „Gerendertes Formular“ aus
- Erkennung von `modifierExtension` im Questionnaire: Bei Vorkommen wird ein roter Hinweis über dem Formular angezeigt (inkl. der Extension-URL[s])
- Eingebaute UCUM-Unterstützung (`@lhncbc/ucum-lhc`)

---

## Nutzung

### Über die Benutzeroberfläche
- Links im Panel eine **Questionnaire-URL** eingeben, oder **FHIR Base + ID**, oder direkt ein **JSON** einfügen.
- Mit Klick auf **Rendern** wird das Formular im rechten Panel angezeigt.

#### Bespiel zur Einbindung von extern

Hier genutzt im ISiK IG des Formular-Moduls
```
<iframe
  src="https://gefyra.github.io/ISiK-Questionnaire-Tooling-Demo/?q=https://fhir.simplifier.net/isik-stufe-5/Questionnaire/QuestionnaireDemo&minimal=true" style="width:100%; height:800px; border:none; display:block;"></iframe>
```

### Über URL-Parameter
Du kannst Questionnaires auch direkt per URL laden, ohne das linke Panel zu benutzen:

- Komplettes Questionnaire-JSON per URL:
  ```text
  https://<USER>.github.io/<REPO>/?q=https://server/fhir/Questionnaire/123?_format=json
  ```

- Basis-URL + ID:
  ```text
  https://<USER>.github.io/<REPO>/?base=https://server/fhir&id=123
  ```

Wird ein solcher Parameter übergeben, blendet die App das linke Panel automatisch aus und zeigt direkt den geladenen Questionnaire an.

Optional kann zusätzlich `&minimal=true` gesetzt werden, um den Seitentitel und die Box um das gerenderte Formular auszublenden (für schlanke Embeds).

---

## Projektstruktur

```text
LHC-Forms-Demo/
├── index.html       # Einstiegspunkt, enthält Panels und Render-Target
├── src/
│   ├── main.js      # App-Logik, UI-Handler, Auto-Init per URL-Param
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

## Build & Deployment (GitHub Pages)

1. Produktions-Build erstellen
   ```bash
   npm run build
   ```

2. Deployment auf GitHub Pages (Branch `gh-pages`)
   ```bash
   npm run deploy
   ```

3. In den Repository-Einstellungen → **Settings > Pages** den Branch `gh-pages` als Quelle auswählen.  
   Die Demo ist dann erreichbar unter:
   ```text
   https://<USER>.github.io/<REPO>/
   ```

---

## Lizenz

© 2025 Team PT-DATA  
Demo-Projekt für den Einsatz von LHC-Forms mit FHIR Questionnaires.
