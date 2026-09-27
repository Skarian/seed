FROM tusproject/tusd@sha256:9610f0f8edf4cceeb26f1b3ac9fa4bb4803d61a878e222c1573cda63c9e23374 AS tusd
FROM ghcr.io/skarian/runpod-studio@sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15 AS runtime-base
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
RUN test "$(git -C /ComfyUI rev-parse HEAD)" = "40c4fcdf513a4523e39d54a9d391908af8df8171" && /opt/venv/bin/python -c "import importlib.metadata as m; assert m.version('aiohttp') == '3.14.3'; assert m.version('huggingface_hub') == '1.29.0'; assert m.version('torch') == '2.11.0+cu130'; assert m.version('jupyterlab') == '4.6.3'; assert m.version('comfy-kitchen') == '0.2.33'; assert m.version('comfy-aimdo') == '0.5.3'"
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/opt/seed
EXPOSE 8080 8888
CMD ["/opt/venv/bin/python", "-m", "worker.entrypoint"]

# Package worker code independently from the large, immutable Qwen asset layer.
FROM runtime-base AS worker-code
ARG SOURCE_REVISION=development
ENV SEED_IMAGE_REVISION=${SOURCE_REVISION}
COPY __init__.py app.py jobs.py inputs.py spool.py profile.py prepare.py run.py entrypoint.py models.json models-image.json models-video.json requirements.txt model_files.py download_process.py download_progress.py preparation.py processes.py uploads.py owned_process.py /opt/seed/worker/
COPY static/ /opt/seed/worker/static/
COPY diagnostics.py /opt/seed/worker/
COPY comfy_seed/ /ComfyUI/custom_nodes/comfy_seed/
COPY spool.py /ComfyUI/custom_nodes/comfy_seed/spool.py

FROM worker-code AS video
ENV SEED_WORKER_CLASS=video
RUN rm /opt/seed/worker/models-image.json /opt/seed/worker/models.json

# Only the Image role upgrades ComfyUI. Video remains on the proven runtime.
FROM runtime-base AS qwen-runtime
RUN git -C /ComfyUI fetch --depth 1 origin b5cc8830279eae909a59de030af1e50761c36751 \
    && git -C /ComfyUI checkout --detach b5cc8830279eae909a59de030af1e50761c36751 \
    && /opt/venv/bin/python -m pip install --no-cache-dir -r /ComfyUI/requirements.txt \
    && /opt/venv/bin/python -c "import torch; assert torch.__version__ == '2.11.0+cu130'; from pathlib import Path; assert 'class QwenImage21' in Path('/ComfyUI/comfy/supported_models.py').read_text()"

FROM qwen-runtime AS qwen-assets
COPY qwen-model.json bake_qwen.py /opt/seed/worker/
RUN HF_HUB_DISABLE_XET=1 HF_XET_CHUNK_CACHE_SIZE_BYTES=0 /opt/venv/bin/python -m worker.bake_qwen

# GHCR limits each layer to 10 GB. Copy the pinned shards individually instead
# of inheriting the combined download layer.
FROM qwen-runtime AS image
COPY QWEN-LICENSE /opt/models/qwen-image-2.1/LICENSE
COPY qwen-model.json bake_qwen.py /opt/seed/worker/
COPY --from=qwen-assets /opt/models/qwen-image-2.1/diffusion_models/qwen_image_2.1_int8_convrot.safetensors /opt/models/qwen-image-2.1/diffusion_models/
COPY --from=qwen-assets /opt/models/qwen-image-2.1/text_encoders/qwen3vl_8b_int8_convrot.safetensors /opt/models/qwen-image-2.1/text_encoders/
COPY --from=qwen-assets /opt/models/qwen-image-2.1/vae/qwen_image_2.1_vae_bf16.safetensors /opt/models/qwen-image-2.1/vae/
ARG SOURCE_REVISION=development
COPY --from=worker-code /opt/seed/worker/ /opt/seed/worker/
COPY --from=worker-code /ComfyUI/custom_nodes/comfy_seed/ /ComfyUI/custom_nodes/comfy_seed/
ENV SEED_WORKER_CLASS=image SEED_IMAGE_REVISION=${SOURCE_REVISION}
ENTRYPOINT ["/opt/nvidia/nvidia_entrypoint.sh"]
CMD ["/opt/venv/bin/python", "-m", "worker.entrypoint"]
RUN rm -f /opt/seed/worker/models-video.json /opt/seed/worker/models.json
