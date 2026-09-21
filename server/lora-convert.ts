import { open, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

type Tensor = { dtype: string; shape: number[]; data_offsets: [number, number] };
/** Read and validate only the header; adapter weights remain on disk. */
export async function readTensorHeader(file: string) {
  const input = await open(file, 'r');
  try {
    const prefix = Buffer.alloc(8);
    if ((await input.read(prefix, 0, 8, 0)).bytesRead !== 8) throw Error('Invalid safetensors header.');
    const length = Number(prefix.readBigUInt64LE()), size = (await input.stat()).size;
    if (length < 2 || length > 16 * 1024 ** 2 || length + 8 > size) throw Error('Invalid safetensors header.');
    const bytes = Buffer.alloc(length);
    if ((await input.read(bytes, 0, length, 8)).bytesRead !== length) throw Error('Truncated safetensors header.');
    const parsed = JSON.parse(bytes.toString());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Invalid safetensors header.');
    const tensors: Record<string, Tensor> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key === '__metadata__') continue;
      const tensor = value as Tensor;
      if (!tensor || !Array.isArray(tensor.shape) || !tensor.shape.every(n => Number.isSafeInteger(n) && n >= 0)
        || typeof tensor.dtype !== 'string' || !Array.isArray(tensor.data_offsets) || tensor.data_offsets.length !== 2
        || !tensor.data_offsets.every(n => Number.isSafeInteger(n) && n >= 0)
        || tensor.data_offsets[1] <= tensor.data_offsets[0] || tensor.data_offsets[1] > size - 8 - length)
        throw Error('Invalid safetensors tensor range.');
      tensors[key] = tensor;
    }
    return { tensors, dataStart: 8 + length };
  } finally { await input.close(); }
}

/** Exact H3 Kohya naming conversion, only when alpha == rank. Preserves all
 * matrix bytes, dtypes and shapes; rejects unknown modules or non-unit scaling. */
export async function convertH3Lora(source: string, target: string) {
  const { tensors: original, dataStart } = await readTensorHeader(source);
  const mapped: Record<string, Tensor> = {}, parts: Array<{ start: number; end: number }> = [];
  const input = await open(source, 'r');
  let offset = 0;
  try {
    for (const [key, tensor] of Object.entries(original)) {
      const match = /^lora_unet_blocks_(\d+)_(attn_out_proj|attn_qkv_proj|mlp_fc1|mlp_fc2)\.(alpha|lora_down\.weight|lora_up\.weight)$/.exec(key);
      if (!match) throw Error('This converter supports only H3 block attention/MLP Kohya adapters.');
      const stem = key.slice(0, key.lastIndexOf(match[3]!) - 1);
      const a = original[stem + '.lora_down.weight'], b = original[stem + '.lora_up.weight'], alpha = original[stem + '.alpha'];
      if (!a || !b || !alpha || a.shape.length !== 2 || b.shape.length !== 2 || a.shape[0] !== b.shape[1]
        || !a.shape[0] || alpha.dtype !== 'F32' || alpha.data_offsets[1] - alpha.data_offsets[0] !== 4)
        throw Error('Incomplete or invalid H3 adapter pair.');
      const scalar = Buffer.alloc(4); await input.read(scalar, 0, 4, dataStart + alpha.data_offsets[0]);
      if (scalar.readFloatLE() !== a.shape[0]) throw Error('This converter requires alpha equal to rank; refusing to change adapter strength.');
      if (match[3] === 'alpha') continue;
      const leaf = ({ attn_out_proj:'attn.out_proj', attn_qkv_proj:'attn.qkv_proj', mlp_fc1:'mlp.fc1', mlp_fc2:'mlp.fc2' } as Record<string, string>)[match[2]!]!;
      const name = `blocks.${match[1]}.${leaf}.${match[3] === 'lora_down.weight' ? 'lora_A' : 'lora_B'}.weight`;
      const size = tensor.data_offsets[1] - tensor.data_offsets[0];
      const width = ({ F16:2, BF16:2, F32:4, F64:8 } as Record<string, number>)[tensor.dtype];
      if (!width || size !== tensor.shape.reduce((x, y) => x * y, width) || mapped[name]) throw Error('Invalid adapter matrix.');
      mapped[name] = { ...tensor, data_offsets: [offset, offset + size] }; offset += size;
      parts.push({ start: dataStart + tensor.data_offsets[0], end: dataStart + tensor.data_offsets[1] - 1 });
    }
  } finally { await input.close(); }
  if (!parts.length) throw Error('No adapter weights found.');
  const raw = JSON.stringify(mapped), header = Buffer.from(raw.padEnd(Math.ceil(Buffer.byteLength(raw) / 8) * 8, ' '));
  const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.length));
  const temp = target + '.tmp', output = await open(temp, 'wx');
  try {
    await output.writeFile(prefix); await output.writeFile(header);
    for (const part of parts) for await (const chunk of createReadStream(source, part)) await output.writeFile(chunk);
    await output.sync(); await output.close(); await rename(temp, target);
  } catch (error) { await output.close().catch(() => {}); await rm(temp, { force: true }); throw error; }
  return { tensors: parts.length, bytes: offset };
}
