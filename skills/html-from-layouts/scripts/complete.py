#!/usr/bin/env python3
"""Fill only [[...]] spans using reviewed JSON replacements; never call an LLM."""
import argparse,hashlib,json,re,sys
from pathlib import Path
BLANK=re.compile(r'\[\[(.*?)\]\]',re.S)
def gaps(source):
    """Fenced and inline code are literal, including apparent completion markers."""
    protected=[];offset=0;fence=None;start=0
    for line in source.splitlines(keepends=True):
        m=re.match(r'^\s*(`{3,}|~{3,})(.*)$',line.rstrip('\r\n'))
        if m:
            if fence is None:fence=m.group(1);start=offset
            elif m.group(1)[0]==fence[0] and len(m.group(1))>=len(fence) and not m.group(2).strip():
                protected.append((start,offset+len(line)));fence=None
        offset+=len(line)
    if fence:raise ValueError('Unclosed code fence')
    protected.extend((m.start(),m.end()) for m in re.finditer(r'(`+).*?\1',source))
    return [m for m in BLANK.finditer(source) if not any(a<=m.start()<b for a,b in protected)]
def inventory(source):
    return [{'id':i,'prompt':m.group(1).strip(),'line':source.count('\n',0,m.start())+1,
             'context':source[max(0,m.start()-100):min(len(source),m.end()+100)]} for i,m in enumerate(gaps(source),1)]
def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('input');ap.add_argument('--inventory',action='store_true');ap.add_argument('--replacements')
    ap.add_argument('-o','--output');ap.add_argument('--color',default='000000')
    ap.add_argument('--no-ai-marker',action='store_true',help='Disable the ✦ marker on generated list items')
    ap.add_argument('--reuse',help='Previous completion manifest; reuse only unique unchanged prompts')
    a=ap.parse_args(argv);src=Path(a.input).resolve();text=src.read_bytes().decode('utf-8')
    entries=inventory(text)
    if a.inventory:
        value=json.dumps(entries,ensure_ascii=False,indent=2)
        if a.output:
            if Path(a.output).resolve()==src:ap.error('Inventory output must differ from input')
            Path(a.output).write_text(value)
        else:print(value)
        return
    if not a.output:ap.error('--output is required')
    out=Path(a.output).resolve()
    protected={src}
    for path in [a.replacements,a.reuse]:
        if path:protected.add(Path(path).resolve())
    if out in protected or out.with_suffix('.completion.json') in protected:ap.error('Output and manifest must differ from inputs')
    if not re.fullmatch('[0-9a-fA-F]{6}',a.color):ap.error('Color requires six hex digits')
    supplied=json.loads(Path(a.replacements).read_text()) if a.replacements else {}
    if not isinstance(supplied,dict):ap.error('Replacements must be an object keyed by inventory ID')
    unknown=set(supplied)-{str(e['id']) for e in entries}
    if unknown:ap.error('Unknown replacement IDs: '+','.join(sorted(unknown)))
    reused=json.loads(Path(a.reuse).read_text())['replacements'] if a.reuse else []
    filled=[];manifest=[];pos=0
    for e,m in zip(entries,gaps(text)):
        if re.search(r'^\s*---\s*$',m.group(),re.M):ap.error('A source gap cannot span an existing page separator')
        key=str(e['id']);value=supplied.get(key)
        if value is None:
            candidates=[r for r in reused if r['prompt']==e['prompt']]
            if len(candidates)==1 and sum(x['prompt']==e['prompt'] for x in entries)==1:value=candidates[0]['text']
        if not isinstance(value,str) or not value.strip():ap.error(f'Missing replacement for {key}: {e["prompt"]}')
        if '[[' in value:ap.error(f'Unresolved blank in replacement {key}')
        if re.search(r'^\s*---\s*$',value,re.M):ap.error('Replacements cannot add page separators')
        if '{color:' in value or '{/color}' in value:ap.error('Provide plain replacement text; color is applied automatically')
        rendered=[]
        source_prefix=text[text.rfind('\n',0,m.start())+1:m.start()]
        source_end=text.find('\n',m.end())
        source_suffix=text[m.end():source_end if source_end>=0 else len(text)]
        for line_index,line in enumerate(value.split('\n')):
            # Keep list syntax/indentation outside the inline color marker.
            match=re.match(r'^(\s*(?:[-*+] |\d+[.)] )?)(.*)$',line)
            prefix,content=match.groups()
            list_start=(line_index>0 and bool(re.fullmatch(r'\s*(?:[-*+] |\d+[.)] )\s*',prefix))) or (line_index==0 and not source_suffix.strip() and bool(re.fullmatch(r'\s*(?:[-*+] |\d+[.)] )\s*',source_prefix)))
            explicit_marker=content.startswith('✦ ')
            if explicit_marker:content=content[2:]
            marker='✦ ' if explicit_marker or (list_start and not a.no_ai_marker) else ''
            if content:rendered.append(prefix+marker+'{color:#'+a.color+'}'+content+'{/color}')
            else:rendered.append(line)
        filled.extend([text[pos:m.start()],'\n'.join(rendered)]);pos=m.end()
        manifest.append({'id':e['id'],'prompt':e['prompt'],'text':value,'source_span':[m.start(),m.end()],
                         'whole_list_item':bool(re.fullmatch(r'\s*(?:[-*+] |\d+[.)] )\s*',source_prefix)) and not source_suffix.strip()})
    filled.append(text[pos:]);result=''.join(filled)
    out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(result.encode('utf-8'))
    out.with_suffix('.completion.json').write_text(json.dumps({'source_sha256':hashlib.sha256(text.encode()).hexdigest(),
        'source':str(src),'color':a.color,'ai_marker':None if a.no_ai_marker else '✦','replacements':manifest},ensure_ascii=False,indent=2))
    print(f'Completed {len(entries)} blanks: {out}')
if __name__=='__main__':main()
