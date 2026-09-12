FROM tusproject/tusd@sha256:9610f0f8edf4cceeb26f1b3ac9fa4bb4803d61a878e222c1573cda63c9e23374 AS tusd
FROM ghcr.io/skarian/runpod-studio@sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15
LABEL org.opencontainers.image.source="https://github.com/Skarian/seed"
WORKDIR /opt/seed
RUN git -C /ComfyUI fetch --depth 1 origin 40c4fcdf513a4523e39d54a9d391908af8df8171 \
    && git -C /ComfyUI checkout --detach 40c4fcdf513a4523e39d54a9d391908af8df8171 \
    && /opt/venv/bin/python -m pip install --no-cache-dir \
       comfyui-frontend-package==1.51.10 comfyui-workflow-templates==0.11.57 \
       comfyui-embedded-docs==0.5.11 comfy-kitchen==0.2.33 comfy-aimdo==0.5.3
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server musl && rm -rf /var/lib/apt/lists/* && rm -f /etc/ssh/ssh_host_*
COPY --from=tusd /usr/local/bin/tusd /usr/local/bin/tusd
RUN /usr/local/bin/tusd -version
COPY __init__.py app.py jobs.py inputs.py spool.py preset.py prepare.py run.py entrypoint.py models.json requirements.txt model_files.py download_process.py preparation.py processes.py uploads.py owned_process.py /opt/seed/worker/
COPY static/ /opt/seed/worker/static/
COPY comfy_seed/ /ComfyUI/custom_nodes/comfy_seed/
COPY spool.py /ComfyUI/custom_nodes/comfy_seed/spool.py
RUN test "$(git -C /ComfyUI rev-parse HEAD)" = "40c4fcdf513a4523e39d54a9d391908af8df8171" && /opt/venv/bin/python -c "import importlib.metadata as m; assert m.version('aiohttp') == '3.14.3'; assert m.version('huggingface_hub') == '1.29.0'; assert m.version('torch') == '2.11.0+cu130'; assert m.version('jupyterlab') == '4.6.3'; assert m.version('comfy-kitchen') == '0.2.33'; assert m.version('comfy-aimdo') == '0.5.3'"
ENV PYTHONUNBUFFERED=1
EXPOSE 8080 8888
CMD ["/opt/venv/bin/python", "-m", "worker.entrypoint"]
