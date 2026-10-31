# Générateur de messages de signalement Tandem

Page web statique qui reprend l'arbre de signalement de Tandem et génère un message prêt à copier-coller (500 caractères max). La page ne communique jamais avec Tandem : elle produit du texte que tu colles toi-même dans l'app.

## Ouvrir la page

- **En local** : double-clique sur `index.html` (ça marche en `file://`).
- **En ligne** : pousse le dossier sur GitHub et active GitHub Pages (branche principale, dossier racine).

Si la page affiche « Données introuvables », lance le build (voir plus bas).

## Organisation

- `data/report-tree.json` : l'arbre de signalement, source de vérité (menus, libellés, tiers, rangs, notes).
- `data/messages/<feuille>.json` : les messages types d'une feuille.
- `data/bundle.js` : généré par `scripts/build.py`, ne pas l'éditer à la main.
- `scripts/validate.py` : vérifie l'arbre et les messages.

## Ajouter des messages pour une autre feuille

1. Repère l'`id` de la feuille dans `data/report-tree.json` (elle doit être de type `message`), par exemple `chat.messages.money`.
2. Crée `data/messages/chat.messages.money.json` :

   ```json
   {
     "leaf": "chat.messages.money",
     "variants": { "money": "Demande d'argent", "investment": "Proposition d'investissement" },
     "messages": [
       { "id": "chat-money-001", "variant": "money", "text": "{name} asked me for money{when} in our Tandem chat. ..." }
     ]
   }
   ```

   - `{name}` : 1 ou 2 fois. `{when}` : exactement 1 fois, collé au mot qui précède. Il est remplacé par rien ou par ` on 31 October 2026`, et la phrase doit se lire correctement dans les deux cas.
   - Longueur 180 à 400 caractères dans le pire cas (nom de 30 caractères, date remplie).
   - Les ids doivent être uniques dans tous les fichiers.
   - `variants` est facultatif. S'il y en a, la page affiche un sélecteur.

3. Valide, puis régénère le bundle :

   ```sh
   python3 scripts/validate.py --partial   # pendant l'écriture (comptes non bloquants)
   python3 scripts/validate.py             # final : 100 messages par feuille, répartis à parts égales entre les variantes
   python3 scripts/build.py
   ```

   On peut aussi valider un seul fichier : `python3 scripts/validate.py data/messages/chat.messages.money.json`.

Python 3 suffit, sans dépendance.
