import re, sys
path = '/home/z/my-project/backend/prisma/schema.prisma'
src = open(path, 'rb').read()
lines = src.split(b'\n')
bad = 0
for i, l in enumerate(lines, 1):
    ls = l.strip()
    m = re.match(rb'@@(index|unique|id)\(', ls)
    if m:
        paren = ls.index(b'(')
        after = ls[paren+1:paren+2]
        if after != b'[':
            print('BAD-ATTR', i, l)
            bad += 1
    if b'fields:' in l:
        seg = l[l.index(b'fields:')+7:]
        if not seg.lstrip().startswith(b'['):
            print('BAD-FIELDS', i, l)
            bad += 1
    if b'references:' in l:
        seg = l[l.index(b'references:')+11:]
        if not seg.lstrip().startswith(b'['):
            print('BAD-REFS', i, l)
            bad += 1
print('TOTAL BAD:', bad)
