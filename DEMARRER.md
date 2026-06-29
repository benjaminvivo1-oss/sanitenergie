# Démarrer l'application SANITENERGIE

## Via GitHub Codespaces (recommandé)

1. Sur GitHub, cliquez **`<> Code`** → **Codespaces** → **"Create codespace on main"**
2. Attendez que l'environnement se prépare (~2 min)
3. Dans le terminal qui s'ouvre, tapez :

```bash
cd server
cp .env.example .env
nano .env
```

4. Remplissez vos clés API dans le fichier `.env` :
```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

5. Sauvegardez (`Ctrl+X` puis `Y`) puis lancez :

```bash
node server.js
```

6. GitHub affiche un bouton **"Open in Browser"** en bas à droite → cliquez-le pour obtenir votre URL publique.

---

Le dashboard principal est à la racine : `index.html`
Le générateur PDF est accessible via l'URL du serveur.
