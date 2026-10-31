#!/usr/bin/env python3
"""Valide report-tree.json et les fichiers data/messages/*.json.

Usage :
  python3 scripts/validate.py                      # tout, comptes stricts
  python3 scripts/validate.py --partial            # comptes non bloquants (écriture par lots)
  python3 scripts/validate.py data/messages/party.money.json [--partial]

Code de sortie non nul s'il y a au moins une erreur. Les avertissements
(« warn ») sont affichés sans bloquer.
"""
import argparse
import difflib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TREE = DATA / "report-tree.json"
MESSAGES = DATA / "messages"

PER_LEAF = 100
MIN_LEN, MAX_LEN = 180, 400
WORST_NAME = "N" * 30
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
# Pire cas : jour à deux chiffres et mois le plus long (" on 30 September 2026").
WORST_WHEN = max((f" on 30 {m} 2026" for m in MONTHS), key=len)
NEAR_DUP_RATIO = 0.85
TIERS = {1, 2, 3, "variable"}
PLACEHOLDER = re.compile(r"\{([^{}]*)\}")
END_PUNCT = (".", "?", "!")


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, msg):
        self.errors.append(f"  ERREUR  {where} : {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"  warn    {where} : {msg}")


def fill(text, name, when):
    return text.replace("{name}", name).replace("{when}", when)


def first_words(text, n=5):
    return tuple(re.findall(r"[a-z0-9{}'’]+", text.lower())[:n])


# --- Arbre ---------------------------------------------------------------

def walk(node, context, out):
    out.append((node, context))
    for child in node.get("children", []):
        walk(child, context, out)


def check_tree(tree, rep):
    nodes = []
    for child in tree["root"].get("children", []):
        walk(child, child["id"], nodes)
    for node in tree.get("shared", {}).values():
        walk(node, "shared", nodes)

    seen = set()
    message_leaves = set()
    ranks = {}
    for node, context in nodes:
        nid = node.get("id")
        where = f"report-tree.json [{nid}]"
        if not nid:
            rep.error("report-tree.json", f"nœud sans id : {node.get('label')}")
            continue
        if nid in seen:
            rep.error(where, "id en double")
        seen.add(nid)
        kind = node.get("type")
        if kind == "ref" and node.get("ref") not in tree.get("shared", {}):
            rep.error(where, f"ref '{node.get('ref')}' introuvable dans 'shared'")
        if kind in ("message", "direct"):
            if node.get("tier") not in TIERS:
                rep.error(where, f"tier invalide : {node.get('tier')!r}")
            if not node.get("note"):
                rep.warn(where, "pas de note")
            if kind == "message":
                message_leaves.add(nid)
            if "rank" in node:
                # Les rangs sont propres à 'party' d'un côté, profile + chat + photo de l'autre.
                group = "party" if context == "party" else "profile/chat/photo"
                if node["rank"] in ranks.get(group, {}):
                    rep.warn(where, f"rang {node['rank']} déjà utilisé par {ranks[group][node['rank']]} ({group})")
                ranks.setdefault(group, {})[node["rank"]] = nid
    return message_leaves


# --- Messages ------------------------------------------------------------

def check_template(where, text, rep):
    names = text.count("{name}")
    whens = text.count("{when}")
    if not 1 <= names <= 2:
        rep.error(where, f"{{name}} présent {names} fois (attendu : 1 ou 2)")
    if whens != 1:
        rep.error(where, f"{{when}} présent {whens} fois (attendu : exactement 1)")
    for ph in PLACEHOLDER.findall(text):
        if ph not in ("name", "when"):
            rep.error(where, f"placeholder inconnu {{{ph}}}")

    if text != text.strip():
        rep.error(where, "espace en début ou fin de texte")
    if "\n" in text:
        rep.error(where, "retour à la ligne dans le texte")
    if not text.rstrip().endswith(END_PUNCT):
        rep.error(where, "le gabarit doit finir par une ponctuation (. ? !)")

    # {when} doit se lire correctement vide comme rempli (" on 31 October 2026").
    for m in re.finditer(r"\{when\}", text):
        before = text[m.start() - 1] if m.start() > 0 else ""
        after = text[m.end()] if m.end() < len(text) else ""
        if before == "" or before.isspace():
            rep.error(where, "{when} précédé d'une espace ou en début de texte (double espace une fois rempli)")
        if after.isalnum():
            rep.error(where, f"{{when}} collé à la lettre suivante '{after}'")
    for label, when in (("sans date", ""), ("avec date", " on 31 October 2026")):
        filled = fill(text, "Alex", when)
        if "  " in filled:
            rep.error(where, f"double espace {label}")
        if re.search(r"\s[.,;:!?]", filled):
            rep.error(where, f"espace avant ponctuation {label}")

    worst = len(fill(text, WORST_NAME, WORST_WHEN))
    if not MIN_LEN <= worst <= MAX_LEN:
        rep.error(where, f"longueur pire cas {worst} hors de [{MIN_LEN}, {MAX_LEN}]")

    # Signalements non bloquants.
    bare = PLACEHOLDER.sub("", text)
    if re.search(r"\d", bare):
        rep.warn(where, "contient un chiffre")
    if "$" in bare or "€" in bare:
        rep.warn(where, "contient un symbole monétaire")
    if "!!" in bare:
        rep.warn(where, "contient '!!'")
    caps = re.findall(r"\b[A-Z]{4,}\b", bare)
    if caps:
        rep.warn(where, f"mot(s) en majuscules : {', '.join(caps)}")
    if re.search(r"screenshot|screen shot|attach", bare, re.I):
        rep.warn(where, "mentionne une capture ou une pièce jointe")


def check_file(path, leaves, rep, partial, seen_ids):
    name = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        rep.error(str(name), f"JSON illisible : {e}")
        return []

    leaf = data.get("leaf")
    if leaf not in leaves:
        rep.error(str(name), f"feuille '{leaf}' absente de l'arbre ou pas de type 'message'")
    if path.stem != leaf:
        rep.warn(str(name), f"le nom du fichier devrait être {leaf}.json")

    variants = data.get("variants") or {}
    messages = data.get("messages")
    if not isinstance(messages, list):
        rep.error(str(name), "'messages' doit être une liste")
        return []

    count = rep.warn if partial else rep.error
    if len(messages) != PER_LEAF:
        count(str(name), f"{len(messages)} messages (attendu : {PER_LEAF})")
    if variants:
        per_variant = PER_LEAF // len(variants)
        for key in variants:
            n = sum(1 for m in messages if m.get("variant") == key)
            if n != per_variant:
                count(str(name), f"variante '{key}' : {n} messages (attendu : {per_variant})")

    texts = []
    openings = {}
    for i, msg in enumerate(messages):
        mid = msg.get("id")
        where = f"{name} [{mid or f'#{i}'}]"
        if not mid:
            rep.error(where, "message sans id")
        elif mid in seen_ids:
            rep.error(where, f"id en double (déjà dans {seen_ids[mid]})")
        else:
            seen_ids[mid] = name
        if variants and msg.get("variant") not in variants:
            rep.error(where, f"variante inconnue {msg.get('variant')!r}")
        if not variants and msg.get("variant"):
            rep.error(where, "variante donnée alors que le fichier n'en déclare pas")
        text = msg.get("text")
        if not isinstance(text, str) or not text:
            rep.error(where, "texte vide")
            continue
        check_template(where, text, rep)

        opening = first_words(text)
        if opening in openings:
            rep.error(where, f"mêmes 5 premiers mots que {openings[opening]} : « {' '.join(opening)} »")
        else:
            openings[opening] = mid
        texts.append((where, mid, text))
    return texts


def check_duplicates(texts, rep):
    norm = [(w, mid, " ".join(t.lower().split())) for w, mid, t in texts]
    exact = {}
    for where, mid, t in norm:
        if t in exact:
            rep.error(where, f"doublon exact de {exact[t]}")
        else:
            exact[t] = mid
    for i in range(len(norm)):
        sm = difflib.SequenceMatcher(None, autojunk=False)
        sm.set_seq2(norm[i][2])
        for j in range(i + 1, len(norm)):
            sm.set_seq1(norm[j][2])
            if sm.real_quick_ratio() > NEAR_DUP_RATIO and sm.quick_ratio() > NEAR_DUP_RATIO:
                r = sm.ratio()
                if r > NEAR_DUP_RATIO:
                    rep.warn(norm[j][0], f"quasi-doublon de {norm[i][1]} (ratio {r:.2f})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", type=Path, help="fichiers de messages (défaut : data/messages/*.json)")
    ap.add_argument("--partial", action="store_true", help="comptes de messages non bloquants")
    args = ap.parse_args()

    rep = Report()
    tree = json.loads(TREE.read_text(encoding="utf-8"))
    leaves = check_tree(tree, rep)

    files = [f.resolve() for f in args.files] or sorted(MESSAGES.glob("*.json"))
    seen_ids = {}
    all_texts = []
    for path in files:
        all_texts += check_file(path, leaves, rep, args.partial, seen_ids)
    check_duplicates(all_texts, rep)

    for line in rep.errors + rep.warnings:
        print(line)
    print(f"validate: {len(files)} fichier(s), {len(all_texts)} message(s), "
          f"{len(rep.errors)} erreur(s), {len(rep.warnings)} avertissement(s)")
    sys.exit(1 if rep.errors else 0)


if __name__ == "__main__":
    main()
