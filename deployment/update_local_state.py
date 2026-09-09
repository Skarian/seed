import pathlib,json
p=pathlib.Path(__file__).parent
f=p/'configuration.json';d=json.loads(f.read_text());d['browserAuthentication']='Jupyter token or signed-in session cookie';d['browserUsername']=None;d['status']='testing-after-recreation';f.write_text(json.dumps(d,indent=2))
f=p/'prepare.py';s=f.read_text().replace('authenticated ComfyUI on 8080 and token-protected Jupyter on 8888','Jupyter form sign-in for ComfyUI on 8080 and token-protected Jupyter on 8888');f.write_text(s)
(p/'STATUS.md').write_text('''# Deployment status

- Network volume `f7vnixgws1`: 100 GB STANDARD in EUR-IS-1, $7/month.
- Private template `7522irqo4q`: stock Hearmeman v8 digest, secured browser access.
- Original pod `nl9k16upk37kt7`: released after verifying all durable files on network volume.
- Replacement pod `l9mwstucse5fmd`: active, approximately $2.11/hour plus network volume; final generation acceptance in progress.
- All ten model files match published SHA-256 hashes; exact total 81,464,127,748 bytes.
- First FL2VA and Ref2VA 768p Turbo 8 tests passed (114.86 and 107.77 seconds).
- Replacement startup skipped all ten downloads. Inputs, outputs, and five ready workflows survived.
- ComfyUI sign-in, workflow opening, queue submission, and live browser connection work in the built-in browser.
- Template description still mentions the earlier Basic-auth arrangement; actual bootstrap uses Jupyter form sign-in. Automatic review declined the optional description edit. Use START-HERE.md for current instructions.
''')
