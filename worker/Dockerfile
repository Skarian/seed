FROM tusproject/tusd@sha256:9610f0f8edf4cceeb26f1b3ac9fa4bb4803d61a878e222c1573cda63c9e23374 AS tusd
FROM ghcr.io/skarian/runpod-studio@sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15 AS runtime-base
LABEL org.opencontainers.image.source="https://github.com/Skarian/seed"
WORKDIR /opt/seed
# engine.json is the one software spec; this layer installs it for both roles.
COPY engine.json requirements-linux.lock install_engine.py /opt/seed/worker/
RUN /opt/venv/bin/python /opt/seed/worker/install_engine.py
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server musl && rm -rf /var/lib/apt/lists/* && rm -f /etc/ssh/ssh_host_*
COPY --from=tusd /usr/local/bin/tusd /usr/local/bin/tusd
RUN /usr/local/bin/tusd -version
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/opt/seed
EXPOSE 8080 8888
CMD ["/opt/venv/bin/python", "-m", "worker.entrypoint"]

# Package worker code independently from the large, immutable Qwen asset layer.
FROM runtime-base AS worker-code
ARG SOURCE_REVISION=development
ENV SEED_IMAGE_REVISION=${SOURCE_REVISION}
COPY __init__.py app.py jobs.py inputs.py spool.py profile.py prepare.py run.py entrypoint.py engine.json hardware.json models-image.json models-video.json requirements.txt model_files.py download_process.py download_progress.py preparation.py processes.py uploads.py owned_process.py /opt/seed/worker/
COPY static/ /opt/seed/worker/static/
COPY diagnostics.py /opt/seed/worker/
COPY resolution.py resolutions.json /opt/seed/worker/
COPY comfy_seed/ /ComfyUI/custom_nodes/comfy_seed/
COPY spool.py /ComfyUI/custom_nodes/comfy_seed/spool.py

FROM worker-code AS video
ENV SEED_WORKER_CLASS=video
RUN rm /opt/seed/worker/models-image.json

FROM runtime-base AS qwen-assets
COPY qwen-model.json bake_qwen.py /opt/seed/worker/
RUN HF_HUB_DISABLE_XET=1 HF_XET_CHUNK_CACHE_SIZE_BYTES=0 /opt/venv/bin/python -m worker.bake_qwen

# GHCR limits each layer to 10 GB. Copy the pinned shards individually instead
# of inheriting the combined download layer.
FROM runtime-base AS image
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
RUN rm -f /opt/seed/worker/models-video.json
