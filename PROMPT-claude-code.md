# Projet : générateur de messages de signalement Tandem

## Contexte

J'utilise Tandem (app d'échange linguistique) et je signale régulièrement des profils qui enfreignent les règles : arnaques, drague, usurpation de photos… Le formulaire de signalement de Tandem demande un message de 500 caractères maximum. Le retaper à chaque fois prend du temps, et un message bâclé a moins de chances d'aboutir.

Je veux une page web qui :
- reprend l'arbre de signalement de Tandem (mêmes menus, mêmes libellés) ;
- me permet de choisir directement le type de signalement avec des boutons ;
- me génère un message prêt à copier-coller, avec le nom de la personne et, si je le veux, la date ;
- me rappelle quelles catégories sont les plus graves.

**Périmètre important :** la page ne communique jamais avec Tandem. Pas de scraping, pas d'automatisation, pas d'envoi. Elle produit du texte que je colle moi-même dans l'app.

## Fichier fourni : `report-tree.json`

Il est joint à ce prompt. Place-le dans `data/report-tree.json`. C'est la source de vérité de l'arbre : ne le recopie pas en dur dans le code, lis-le.

Sa structure :
- `root` : l'arbre à partir du premier écran (« Quelle partie de Tandem ce signalement concerne-t-il ? »).
- Chaque nœud a un `id`, un `label` (texte exact de l'app, `{name}` = le nom de la personne) et un `type` :
  - `menu` : ouvre un sous-menu (`prompt` = la question affichée, `children` = les options) ;
  - `message` : fin du parcours, Tandem demande un message (500 caractères max) ;
  - `direct` : fin du parcours, le signalement part sans message ;
  - `ref` : renvoie vers un sous-menu partagé dans `shared` (ex. `"ref": "photo"`, le menu photo est accessible depuis Profil et depuis Chat) ;
  - `unknown` : pas encore exploré ;
  - `ignored` : hors périmètre pour l'instant (Club Linguistique, Appel).
- Les feuilles `message`/`direct` ont un `tier` (1, 2, 3 ou `"variable"`), un `rank` (gravité, 1 = la pire, **propre à chaque contexte** : `party` d'un côté, `profile` + `chat` + `photo` de l'autre) et une `note` courte qui explique le classement.
- `meta.tiers`, `meta.evidence_strength` et `meta.notes` contiennent les textes du rappel de gravité et des remarques à afficher.

## Stack

- Site statique : `index.html` + `style.css` + `app.js`, en vanilla JS, sans framework.
- La page doit fonctionner en ouvrant `index.html` directement (`file://`) **et** sur un hébergement statique (GitHub Pages). Comme `fetch()` est bloqué en `file://`, `scripts/build.py` regroupe les JSON dans `data/bundle.js` (`window.TANDEM_DATA = {...}`), et la page charge ce fichier.
- Python (stdlib uniquement) sert seulement au build et à la validation, pas à faire tourner le site.

```
tandem-report/
├── index.html
├── style.css
├── app.js
├── data/
│   ├── report-tree.json
│   ├── messages/
│   │   ├── party.money.json
│   │   ├── party.dating.json
│   │   └── party.photos_of_me.json
│   └── bundle.js          ← généré par build.py, ne pas éditer à la main
├── scripts/
│   ├── build.py
│   └── validate.py
└── README.md
```

## Fonctionnalités de la page

1. **Choix du contexte.** Des onglets ou boutons : « Fête », « Profil », « Chat ». Chaque contexte affiche directement toutes ses feuilles sous forme de boutons cliquables, triées par `rank`, avec la couleur du tier et un badge de rang. Pour Profil et Chat, regroupe les boutons par sous-menu (Informations de profil / Photo de profil / Messages). Les feuilles `unknown` sont grisées avec la mention « pas encore exploré ».
2. **Chemin dans l'app.** Quand je choisis une feuille, affiche le chemin exact à suivre dans Tandem, ex. : `Signaler › Fête Linguistique › Asked for money/investment`. Pour une feuille sous `photo`, affiche le chemin du contexte actif (Profil ou Chat).
3. **Champs :**
   - Nom de la personne (obligatoire pour générer).
   - Case à cocher « Ajouter la date », avec un sélecteur de date (aujourd'hui par défaut).
   - Toggle de variante quand la feuille en a (voir plus bas).
   - Champ optionnel « Détails » : ce qui s'est réellement passé, ajouté à la fin du message.
4. **Génération.** Tire au hasard un message de la feuille (et de la variante choisie). N'affiche pas l'un des 10 derniers déjà montrés pour cette feuille. Boutons « Autre message » et « Copier » (avec retour visuel). Le message reste éditable après génération.
5. **Compteur** `X / 500` en direct. Au-delà de 500 : compteur en rouge, copie bloquée, et message « raccourcis les détails ».
6. **Feuille sans messages types :** « Pas encore de messages types : écris le tien », avec une zone de texte et le compteur.
7. **Feuille `direct` :** « Pas de message : Tandem envoie le signalement directement. »
8. **Rappel de gravité :** un panneau toujours accessible (colonne sur ordinateur, repliable sur mobile) qui liste les feuilles du contexte actif par tier, avec leur `note`, plus le texte `meta.evidence_strength.note` (même faute, preuve plus forte via Messages qu'en Fête).
9. **localStorage** pour le dernier contexte et l'état de la case date, enveloppé dans try/catch (pas le nom).
10. **Design :** mobile d'abord, parce que je m'en sers sur mon téléphone en même temps que l'app. Grandes zones tactiles, interface en français. Deux thèmes au choix (section suivante).

## Deux thèmes

Une seule page, deux thèmes. Un bouton dans l'en-tête permet de basculer de l'un à l'autre, et le choix est mémorisé dans localStorage.

- **« Tandem »** (par défaut) : sombre et sobre, proche des captures de l'app.
- **« Terminal »** (ambiance hacker) :
  - fond noir, texte vert phosphore avec accents ambre, police monospace ;
  - scanlines CRT légères, curseur `_` qui clignote, petit effet glitch sur le titre ;
  - boutons style `[ ASKED FOR MONEY ]`, tiers affichés en `SEV-1` / `SEV-2` / `SEV-3` ;
  - le message généré s'affiche avec un effet machine à écrire ;
  - libellés de type console : `> report.generate --target {name}`, `> copied to clipboard_`.

Règles d'implémentation :
- Les thèmes passent par des variables CSS sur `<html data-theme="...">`. Pas de deuxième page ni de HTML dupliqué.
- Les effets propres au thème Terminal sont en CSS. Seul l'effet machine à écrire est en JS, et il ne tourne que dans ce thème.
- L'effet ne doit jamais ralentir l'usage : 0,6 s maximum en tout, un tap l'interrompt, et le bouton « Copier » marche tout de suite.
- Respecte `prefers-reduced-motion` : dans ce cas, aucune animation.
- Le texte doit rester bien lisible sur téléphone dans les deux thèmes : contraste suffisant, scanlines discrètes.

## Gabarits et substitution

Chaque fichier de messages a ce format :

```json
{
  "leaf": "party.money",
  "variants": { "money": "Demande d'argent", "investment": "Proposition d'investissement" },
  "messages": [
    { "id": "money-001", "variant": "money", "text": "..." }
  ]
}
```

- `{name}` : obligatoire, au moins une fois, au plus deux fois.
- `{when}` : exactement une fois. Si la case date est décochée, il est remplacé par une chaîne vide. Si elle est cochée, par ` on 31 October 2026` (espace initial, format anglais `d MMMM yyyy`). **Chaque gabarit doit se lire correctement dans les deux cas** (ex. : `"{name} asked me for money{when} during a Tandem party."`).
- Détails : ajoutés après le gabarit, séparés par une espace. Si le texte ne finit pas par une ponctuation, ajoute un point.

## Phase 1 : messages à générer

300 messages, 100 par feuille, **en anglais** (l'équipe de modération de Tandem travaille très probablement en anglais), uniquement pour ces trois feuilles du contexte Fête :

| Feuille | Variante A (50) | Variante B (50) |
|---|---|---|
| `party.money` | `money` : m'a demandé de l'argent | `investment` : a proposé un investissement, du trading, de la crypto |
| `party.dating` | `flirt` : drague, utilise la fête pour trouver des rendez-vous | `sexual` : remarques ou propositions sexuelles |
| `party.photos_of_me` | `me` : utilise mes photos | `someone` : utilise les photos de quelqu'un que je connais |

Les variantes servent à ce que le message corresponde à ce qui s'est réellement passé : affiche un toggle pour choisir.

### Ce qui rend un message efficace (à respecter)

Un modérateur agit sur un signalement clair et factuel, et ignore les messages émotionnels. Chaque message doit donc :
- dire ce qui s'est passé, dans le contexte d'une fête Tandem (salon vocal) ;
- nommer la règle enfreinte (Tandem n'est pas une app de rencontre / tentative d'arnaque / usurpation d'identité) ;
- dire en une phrase pourquoi c'est un problème (risque pour les autres apprenants, détournement de la plateforme) ;
- finir par une demande claire : examiner le compte, retirer le contenu, prendre des mesures.

Le ton est ferme, direct et poli. Interdit : insultes, MAJUSCULES pour crier, « !! », menaces, exagérations.

**N'invente jamais de faits précis** : pas de montants, pas de noms de crypto ou de plateformes, pas de citations, pas de nombre de victimes, pas de « screenshots attached » (une fête, c'est de l'audio). Le gabarit affirme la catégorie avec force ; les faits précis viennent du champ Détails. « I can provide more details if needed » est autorisé.

### Variété et longueur

- Longueur : **180 à 400 caractères** dans le pire cas (nom de 30 caractères, `{when}` rempli, sans détails). Il reste ainsi au moins 100 caractères pour les détails.
- Deux messages d'une même feuille ne commencent pas par les mêmes 5 mots. Varie les structures (pas tous en `{name} did X`), les ouvertures et les longueurs.
- Écris par lots de 25 et lance `validate.py` après chaque lot.

## `scripts/validate.py`

Il vérifie :
- 100 messages par feuille, 50 par variante, ids uniques ;
- chaque `leaf` existe dans `report-tree.json` avec `type: "message"` ;
- les règles de `{name}` et de `{when}` ;
- la longueur dans le pire cas (180 ≤ n ≤ 400) ;
- pas de doublon exact, et signale les quasi-doublons (`difflib` ratio > 0.85) ;
- pas de 5 premiers mots identiques au sein d'une feuille ;
- signale (sans bloquer) : chiffres, `$`, `€`, `!!`, mots en majuscules de 4 lettres ou plus, « screenshot ».

Il sort un code non nul en cas d'erreur.

## Ordre de travail

1. Arborescence, `report-tree.json` en place, `build.py`.
2. Interface complète, testée avec 3 messages factices par feuille.
3. Génération des 300 messages par lots, avec validation après chaque lot.
4. Build, puis test dans Chromium (Playwright) : captures en 390 px de large et en 1280 px, **dans les deux thèmes**, parcours complet (choisir Fête › Asked for money, saisir un nom, cocher la date, générer, autre message, copier, dépasser les 500 caractères avec les détails).
5. `README.md` court : comment ouvrir la page, comment ajouter des messages pour une autre feuille (créer `data/messages/<leaf>.json`, lancer validate puis build).

## Hors phase 1 (ne pas faire maintenant)

Messages pour les autres feuilles, version française des messages, exploration des nœuds `unknown`.
