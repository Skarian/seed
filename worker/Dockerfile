FROM ghcr.io/skarian/runpod-studio@sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15
LABEL org.opencontainers.image.source="https://github.com/Skarian/runpod"
WORKDIR /opt/seed
COPY __init__.py app.py jobs.py spool.py preset.py prepare.py run.py models.json requirements.txt /opt/seed/worker/
COPY static/ /opt/seed/worker/static/
COPY comfy_seed/ /ComfyUI/custom_nodes/comfy_seed/
COPY spool.py /ComfyUI/custom_nodes/comfy_seed/spool.py
RUN test "$(git -C /ComfyUI rev-parse HEAD)" = "12d5279438bfefc058a269eae805ceab6047777f" && /opt/venv/bin/python -c "import importlib.metadata as m; assert m.version('aiohttp') == '3.14.3'; assert m.version('huggingface_hub') == '1.29.0'; assert m.version('torch') == '2.11.0+cu130'; assert m.version('jupyterlab') == '4.6.3'"
ENV PYTHONUNBUFFERED=1
EXPOSE 8080 8888
CMD ["/opt/venv/bin/python", "-m", "worker.run"]
