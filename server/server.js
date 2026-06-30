require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');
const multer = require('multer');
const OpenAI = require('openai');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/pdf', express.static('data/pdf'));

/* ── Chemins ── */
const DATA_DIR   = path.join(__dirname, 'data');
const DOCS_FILE  = path.join(DATA_DIR, 'documents.json');
const CTR_FILE   = path.join(DATA_DIR, 'compteurs.json');
const PDF_DIR    = path.join(DATA_DIR, 'pdf');
const CFG_FILE   = path.join(__dirname, 'config', 'entreprise.json');
const TMPL_FILE  = path.join(__dirname, 'templates', 'document.html');

/* ── Initialisation dossiers ── */
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PDF_DIR,  { recursive: true });
if (!fs.existsSync(CTR_FILE))  fs.writeFileSync(CTR_FILE,  '{}', 'utf8');
if (!fs.existsSync(DOCS_FILE)) fs.writeFileSync(DOCS_FILE, '[]', 'utf8');
const CHROME_PATH = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* ── Clients API (initialisés à la demande pour ne pas crasher sans clés) ── */
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY manquante dans .env');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/* ── Parser local (sans Claude) ── */
function parseTranscription(texte) {
  const t = texte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Extraction client
  let client = '';
  const clientMatch = t.match(/(?:client|pour|chez|monsieur|madame|mr?|mme?)\s+([a-z][a-z\- ]{1,30})(?:\s*[,.]|$)/);
  if (clientMatch) client = clientMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase());

  // Extraction adresse/ville
  const villes = ['perpignan','canet','pia','rivesaltes','saint-esteve','le soler','thuir','argeles','collioure','elne','narbonne','montpellier'];
  let adresse = '';
  for (const v of villes) {
    if (t.includes(v)) { adresse = v.replace(/\b\w/g, c => c.toUpperCase()); break; }
  }

  // Catalogue de prestations avec prix indicatifs
  const catalogue = [
    { rx: /multi.?split|multi split/,         label: 'Climatisation multi-split',              pu: 2800, tva: 10 },
    { rx: /pompe.?a.?chaleur|pac/,            label: 'Pompe à chaleur air/air',                pu: 4500, tva: 10 },
    { rx: /salle.?de.?bain|renov.*sdb|sdb/,  label: 'Rénovation salle de bain',               pu: 3200, tva: 10 },
    { rx: /chauffe.?eau.*270|ballon.*270/,    label: 'Chauffe-eau thermodynamique 270L',       pu: 1800, tva: 10 },
    { rx: /chauffe.?eau|ballon/,              label: 'Chauffe-eau thermodynamique',             pu: 1400, tva: 10 },
    { rx: /clim.*split|split/,                label: 'Climatisation split',                     pu: 1800, tva: 10 },
    { rx: /climatisation|clim/,               label: 'Climatisation split',                     pu: 1800, tva: 10 },
    { rx: /entretien/,                        label: 'Entretien climatisation',                 pu: 120,  tva: 20 },
    { rx: /depannage|plomberie/,              label: 'Dépannage plomberie',                     pu: 150,  tva: 20 },
    { rx: /robinet|mitigeur/,                 label: 'Remplacement robinet/mitigeur',           pu: 180,  tva: 10 },
    { rx: /wc|toilette/,                      label: 'Remplacement WC',                         pu: 350,  tva: 10 },
    { rx: /radiateur/,                        label: 'Remplacement radiateur',                  pu: 400,  tva: 10 },
  ];

  const lignes = [];
  for (const item of catalogue) {
    if (item.rx.test(t)) {
      // Cherche une quantité avant ou après le mot-clé
      const qteMatch = t.match(/(\d+)\s*(?:unite|unites|fois|x\s*)?\s*(?:clim|pompe|ballon|radiateur|robinet)/);
      const qte = qteMatch ? parseInt(qteMatch[1]) : 1;
      // Cherche un prix mentionné
      const prixMatch = t.match(/(\d[\d\s]*)\s*(?:euro|eur|€)/);
      const pu = prixMatch ? parseInt(prixMatch[1].replace(/\s/g, '')) : item.pu;
      lignes.push({ designation: item.label, quantite: qte, prix_unitaire_ht: pu, taux_tva: item.tva });
      break;
    }
  }

  // Si aucune prestation reconnue, crée une ligne générique
  if (!lignes.length) {
    lignes.push({ designation: texte, quantite: 1, prix_unitaire_ht: 0, taux_tva: 20 });
  }

  return { client, adresse, lignes };
}

