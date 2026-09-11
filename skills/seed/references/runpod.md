# RunPod

Complete [setup](setup.md) with RunPod credentials and start the local app.
Run `seed pod-setup` to reuse/create the private Seed template and select network
storage. `--volume ID` selects an existing volume. `--create` asks for region,
capacity and storage cost before creation. Retain existing volumes; do not migrate
or replicate storage without authorization.

The installed operations are:

- `seed gpu runpod status`: sanitized pod and studio status.
- `seed gpu runpod catalog`: current GPU prices/availability.
- `seed gpu runpod create --gpu GPU_ID --max-hourly USD`: create one GPU using
  the saved volume/template, pinned image and generated SSH public key.
- `seed gpu runpod wait`: bounded startup wait for the recorded pod.
- `seed gpu runpod prepare`: direct model downloads with optional PC fallback.
- `seed gpu runpod connect --pod ID`: pair to the recorded worker.
- `seed gpu runpod safe --pod ID`: check output saving before shutdown.
- `seed gpu runpod destroy`: delete the recorded pod and retain network storage.
- `seed gpu runpod reconcile`: inspect an uncertain creation before trying again.

RunPod network storage constrains the datacenter. Inspect GPU capacity there;
an availability listing is not a reservation. Check Vast state too before renting.
New commands are under live validation; see studio/VALIDATION.md in the repository.
Report failures rather than claiming a verified lifecycle prematurely.

Pairing uses the saved private template or recorded pod/image identity. Never send
its secret to an arbitrary endpoint. Direct SSH prepares files; normal app traffic
uses the authenticated RunPod HTTPS proxy. Source credentials are not stored in
the template. The image starts Jupyter separately; it is not studio authentication.

For uncertainty, reconcile before another creation. Resume interrupted preparation
once; if the new worker cannot become usable, destroy it and verify absence.
Paired sessions require fresh safe-to-terminate status. Keep pre-existing network
storage, which remains billable even after the GPU is removed.
