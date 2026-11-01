import re
path = '/home/z/my-project/backend/prisma/schema.prisma'
lines = open(path, 'rb').read().split(b'\n')
l = lines[357]
print('L358:', repr(l))
ls = l.strip()
print('strip:', repr(ls))
m = re.match(rb'@@(index|unique|id)\(', ls)
print('match:', m)
if m:
    paren = ls.index(b'(')
    print('paren at', paren, 'after:', repr(ls[paren+1:paren+2]))
