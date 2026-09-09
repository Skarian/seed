import pathlib,base64
p=pathlib.Path(__file__).parent
c=(p/'nginx.conf').read_text().replace('proxy_set_header X-Forwarded-Proto https;','proxy_set_header X-Forwarded-Proto https;\n      proxy_cookie_flags ~ secure samesite=lax;')
(p/'nginx.conf').write_text(c)
b=(p/'bootstrap.sh').read_text()
start=b.index('cat > /etc/nginx/nginx.conf'); end=b.index('nginx -t',start)
b=b[:start]+"cat > /etc/nginx/nginx.conf <<'NGINX'\n"+c+'NGINX\n'+b[end:]
(p/'bootstrap.sh').write_text(b,newline='\n')
code='import pathlib,subprocess,base64\npathlib.Path("/etc/nginx/nginx.conf").write_bytes(base64.b64decode('+repr(base64.b64encode(c.encode()).decode())+'))\nsubprocess.run(["nginx","-t"],check=True)\nsubprocess.run(["nginx","-s","reload"],check=True)\n'
(p/'apply_nginx.py').write_text(code)
