# Générateur de messages de signalement Tandem

Page web statique qui reprend l'arbre de signalement de Tandem et génère un message prêt à copier-coller (500 caractères max). La page ne communique jamais avec Tandem : elle produit du texte que tu colles toi-même dans l'app.

## Ouvrir la page

- **En local** : double-clique sur `index.html` (ça marche en `file://`).
- **En ligne** : https://mmnervous.github.io/tandem-report/ (GitHub Pages, publié depuis la branche `main`, dossier racine).

Si la page affiche « Données introuvables », lance le build (voir plus bas).

## Organisation

- `data/report-tree.json` : l'arbre de signalement, source de vérité (menus, libellés, tiers, rangs, notes). Les libellés affichés sont en anglais ; la version française est gardée dans `label_fr` et `prompt_fr`.
- `data/messages/<feuille>.json` : les messages types d'une feuille.
- `data/topics.json` : le raccourci « Par sujet » (voir plus bas).
- `data/bundle.js` : généré par `scripts/build.py`, ne pas l'éditer à la main.
- `scripts/validate.py` : vérifie l'arbre et les messages.

## Mettre à jour le site

Il n'y a rien à lancer tant que tu ne modifies pas les données. Les deux commandes servent uniquement après une modification de `data/report-tree.json` ou d'un fichier de `data/messages/`.

- **`python3 scripts/validate.py`** vérifie les messages et l'arbre : message trop long, `{name}` oublié, deux messages qui commencent par les mêmes mots, feuille absente de l'arbre… Il ne modifie rien. Il affiche les problèmes, et `0 erreur(s)` quand tout est bon.
- **`python3 scripts/build.py`** regroupe l'arbre et tous les messages dans `data/bundle.js`, le fichier que la page lit réellement. Sans lui, la page ne voit pas tes modifications.

Dans l'ordre, depuis le dossier du projet :

```sh
# 1. modifier un fichier JSON dans data/
python3 scripts/validate.py   # 2. vérifier : corriger tant qu'il y a des erreurs
python3 scripts/build.py      # 3. mettre à jour data/bundle.js
git add -A                    # 4. publier : le site en ligne se met à jour en une minute environ
git commit -m "Décris ta modification"
git push
```

Pour vérifier en local avant de publier, ouvre `index.html` dans le navigateur après l'étape 3.

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
   - Comptes attendus : 100 messages par feuille, répartis à parts égales entre les variantes. Pour changer, ajoute dans le fichier `"per_variant": 100` (même nombre pour chaque variante) ou `"targets": { "explicit": 100 }` (nombre propre à certaines variantes).
   - Écris les messages du point de vue d'un participant, cite la règle de Tandem (Language Parties Guidelines, Community Principles) et n'invente aucun fait : montants, noms de plateformes, citations, durées. Les précisions viennent du champ Détails.

3. Valide, puis régénère le bundle (voir « Mettre à jour le site » pour publier ensuite) :

   ```sh
   python3 scripts/validate.py --partial   # pendant l'écriture (comptes non bloquants)
   python3 scripts/validate.py             # final : 100 messages par feuille, répartis à parts égales entre les variantes
   python3 scripts/build.py
   ```

   On peut aussi valider un seul fichier : `python3 scripts/validate.py data/messages/chat.messages.money.json`.

## Le raccourci « Par sujet »

En Fête, le bouton **Par sujet** classe les catégories par règle enfreinte (« Politique », « Religion », « Contenu sexuel explicite », « Faux compte »…) au lieu de la gravité. Choisir un sujet ouvre directement la bonne catégorie Tandem avec la bonne variante de messages, et affiche le chemin à suivre dans l'app.

Tout est dans `data/topics.json` :

```json
{ "id": "politics", "group": "banned", "context": "party",
  "leaf": "party.disruptive", "variant": "politics",
  "label": "Politique", "hint": "Sujet interdit dans les fêtes" }
```

- `leaf` et `variant` doivent exister : `validate.py` et `build.py` le vérifient.
- `group` renvoie à un élément de `groups` (l'ordre du fichier est l'ordre à l'écran).
- Un contexte sans sujet (Profil, Chat pour l'instant) n'affiche pas la bascule.

Python 3 suffit, sans dépendance.
