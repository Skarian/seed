# Vast SSH authentication: confirmed ownership failure

During the owner's requested live session, Vast instance `50797980` (Virginia,
96 GB RTX PRO 6000 S, $1.664/hour including 180 GB disk) rejected initial SSH.
Unlike the earlier failed rental, this host was retained and diagnosed in place.

After a container reboot, provider logs captured the exact server rejection:
`Authentication refused: bad ownership or modes for file /root/.ssh/authorized_keys`.
An instrumented startup then showed the file as UID 111 / GID 987, mode 0644.
Seed's existing startup wrote the key and set 0600 but preserved that ownership.
OpenSSH's effective `StrictModes` was enabled. Correcting ownership to root and
mode to 0600 made the same key authenticate successfully on the same rental.

Vast's update-template API saved the changed onstart command, but a normal reboot
continued using the existing startup file. Recycling the still-empty container
in place activated it without losing the GPU reservation. No user jobs or models
existed yet. SSH login passed afterward, Seed paired, and model preparation began.

Private evidence: `.local/networking/vast-50797980-auth-diagnostic.json` contains
the rejection; `vast-50797980-ownership-fix.json` contains numeric before/after
ownership and accepted-key messages. This confirms this rental's cause. The older
deleted rental had similar symptoms, but its precise cause cannot be proved retroactively.

The source fix makes `worker/entrypoint.py` set root ownership before starting
sshd and sends sshd errors to container stderr. Two unit tests pass. A Linux
container regression recreated UID 111/GID 987 and verified correction to root,
0600 before sshd launch. The first regression invocation accidentally imported
the older image module; rerunning with `/testing` as the working directory tested
the mounted corrected source and passed.

Release status: source fix is not yet included in the pinned published image.
This live rental has the equivalent correction in its onstart command. Publish
and pin the correction before the next ordinary rental; do not disrupt this
owner-requested session to replace its image.
