# RunPod Tailscale download investigation

The slowdown reproduced on a second Romania host. Evidence points to the
userspace TCP sender on the Tailscale path, with unnecessary retransmission and
poor throughput on a roughly 143 ms RTT connection. Changing Seed's file-serving
method did not fix it. SSH remains the practical route for this environment.
This identifies the affected layer and observed transport behavior; it does not
prove a particular upstream source-code fix.

## Test environment

The original instance was already deleted. RTX 2000 Ada and L4 requests failed
with explicit capacity errors and were reconciled before retrying. The successful
replacement was RunPod `ye7zsefqfzlzj5`, EU-RO-1, RTX PRO 4000 Blackwell,
$0.57/hour compute, 150 GB disposable disk. Image digest:
`104ec310c1cc38f73b975a3b24a2822ad9d47e9069b7273c4c0bb716221d2bd3`.
One rental was active. This tested synthetic files, not model downloads/inference.

The replacement used a different public host address from the previous test.
Both had direct Tailscale peer paths; no observed DERP relay explains the slowdown.
The worker used official Tailscale 1.102.3 with userspace TCP Serve. The host
container had no `/dev/net/tun` and no CAP_NET_ADMIN, so kernel-mode networking
was not an available runtime switch. The Windows client was unchanged.

## Reproduction and controlled comparisons

Initial production-path test: SSH pairing 6.650 s; 16 MiB upload 3.756 s;
Tailscale enrollment/route change 13.589 s; remaining 48 MiB resumed over Tailscale
in 5.186 s. Same bearer and worker identity. The 64 MiB return download exceeded
the diagnostic 120-second timeout, reproducing the earlier failure.

Temporary authenticated aiohttp servers bound only to worker loopback. They used
the same file and existing credential verifier. One retained normal FileResponse;
the other used the supported `AIOHTTP_NOSENDFILE=1` environment switch. Each also
served an 8 MiB in-memory response. An additional loopback SSH forward and the
existing private Tailscale TCP Serve route exposed the same servers. The Serve
configuration was restored in a finally block. No public test HTTP port opened.

| Sender/client | SSH, 8 MiB | Tailscale, 8 MiB |
| --- | --- | --- |
| FileResponse baseline, Node | 1.979 s, hash passes | 3,890,704 bytes / 30 s, timeout |
| In-memory baseline, Node | 0.945 s, hash passes | 26.903 s, hash passes |
| FileResponse without sendfile, Node | 0.987 s, hash passes | 5,316,844 bytes / 30 s, timeout |
| In-memory second pass, Node | 0.945 s, hash passes | 4,890,226 bytes / 30 s, timeout |
| Restored baseline, Node | 0.982 s, hash passes | 4,640,756 bytes / 30 s, timeout |
| Original worker endpoint, curl | Not repeated | 26.877 s, 8,388,608 bytes received |

The curl case excludes a Node-only explanation. The alternate server and memory
cases exclude the original Seed output endpoint or disk reads as the sole cause.
The sendfile change failed to resolve it and was not added to production.

## Packet evidence

Captured 39,805,312 bytes using the worker's official `tailscale debug capture`.
The private capture includes authenticated HTTP and must not be published.
Local analysis reads TCP headers only, using dpkt and the capture's four-byte
Tailscale USER0 prefix. Outbound packets had path 3, inbound packets path 1.

Across the captured bulk flows, an exact repeated-sequence analysis identified
146 retransmitted segments; it can undercount retransmissions with different
segmentation. Of these, 136 had already been cumulatively or selectively
acknowledged in the latest preceding captured ACK. 81 were acknowledged within
20 ms after retransmission and 129 within 70 ms, against approximately 143 ms
median observed ACK latency. Those short intervals and prior acknowledgements
are evidence that many retransmissions were unnecessary, rather than successful
round trips recovering packets that had genuinely been lost.

The client advertised window scaling of 8; positive steady-state raw windows
around 6,142 represent approximately 1.57 MB of receive capacity. Observed bytes
in flight were far smaller (roughly 39–115 KB peak across complete probe flows).
Zero windows also appear around aborted transfers and should not be interpreted
as their initiating cause. These observations support loss-recovery/sender
behavior as the bottleneck rather than an 8 KB unscaled receiver-window limit.

The pinned [Tailscale source](https://github.com/tailscale/tailscale/blob/v1.102.3/wgengine/netstack/netstack.go)
explicitly selects Reno congestion control and disables TCP RACK. An
[upstream report](https://github.com/tailscale/tailscale/issues/20893) describes
userspace sender slowdown and spurious loss recovery with similar versions;
[another report](https://github.com/tailscale/tailscale/issues/20026) describes
slow userspace proxy downloads despite a direct connection. Our observations
are consistent with that class of problem. We did not compile a modified
Tailscale, switch congestion algorithms, or prove that enabling RACK fixes this
host. The capture alone does not establish where any packet reordering begins.

## Conclusion and closeout

Use SSH for this RunPod path. The sender comparison provides no justification
for rewriting Seed transfers, adding arbitrary chunking, or extending production
timeouts. Tailscale should remain experimental for bulk outputs until a supported
upstream release or suitable kernel-networking deployment passes the same test.
This does not show that all Tailscale deployments are slow; the earlier Vast
test passed. No automatic SSH fallback was added.

The final production SSH download verified the full 64 MiB hash in 6.280 s and
the worker confirmed receipt cleanup. Worker/provider logs, comparison results,
and the packet capture were saved privately under `.local/networking` before
teardown. The normal CLI confirmed deletion of this pod and its disposable disk;
subsequent RunPod and Vast listings were empty. No paid resource remains from
this investigation. RunPod billing may post later; the $0.57/hour rate is not a
settled invoice.
