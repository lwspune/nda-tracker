---
context: fork
---

Do NOT read `data/faculty-data.json` directly — it is too large. Run this Python script via Bash; it finds near-duplicate subtopics itself and outputs only the suspect groups:

```bash
python -X utf8 -c "
import json, collections, difflib

with open('data/faculty-data.json', encoding='utf-8') as f:
    data = json.load(f)

# Build { (subj, ch): Counter(subtopic -> count) }
tree = collections.defaultdict(collections.Counter)
for exam in data.get('exams', []):
    for q in exam.get('questions', []):
        ch = (q.get('chapter') or '').strip()
        st = (q.get('subtopic') or '').strip()
        subj = (q.get('subject') or 'Maths').strip()
        if ch and st:
            tree[(subj, ch)][st] += 1

def normalise(s):
    return s.lower().rstrip('s').replace('&', 'and').replace('-', ' ').replace('  ', ' ').strip()

found_any = False
for (subj, ch), counter in sorted(tree.items()):
    names = list(counter.keys())
    used = set()
    groups = []
    for i, a in enumerate(names):
        if a in used:
            continue
        group = [a]
        for b in names[i+1:]:
            if b in used:
                continue
            ratio = difflib.SequenceMatcher(None, normalise(a), normalise(b)).ratio()
            if ratio >= 0.82:
                group.append(b)
                used.add(b)
        if len(group) > 1:
            used.add(a)
            groups.append(group)
    if groups:
        found_any = True
        print(f'SUBJECT: {subj}  CHAPTER: {ch}')
        for g in groups:
            parts = ', '.join(f'\"{v}\" ({counter[v]})' for v in g)
            print(f'  GROUP: {parts}')
        print()

if not found_any:
    print('No near-duplicate subtopics found.')
"
```

The script prints only chapters that have near-duplicate subtopic groups, in the form:
```
SUBJECT: Maths  CHAPTER: Trigonometry
  GROUP: "Heights & Distance" (12), "Height and Distance" (3)
```

Your task:
1. Review the script output.
2. For each GROUP, suggest a single canonical merged name.
3. Produce a structured report:

## Subject: <subject> — Chapter: <chapter>
### Group N
- Variants: `Name A` (n), `Name B` (n)
- Suggested merge: `Canonical Name`

End with a summary table:
| Subject | Chapter | Groups | Questions affected |
|---|---|---|---|

This is a read-only analysis task — do not modify any files.
