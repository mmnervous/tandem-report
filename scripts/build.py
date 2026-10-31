#!/usr/bin/env python3
"""Regroupe report-tree.json et data/messages/*.json dans data/bundle.js.

La page charge ce fichier avec une balise <script> : ça marche en file://
(où fetch() est bloqué) comme sur un hébergement statique.

Usage : python3 scripts/build.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TREE = DATA / "report-tree.json"
MESSAGES = DATA / "messages"
OUT = DATA / "bundle.js"


def load(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"build: impossible de lire {path.relative_to(ROOT)} : {e}")


def message_leaf_ids(tree):
    """Ids des feuilles de type 'message' (arbre principal + sous-menus partagés)."""
    ids = set()

    def walk(node):
        if node.get("type") == "message":
            ids.add(node["id"])
        for child in node.get("children", []):
            walk(child)

    walk(tree["root"])
    for node in tree.get("shared", {}).values():
        walk(node)
    return ids


def main():
    tree = load(TREE)
    leaves = message_leaf_ids(tree)

    messages = {}
    for path in sorted(MESSAGES.glob("*.json")):
        data = load(path)
        leaf = data.get("leaf")
        if leaf not in leaves:
            sys.exit(f"build: {path.name} : feuille '{leaf}' absente de l'arbre ou pas de type 'message'")
        if leaf in messages:
            sys.exit(f"build: feuille '{leaf}' définie dans deux fichiers")
        messages[leaf] = data

    bundle = {"tree": tree, "messages": messages}
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// Généré par scripts/build.py : ne pas éditer à la main.\n"
        f"window.TANDEM_DATA = {payload};\n",
        encoding="utf-8",
    )

    total = sum(len(m.get("messages", [])) for m in messages.values())
    print(f"build: {OUT.relative_to(ROOT)} ({len(messages)} feuilles, {total} messages, {OUT.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    main()
