  <script>
    const el = (id) => document.getElementById(id);
    const status = (msg, cls) => { const s = el('status'); s.className = cls||''; s.textContent = msg||''; };

    async function loadQuestionnaireFromUrl(url) {
      status('Lade Questionnaire von URL …');
      const res = await fetch(url, { headers: { 'Accept': 'application/fhir+json' } });
      if (!res.ok) throw new Error('HTTP '+res.status+' beim Laden von '+url);
      return await res.json();
    }

    async function loadQuestionnaireFromServer(base, id) {
      const sep = base.endsWith('/') ? '' : '/';
      const url = base + sep + 'Questionnaire/' + encodeURIComponent(id) + '?_format=json';
      return await loadQuestionnaireFromUrl(url);
    }

    function renderQuestionnaire(q) {
      // Versuche: FHIR Questionnaire → LForms konvertieren und rendern
      try {
        // Der zweite Parameter gibt die FHIR‑Version an; LForms erkennt häufig auch automatisch.
        /*const lf = LForms.Util.convertFHIRQuestionnaireToLForms(q, 'R4');
        const target = el('renderTarget');
        target.innerHTML = '';
        LForms.Util.addFormToPage(lf, target);*/
        const el = document.createElement('lhc-forms')
        el.fhirVersion = 'R4' | 'R5'
        el.questionnaire = q
        renderTarget.appendChild(el)
        status('Erfolgreich gerendert ✅', 'ok');
      } catch (e) {
        console.error(e);
        status('Konvertierung/Rendering fehlgeschlagen: '+e.message, 'err');
      }
    }

    // UI Handlers
    el('btnLoadUrl').onclick = async () => {
      try {
        const url = el('fhirUrl').value.trim();
        if (!url) return status('Bitte eine URL angeben.', 'err');
        const q = await loadQuestionnaireFromUrl(url);
        el('jsonArea').value = JSON.stringify(q, null, 2);
        renderQuestionnaire(q);
      } catch (e) { status(e.message, 'err'); }
    };

    el('btnLoadServer').onclick = async () => {
      try {
        const base = el('fhirBase').value.trim();
        const id = el('qId').value.trim();
        if (!base || !id) return status('Bitte Base‑URL und ID angeben.', 'err');
        const q = await loadQuestionnaireFromServer(base, id);
        el('jsonArea').value = JSON.stringify(q, null, 2);
        renderQuestionnaire(q);
      } catch (e) { status(e.message, 'err'); }
    };

    el('btnRenderJson').onclick = () => {
      try {
        const txt = el('jsonArea').value.trim();
        if (!txt) return status('Bitte Questionnaire JSON einfügen.', 'err');
        const q = JSON.parse(txt);
        renderQuestionnaire(q);
      } catch (e) { status('JSON‑Fehler: '+e.message, 'err'); }
    };

    el('btnLoadSample').onclick = () => {
      const sample = {
        resourceType: 'Questionnaire',
        status: 'active',
        title: 'Demo: Patient Intake',
        id: 'demo-intake',
        item: [
          { linkId: 'name', text: 'Name', type: 'string' },
          { linkId: 'birthDate', text: 'Geburtsdatum', type: 'date' },
          { linkId: 'gender', text: 'Geschlecht', type: 'choice', answerOption: [
            { valueCoding: { code: 'male', display: 'männlich' }},
            { valueCoding: { code: 'female', display: 'weiblich' }},
            { valueCoding: { code: 'other', display: 'divers' }}
          ]},
          { linkId: 'symptoms', text: 'Symptome', type: 'open-choice' },
          { linkId: 'smoker', text: 'RaucherIn?', type: 'boolean' },
          { linkId: 'height', text: 'Größe (cm)', type: 'decimal' }
        ]
      };
      el('jsonArea').value = JSON.stringify(sample, null, 2);
      status('Beispiel geladen. Jetzt „Rendern“ klicken oder automatisch rendern …');
      renderQuestionnaire(sample);
    };

    el('btnClear').onclick = () => {
      el('jsonArea').value = '';
      el('renderTarget').innerHTML = '';
      status('Zurückgesetzt.');
    };

    // Sanity‑check: LForms geladen?
    window.addEventListener('load', () => {
      const ready = !!(window.customElements && customElements.get('lhc-forms'));
      const ucumOk = typeof window.UcumLhcUtils !== 'undefined';
      if (ready && ucumOk) {
        status('LHC-Forms geladen...', 'ok');
      } else {
        status('LHC-Forms nicht geladen...', 'err');
      }
    });
  </script>