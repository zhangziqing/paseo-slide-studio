"""Extract a PPTX/POTX style contract plus background/specimen decks for PDF export."""
import argparse,hashlib,json,zipfile,io
from pathlib import Path
from copy import deepcopy
from lxml import etree
from pptx import Presentation
A='http://schemas.openxmlformats.org/drawingml/2006/main'
NS={'a':A,'p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
def merge(dst,src):
 dst.attrib.update(src.attrib)
 for c in src:
  old=dst.find(c.tag)
  if old is not None and c.tag.endswith('defRPr'):merge(old,c)
  else:
   if old is not None:dst.remove(old)
   dst.append(deepcopy(c))
def profile(path,out):
 if any((Path(out)/n).exists() for n in ('theme.json','background.pptx','specimen.pptx')):raise ValueError('Profile into a new directory; existing theme artifacts are protected')
 out=Path(out);out.mkdir(parents=True,exist_ok=True);raw=Path(path).read_bytes()
 if Path(path).suffix.lower()=='.potx':
  buf=io.BytesIO()
  with zipfile.ZipFile(io.BytesIO(raw)) as z,zipfile.ZipFile(buf,'w') as w:
   for n in z.namelist():
    data=z.read(n)
    if n=='[Content_Types].xml':data=data.replace(b'presentationml.template.main+xml',b'presentationml.presentation.main+xml')
    w.writestr(n,data)
  raw=buf.getvalue()
 prs=Presentation(io.BytesIO(raw))
 with zipfile.ZipFile(io.BytesIO(raw)) as z:theme=etree.fromstring(z.read('ppt/theme/theme1.xml'))
 colors={}
 for c in theme.find('a:themeElements/a:clrScheme',NS):
  n=c[0];colors[c.tag.split('}')[-1]]=n.get('lastClr',n.get('val'))
 cmap=prs.slide_masters[0]._element.find('p:clrMap',NS).attrib
 def color(node):
  if node is None or not len(node):return '000000'
  n=node[0];val=n.get('val');val=colors.get(cmap.get(val,val),val) if n.tag.endswith('schemeClr') else val
  rgb=[int(val[i:i+2],16) for i in (0,2,4)]
  for t in n:
   v=int(t.get('val'))/100000;tag=t.tag.split('}')[-1]
   if tag in ('lumMod','shade'):rgb=[round(c*v) for c in rgb]
   elif tag=='tint':rgb=[round(c+(255-c)*v) for c in rgb]
  return ''.join(f'{min(255,max(0,c)):02X}' for c in rgb)
 fonts={}
 for family,key in [('majorFont','major'),('minorFont','minor')]:
  node=theme.find('a:themeElements/a:fontScheme/a:'+family,NS)
  fonts[key]={k:node.find('a:'+k,NS).get('typeface') for k in ['latin','ea']}
 def font(n,kind):
  if not n:return fonts['minor'][kind]
  if n.startswith('+'):return fonts['major' if n[1:3]=='mj' else 'minor']['ea' if n.endswith('ea') else 'latin']
  return n
 layouts=[]
 for i,l in enumerate(prs.slide_layouts):
  shapes=[]
  for s in l.placeholders:
   typ=int(s.placeholder_format.type)
   if typ not in (1,3,2,4,7):continue
   master_ph=next((q for q in l.slide_master.placeholders if int(q.placeholder_format.type)==typ),None)
   if master_ph is None:master_ph=next((q for q in l.slide_master.placeholders if int(q.placeholder_format.type)==(1 if typ in (1,3) else 2)),None)
   bp={'lIns':'91440','rIns':'91440','tIns':'45720','bIns':'45720','anchor':'t'}
   for q in [master_ph,s]:
    if q is not None:
     n=q._element.find('p:txBody/a:bodyPr',NS)
     if n is not None:bp.update(n.attrib)
   styles=[]
   for lev in range(1,10):
    st=etree.Element('{'+A+'}pPr');kind='titleStyle' if typ in (1,3) else 'bodyStyle'
    for n in l.slide_master._element.findall('p:txStyles/p:'+kind+'/a:lvl'+str(lev)+'pPr',NS):merge(st,n)
    for n in s._element.findall('p:txBody/a:lstStyle/a:lvl'+str(lev)+'pPr',NS):merge(st,n)
    r=st.find('a:defRPr',NS)
    if r is None:r=etree.Element('{'+A+'}defRPr')
    def typeface(k):
     n=r.find('a:'+k,NS);return font(n.get('typeface') if n is not None else None,k)
    def space(tag):
     n=st.find('a:'+tag+'/a:spcPts',NS)
     if n is not None:return float(n.get('val'))/100
     n=st.find('a:'+tag+'/a:spcPct',NS)
     return float(n.get('val'))/100000*float(r.get('sz','2400'))/100 if n is not None else 0
    ln=st.find('a:lnSpc/a:spcPct',NS);bu=st.find('a:buChar',NS)
    styles.append(dict(size=float(r.get('sz','2400'))/100,bold=r.get('b','0')=='1',color=color(r.find('a:solidFill',NS)),latin=typeface('latin'),cjk=typeface('ea'),align=st.get('algn','l'),margin_left=float(st.get('marL','0'))/12700,indent=float(st.get('indent','0'))/12700,leading=float(ln.get('val'))/100000 if ln is not None else 1,before=space('spcBef'),after=space('spcAft'),bullet=bu.get('char') if bu is not None else '•'))
   shapes.append(dict(id=s.placeholder_format.idx,role='title' if typ in (1,3) else 'subtitle' if typ==4 else 'body',box=[round(getattr(s,a)/12700,6) for a in ['left','top','width','height']],margins=[float(bp[k])/12700 for k in ['lIns','tIns','rIns','bIns']],anchor=bp['anchor'],styles=styles))
  layouts.append(dict(index=i,name=l.name,placeholders=shapes))
 result=dict(version=1,source_sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest(),unit='bp (1/72 inch)',width=prs.slide_width/12700,height=prs.slide_height/12700,fonts=fonts,layouts=layouts,background_pdf='background.pdf',ai_color='7F7F7F')
 for layout in prs.slide_layouts:
  number=next((q for q in layout.shapes if q._element.xpath('.//a:fld[@type="slidenum"]')),None)
  if number is not None:
   n=etree.Element('{'+A+'}defRPr')
   for owner,xpath in [(layout.slide_master._element,'p:txStyles/p:otherStyle/a:lvl1pPr/a:defRPr'),(number._element,'p:txBody/a:lstStyle/a:lvl1pPr/a:defRPr'),(number._element,'.//a:fld/a:rPr')]:
    inherited=owner.find(xpath,NS)
    if inherited is not None:merge(n,inherited)
   size=float(n.get('sz','1300'))/100
   result['page_number']=dict(id='number',box=[getattr(number,k)/12700 for k in ['left','top','width','height']],margins=[getattr(number.text_frame,'margin_'+k)/12700 for k in ['left','top','right','bottom']],anchor='ctr',styles=[dict(size=size,bold=False,color=color(n.find('a:solidFill',NS)),latin=fonts['minor']['latin'],cjk=fonts['minor']['ea'],align='r',margin_left=0,indent=0,leading=1,before=0,after=0)])
   break
 # Layout order/name is not evidence of semantic role in a new template.
 result['aliases']={}
 result['font_faces']=[]
 result['onboarding_review']='Review actual placeholder capacity, aliases and regular/bold local browser font faces before generation'
 (out/'theme.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 for sid in list(prs.slides._sldIdLst):prs.part.drop_rel(sid.rId);prs.slides._sldIdLst.remove(sid)
 # Remove slide-number fields from the reusable background; generator restores one dynamic number.
 for l in list(prs.slide_layouts)+list(prs.slide_masters):
  for s in list(l.shapes):
   if s._element.xpath('.//a:fld[@type="slidenum"]'):
    s._element.getparent().remove(s._element)
 for l in prs.slide_layouts:
  slide=prs.slides.add_slide(l)
  for s in slide.placeholders:
   if s.has_text_frame:s.text_frame.clear()
 prs.save(out/'background.pptx')
 # Same native placeholders for a typography comparison, one page per layout.
 for slide,layout in zip(prs.slides,layouts):
  for ph in layout['placeholders']:
   s=slide.placeholders[ph['id']];s.text_frame.clear()
   items=['模板一致性 Template Fidelity'] if ph['role']=='title' else ['中文与 English 排版','第二级内容 Level two','第三级内容 Level three'] if ph['role']=='body' else ['HTML · 自定义模板对照']
   for j,value in enumerate(items):
    p=s.text_frame.paragraphs[0] if j==0 else s.text_frame.add_paragraph();p.text=value;p.level=j if ph['role']=='body' else 0
 prs.save(out/'specimen.pptx')
 print(out/'theme.json')
if __name__=='__main__':
 a=argparse.ArgumentParser(description=__doc__);a.add_argument('template');a.add_argument('-o','--output',required=True);x=a.parse_args();profile(x.template,x.output)
