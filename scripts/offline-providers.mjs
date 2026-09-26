// Local UI fixtures only. These transports never contact an external service.
import { writeFileSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { prepareStorage } from "../dist/server/storage.js";
import { Loras } from "../dist/server/loras.js";
import { offlinePool } from "./offline-pool.mjs";
export async function offlineProviders(paths) {
  prepareStorage(paths);
  writeFileSync(
    path.join(paths.config, "credentials.json"),
    JSON.stringify({
      vastApiKey: "offline-fixture",
      runpodApiKey: "offline-fixture",
      openrouterApiKey: "offline-fixture",
      civitaiKey: "offline-fixture",
      huggingFaceToken: null,
    }),
  );
  const header = Buffer.from(
      JSON.stringify({
        "model.lokr_w1": { dtype: "F32", shape: [1], data_offsets: [0, 4] },
      }),
    ),
    prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(header.length));
  const bytes = Buffer.concat([prefix, header, Buffer.alloc(4)]),
    sha = createHash("sha256").update(bytes).digest("hex"),
    file = path.join(paths.temp, "fixture.safetensors");
  writeFileSync(file, bytes);
  const loras = new Loras(paths);
  loras.applySources(
    "fixture-watercolor",
    [
      {
        name: "watercolor.safetensors",
        route: "image",
        source: {
          provider: "civitai",
          model_id: 5,
          version_id: 10,
          file_id: 20,
          url: "https://civitai.com/api/download/models/10",
          sha256: sha,
          size_bytes: bytes.length,
        },
      },
    ],
    {
      name: "Watercolor study",
      version: "v1",
      source_url: "https://civitai.com/models/5?modelVersionId=10",
      description: "Soft washes and paper texture. Use 0.8 for landscapes.",
      default_scale: 0.8,
      trigger_words: ["watercolor"],
      availability: "all",
      enabled: true,
    },
  );
  const id = loras.list("sfw")[0].id;
  const version = {
    id: 10,
    modelId: 5,
    name: "v1",
    baseModel: "Krea 2",
    model: { name: "Watercolor study", type: "LORA" },
    trainedWords: ["watercolor"],
    files: [
      {
        id: 20,
        name: "watercolor.safetensors",
        sizeKB: bytes.length / 1024,
        hashes: { SHA256: sha },
        downloadUrl: "https://civitai.com/api/download/models/10",
      },
    ],
  };
  const h3File = (value) => {
    const h = Buffer.from(
        JSON.stringify({
          "blocks.0.attn.qkv_proj.lora_A.weight": {
            dtype: "F32",
            shape: [1, 1],
            data_offsets: [0, 4],
          },
          "blocks.0.attn.qkv_proj.lora_B.weight": {
            dtype: "F32",
            shape: [1, 1],
            data_offsets: [4, 8],
          },
        }),
      ),
      p = Buffer.alloc(8),
      data = Buffer.alloc(8);
    p.writeBigUInt64LE(BigInt(h.length));
    data.writeFloatLE(value);
    return Buffer.concat([p, h, data]);
  };
  const h3Bytes = [h3File(1), h3File(2)];
  const h3Version = {
    id: 11,
    modelId: 6,
    name: "v2",
    baseModel: "MiniMax H3",
    model: { name: "Tonal study", type: "LORA" },
    trainedWords: ["tonal"],
    files: h3Bytes
      .map((data, i) => ({
        id: 30 + i,
        name: ["tone-a.safetensors", "tone-b.safetensors"][i],
        sizeKB: data.length / 1024,
        hashes: { SHA256: createHash("sha256").update(data).digest("hex") },
        downloadUrl:
          "https://civitai.com/api/download/models/11?type=Model&format=SafeTensor&fp=" +
          (i ? "fp32" : "fp16"),
      }))
      .concat([{ id: 32, name: "readme.txt", sizeKB: 1 }]),
  };
  const unsupported = {
    ...version,
    id: 13,
    modelId: 7,
    name: "v1",
    baseModel: "Other family",
    model: { name: "Unsupported study", type: "LORA" },
  };
  const versions = [version, h3Version, unsupported];
  const providerFetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.includes("/api/download/"))
      return new Response(
        u.pathname.endsWith("/11")
          ? h3Bytes[u.searchParams.get("fp") === "fp32" ? 1 : 0]
          : u.pathname.endsWith("/12")
            ? h3Bytes[1]
            : bytes,
      );
    if (u.hostname === "civitai.com" && u.pathname.includes("/model-versions/"))
      return Response.json(
        versions.find((v) => v.id === Number(u.pathname.split("/").at(-1))) ??
          version,
      );
    if (u.hostname === "civitai.com" && u.pathname.includes("/models/")) {
      const v =
        versions.find(
          (v) => v.modelId === Number(u.pathname.split("/").at(-1)),
        ) ?? version;
      return Response.json({ ...v.model, id: v.modelId, modelVersions: [v] });
    }
    if (
      u.pathname.endsWith("/me") ||
      u.pathname.endsWith("/key") ||
      u.pathname.endsWith("/me/") ||
      u.pathname.endsWith("/user") ||
      u.pathname.endsWith("/whoami-v2")
    )
      return Response.json({ valid: true });
    throw Error("No offline fixture for this provider operation.");
  };
  const sse = (delta) =>
    new Response(
      "data: " +
        JSON.stringify({
          id: randomUUID(),
          choices: [
            {
              index: 0,
              delta,
              finish_reason: delta.tool_calls ? "tool_calls" : "stop",
            },
          ],
        }) +
        "\n\ndata: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  const chatFetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    if (
      JSON.stringify(body.messages[0]).includes("Generate a concise chat title")
    )
      return sse({ content: "Watercolor landscape" });
    const edit = JSON.stringify(body.tools?.find(t=>t.function?.name==='create_request')?.function?.parameters).includes('"source"');
    if (body.messages.at(-1).role === "tool")
      return sse({
        content:
          edit ? "I prepared an edit to make the sky pink while preserving the mountains. Review the source and instructions before approving." : "I prepared a watercolor landscape with a gentle strength of 0.8. Review the request when you are ready.",
      });
    return sse({
      tool_calls: [
        {
          index: 0,
          id: randomUUID(),
          type: "function",
          function: {
            name: "create_request",
            arguments: JSON.stringify(edit ? {prompt:'Make the sky in [[input1]] pink; preserve the landscape.',inputs:[{asset:'input1',role:'source'}],seed:'42',batch_size:1} : {
              prompt:
                "A quiet watercolor mountain lake, soft washes and paper texture, watercolor",
              aspect_ratio: "16:9",
              size: "1mp",
              seed: "42",
              batch_size: 1,
              loras: [{ id, revision: sha, scale: 0.8 }],
            }),
          },
        },
      ],
    });
  };
  const pool = await offlinePool(paths);
  return {
    poolDependencies: pool.dependencies,
    providerFetch,
    chatFetch,
    fixtureControls: pool.controls,
  };
}