/* ── Upload audio en mémoire ── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 Mo max (limite Whisper)
});

/* ── Utilitaires JSON ── */
function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data){
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/* ── Numérotation séquentielle ── */
function nextNumero(type) {
  const ctr  = readJSON(CTR_FILE, {});
  const year = new Date().getFullYear();
  ctr[type]  = (ctr[type] || 0) + 1;
  writeJSON(CTR_FILE, ctr);
  const prefix = type === 'devis' ? 'DEV' : 'FAC';
  return `${prefix}-${year}-${String(ctr[type]).padStart(4, '0')}`;
}

/* ── Calculs HT/TVA/TTC ── */
function calcTotaux(lignes) {
  // Accepte qte/pu_ht/tva OU quantite/prix_unitaire_ht/taux_tva
  const norm = l => ({
    qte  : Number(l.qte   || l.quantite          || 1),
    pu_ht: Number(l.pu_ht || l.prix_unitaire_ht  || 0),
    tva  : Number(l.tva   || l.taux_tva          || 20),
  });
  const totalHT = lignes.reduce((s, l) => { const n=norm(l); return s + n.qte * n.pu_ht; }, 0);
  const tvaMap  = {};
  for (const l of lignes) {
    const n = norm(l);
    const base = n.qte * n.pu_ht;
    tvaMap[n.tva] = (tvaMap[n.tva] || 0) + base;
  }
  const tvaDetails = Object.entries(tvaMap).map(([taux, base]) => ({
    taux    : parseFloat(taux),
    base    : round2(base),
    montant : round2(base * parseFloat(taux) / 100),
  }));
  const totalTVA = round2(tvaDetails.reduce((s, t) => s + t.montant, 0));
  return { totalHT: round2(totalHT), tvaDetails, totalTVA, totalTTC: round2(totalHT + totalTVA) };
}
function round2(n) { return Math.round(n * 100) / 100; }

/* ── Formatage ── */
function fmtEur(n)   { return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
function fmtDate(iso){ if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function addDays(iso, n){ const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

/* ── Rendu HTML → PDF ── */
function renderHTML(doc, entreprise) {
  const tmpl    = fs.readFileSync(TMPL_FILE, 'utf8');
  const isDevis = doc.type === 'devis';
  const cfg     = entreprise;
  const { totalHT, tvaDetails, totalTVA, totalTTC } = calcTotaux(doc.lignes);
  const dateEcheance = !isDevis && doc.date_prestation
    ? fmtDate(addDays(doc.date_prestation, 30)) : '';

  const lignesHTML = doc.lignes.map((l, i) => {
    const qte   = Number(l.qte   || l.quantite         || 1);
    const pu_ht = Number(l.pu_ht || l.prix_unitaire_ht || 0);
    const tva   = Number(l.tva   || l.taux_tva         || 20);
    const tot   = round2(qte * pu_ht);
    return `<tr class="${i % 2 === 1 ? 'alt' : ''}">
      <td>${l.designation}</td>
      <td class="center">${qte}</td>
      <td class="right">${fmtEur(pu_ht)}</td>
      <td class="center">${tva} %</td>
      <td class="right">${fmtEur(tot)}</td>
    </tr>`;
  }).join('');

  const tvaHTML = cfg.tva_regime === 'franchise'
    ? `<tr><td colspan="2" class="mention-franchise">TVA non applicable, art. 293 B du CGI</td></tr>`
    : tvaDetails.map(t =>
        `<tr><td>TVA ${t.taux} %</td><td class="right">${fmtEur(t.montant)}</td></tr>`
      ).join('');

  const sigHTML = isDevis ? `
    <div class="signature-block">
      <p class="mention-devis">Devis reçu avant l'exécution des travaux.</p>
      <p class="mention-devis">Bon pour accord — Date et signature du client :</p>
      <div class="sig-zone"></div>
    </div>` : '';

  const penalitesHTML = !isDevis ? `
    <p class="penalites">Pénalités de retard : taux légal en vigueur × 3, exigibles dès le lendemain de la date d'échéance.
    Indemnité forfaitaire pour frais de recouvrement (clients professionnels) : 40 €.</p>` : '';

  const logoSrc = fs.existsSync(path.join(__dirname, 'config', 'logo.png'))
    ? 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'config', 'logo.png')).toString('base64')
    : '';

  return tmpl
    .replace(/{{TITRE}}/g,              isDevis ? 'DEVIS' : 'FACTURE')
    .replace(/{{NUMERO}}/g,             doc.numero)
    .replace(/{{DATE_EMISSION}}/g,      fmtDate(doc.date_emission))
    .replace(/{{COULEUR_PRINCIPALE}}/g, cfg.couleur_principale)
    .replace(/{{COULEUR_ACCENT}}/g,     cfg.couleur_accent)
    .replace(/{{ENT_DENOMINATION}}/g,   cfg.denomination)
    .replace(/{{ENT_DIRIGEANT}}/g,      cfg.dirigeant)
    .replace(/{{ENT_ADRESSE1}}/g,       cfg.adresse_ligne1)
    .replace(/{{ENT_ADRESSE2}}/g,       cfg.adresse_ligne2)
    .replace(/{{ENT_SIRET}}/g,          cfg.siret)
    .replace(/{{ENT_FORME}}/g,          cfg.forme_juridique)
    .replace(/{{ENT_TEL}}/g,            cfg.tel)
    .replace(/{{ENT_EMAIL}}/g,          cfg.email)
    .replace(/{{ENT_TVA_NUM}}/g,        cfg.tva_regime === 'assujetti' ? `N° TVA : ${cfg.tva_numero}` : '')
    .replace(/{{LOGO_SRC}}/g,           logoSrc)
    .replace(/{{CLI_NOM}}/g,            doc.client.nom)
    .replace(/{{CLI_ADRESSE}}/g,        (doc.client.adresse || '').replace(/\n/g, '<br>'))
    .replace(/{{CLI_SIRET}}/g,          doc.client.siret ? `SIRET : ${doc.client.siret}` : '')
    .replace(/{{LIGNES}}/g,             lignesHTML)
    .replace(/{{TOTAL_HT}}/g,           fmtEur(totalHT))
    .replace(/{{TVA_LIGNES}}/g,         tvaHTML)
    .replace(/{{TOTAL_TVA}}/g,          fmtEur(totalTVA))
    .replace(/{{TOTAL_TTC}}/g,          fmtEur(totalTTC))
    .replace(/{{CONDITIONS_REGLEMENT}}/g, cfg.conditions_reglement)
    .replace(/{{SIGNATURE_BLOCK}}/g,    sigHTML)
    .replace(/{{PENALITES}}/g,          penalitesHTML)
    .replace(/{{VALIDITE}}/g,           isDevis
      ? `<p class="validite">Devis valable ${cfg.delai_validite_devis} jours à compter de sa date d'émission.</p>`
      : '')
    .replace(/{{DATE_ECHEANCE_ROW}}/g,  !isDevis && dateEcheance
      ? `<tr><td>Date d'échéance</td><td>${dateEcheance}</td></tr>` : '')
    .replace(/{{DATE_PRESTA_ROW}}/g,    !isDevis && doc.date_prestation
      ? `<tr><td>Date de prestation</td><td>${fmtDate(doc.date_prestation)}</td></tr>` : '')
    .replace(/{{MENTION_PIED}}/g,       cfg.mention_pied)
    .replace(/{{CERTIFICATIONS}}/g,     cfg.certifications);
}

async function generatePDF(doc, entreprise) {
  const html    = renderHTML(doc, entreprise);
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const page    = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  const pdfPath = path.join(PDF_DIR, `${doc.numero}.pdf`);
  await page.pdf({ path: pdfPath, format: 'A4', margin: { top: 0, right: 0, bottom: 0, left: 0 }, printBackground: true });
  await browser.close();
  return pdfPath;
}

/* ════════════════════════════════════════
   API — TRANSCRIPTION VOCALE
   ════════════════════════════════════════ */
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier audio reçu.' });

    const openai = getOpenAI();

    /* ── 1. Déterminer l'extension depuis le MIME réel du blob ── */
    const mimeToExt = {
      'audio/webm'  : 'webm',
      'audio/mp4'   : 'mp4',
      'audio/mpeg'  : 'mp3',
      'audio/ogg'   : 'ogg',
      'audio/wav'   : 'wav',
      'audio/x-m4a' : 'm4a',
      'audio/aac'   : 'aac',
    };
    const mime = req.file.mimetype || 'audio/webm';
    const ext  = mimeToExt[mime] || 'webm';

    /* ── 2. Écrire dans un fichier temporaire (Whisper nécessite un fichier) ── */
    const tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}.${ext}`);
    fs.writeFileSync(tmpPath, req.file.buffer);

    /* ── 3. Transcription Whisper ── */
    const transcription = await openai.audio.transcriptions.create({
      file    : fs.createReadStream(tmpPath),
      model   : 'whisper-1',
      language: 'fr',
    });
    fs.unlinkSync(tmpPath);

    const texte = transcription.text?.trim();
    if (!texte) return res.status(422).json({ error: 'Transcription vide — réessayez en parlant plus fort.' });

    /* ── 4. Extraction structurée en local (sans Claude) ── */
    const parsed = parseTranscription(texte);
    const data = {
      client : parsed.client,
      adresse: parsed.adresse,
      lignes : parsed.lignes.map(l => ({
        designation  : l.designation,
        qte          : Number(l.quantite) || 1,
        pu_ht        : Number(l.prix_unitaire_ht) || 0,
        tva          : Number(l.taux_tva) || 20,
      })),
    };

    res.json({ transcription: texte, data });

  } catch (err) {
    console.error('/api/transcribe error:', err.message);
    if (err.message.includes('OPENAI_API_KEY')) return res.status(503).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════
   API — GÉNÉRATION PDF
   ════════════════════════════════════════ */
app.post('/api/generate', async (req, res) => {
  try {
    const { type, client, lignes, date_prestation } = req.body;
    if (!type || !client?.nom || !lignes?.length)
      return res.status(400).json({ error: 'type, client.nom et lignes requis.' });

    const entreprise = readJSON(CFG_FILE);
    const numero     = nextNumero(type);
    const today      = new Date().toISOString().slice(0, 10);
    const { totalHT, tvaDetails, totalTVA, totalTTC } = calcTotaux(lignes);

    const doc = {
      id             : Date.now().toString(),
      type, numero,
      date_emission  : today,
      date_prestation: date_prestation || null,
      client, lignes, totalHT, tvaDetails, totalTVA, totalTTC,
      devis_ref      : null,
      pdf            : `${numero}.pdf`,
    };

    const pdfPath = await generatePDF(doc, entreprise);
    const docs    = readJSON(DOCS_FILE);
    docs.unshift(doc);
    writeJSON(DOCS_FILE, docs);
    res.download(pdfPath, `${numero}.pdf`);

  } catch (err) {
    console.error('/api/generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Liste tous les documents ── */
app.get('/api/documents', (_req, res) => res.json(readJSON(DOCS_FILE)));

/* ── Détail d'un document ── */
app.get('/api/document/:id', (req, res) => {
  const doc = readJSON(DOCS_FILE).find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  res.json(doc);
});

/* ── Re-téléchargement PDF ── */
app.get('/api/document/:id/pdf', (req, res) => {
  const doc = readJSON(DOCS_FILE).find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  const p   = path.join(PDF_DIR, doc.pdf);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'PDF absent du disque.' });
  res.download(p, doc.pdf);
});

/* ── Conversion devis → facture ── */
app.post('/api/facture-from-devis/:id', async (req, res) => {
  try {
    const devis = readJSON(DOCS_FILE).find(d => d.id === req.params.id && d.type === 'devis');
    if (!devis) return res.status(404).json({ error: 'Devis introuvable.' });

    const entreprise = readJSON(CFG_FILE);
    const numero     = nextNumero('facture');
    const today      = new Date().toISOString().slice(0, 10);
    const { totalHT, tvaDetails, totalTVA, totalTTC } = calcTotaux(devis.lignes);

    const doc = {
      id             : Date.now().toString(),
      type           : 'facture',
      numero, date_emission: today,
      date_prestation: req.body.date_prestation || today,
      client         : devis.client,
      lignes         : devis.lignes,
      totalHT, tvaDetails, totalTVA, totalTTC,
      devis_ref      : devis.numero,
      pdf            : `${numero}.pdf`,
    };

    const pdfPath = await generatePDF(doc, entreprise);
    const docs    = readJSON(DOCS_FILE);
    docs.unshift(doc);
    writeJSON(DOCS_FILE, docs);
    res.download(pdfPath, `${numero}.pdf`);

  } catch (err) {
    console.error('/api/facture-from-devis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Config entreprise (lecture seule) ── */
app.get('/api/entreprise', (_req, res) => res.json(readJSON(CFG_FILE)));

/* ── Démarrage ── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SANITENERGIE Devis — http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) console.warn('⚠  OPENAI_API_KEY absente — dictée désactivée');
});
