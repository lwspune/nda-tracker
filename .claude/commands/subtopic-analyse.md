---
context: fork
---

Supabase is the authoritative source for question data. Do NOT read `data/faculty-data.json` — it may lag behind tags uploaded on Vercel.

## Step 1 — fetch subtopics from Supabase

Use the `mcp__supabase__execute_sql` tool with this query:

```sql
SELECT
  COALESCE(q->>'subject', 'Maths') AS subject,
  q->>'chapter'                    AS chapter,
  q->>'subtopic'                   AS subtopic,
  COUNT(*)::int                    AS cnt
FROM exams,
     jsonb_array_elements(questions) AS q
WHERE q->>'chapter'  IS NOT NULL
  AND q->>'subtopic' IS NOT NULL
  AND trim(q->>'subtopic') != ''
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

## Step 2 — write result to a temp file

Write the JSON array returned by Step 1 to `C:/Windows/Temp/nda_subtopics.json` using the Write tool (Windows path — use forward slashes).

## Step 3 — run similarity analysis

```bash
python -X utf8 -c "
import json, collections, difflib

with open('C:/Windows/Temp/nda_subtopics.json', encoding='utf-8') as f:
    rows = json.load(f)

tree = collections.defaultdict(collections.Counter)
for r in rows:
    tree[(r['subject'], r['chapter'])][r['subtopic']] += int(r['cnt'])

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

The script prints only chapters with near-duplicate groups:
```
SUBJECT: Maths  CHAPTER: Trigonometry
  GROUP: "Heights & Distance" (12), "Height and Distance" (3)
```

## Step 4 — produce report

1. For each GROUP, suggest a single canonical merged name.
2. Produce a structured report:

### Subject: <subject> — Chapter: <chapter>
#### Group N
- Variants: `Name A` (n), `Name B` (n)
- Suggested merge: `Canonical Name`

End with a summary table:
| Subject | Chapter | Groups | Questions affected |
|---|---|---|---|

This is a read-only analysis task — do not modify any files.
