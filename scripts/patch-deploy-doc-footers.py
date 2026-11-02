#!/usr/bin/env python3
"""KPIMS docx footer post-processing per docx skill toc.md:
- Roman footer (section 2): PAGE -> PAGE \\* ROMAN \\* MERGEFORMAT
- Arabic footer (section 3): PAGE -> PAGE \\* arabic \\* MERGEFORMAT
- Remove empty <w:pgNumType/> (cover section artifact)
docx-js emits one footer file per section footer object; we created two
separate Footer objects, so footer2.xml/footer3.xml (order may vary) each
carry a bare PAGE field. We patch by inspecting each footer XML and assigning
formats based on the section order in document.xml.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

path = Path(sys.argv[1])
tmp = path.with_suffix(".tmp.docx")

with zipfile.ZipFile(path, "r") as zin:
    names = zin.namelist()
    data = {n: zin.read(n) for n in names}

# 1) remove empty pgNumType artifacts
doc_xml = data["word/document.xml"].decode("utf-8")
before = doc_xml
doc_xml = doc_xml.replace("<w:pgNumType/>", "")
changed_doc = before != doc_xml

# 1b) The TOC field paragraph (begin+instr+separate) also carries a duplicate
# copy of entry 1 injected by docx-js — it renders as a stray first row with a
# blank page number. Keep only the field-control runs in that paragraph; the
# real entries (paragraphs 1..16) remain inside the field result.
i = doc_xml.find('<w:instrText xml:space="preserve">TOC')
if i != -1:
    p_start = doc_xml.rfind('<w:p>', 0, i)
    p_end = doc_xml.find('</w:p>', i) + len('</w:p>')
    para = doc_xml[p_start:p_end]
    sep = para.find('fldCharType="separate"')
    if sep != -1 and '<w:hyperlink' in para:
        run_end = para.find('</w:r>', sep) + len('</w:r>')
        doc_xml = doc_xml[:p_start] + para[:run_end] + '</w:p>' + doc_xml[p_end:]
        print('TOC field paragraph cleaned (duplicate entry copy removed)')

# 2) find footer references per section (sectPr order = cover, toc, body)
sect_footers = re.findall(r'<w:footerReference w:type="default" r:id="(rId\d+)"/>', doc_xml)
rels = data["word/_rels/document.xml.rels"].decode("utf-8")
rid_to_target = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels))

# sections order: [TOC(roman), body(arabic)] — cover has no footer reference
formats = ["ROMAN", "arabic"]
patched = []
for idx, rid in enumerate(sect_footers[:2]):
    target = rid_to_target.get(rid, "")
    fname = "word/" + target.lstrip("/")
    if fname not in data:
        continue
    xml = data[fname].decode("utf-8")
    fmt = formats[idx] if idx < len(formats) else "arabic"
    new_xml, n = re.subn(
        r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
        rf"\1 PAGE \\* {fmt} \\* MERGEFORMAT \2",
        xml,
    )
    if n:
        data[fname] = new_xml.encode("utf-8")
        patched.append((fname, fmt, n))

data["word/document.xml"] = doc_xml.encode("utf-8")

with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for n in names:
        zout.writestr(n, data[n])
shutil.move(tmp, path)
print(f"pgNumType removed: {changed_doc}; footers patched: {patched}")
