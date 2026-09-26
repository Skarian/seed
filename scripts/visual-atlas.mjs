import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(process.env.SEED_ATLAS_ROOT ?? ".local/worker-pool-atlas");
await mkdir(root, { recursive: true });
const source = await readFile(
  process.env.SEED_ATLAS_SPEC ?? "tests/browser/worker-pool-atlas.spec.ts",
  "utf8",
);
const block = source.match(/const catalog = \[([\s\S]*?)\] as const;/)?.[1];
if (!block) throw Error("Visual scenario catalog was not found.");
const scenarios = [...block.matchAll(/\['(\d+)','([^']+)','([^']+)'\]/g)].map(
  ([, id, surface, title]) => ({ id, surface, title }),
);
const escape = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const records = [];
for (const device of ["desktop", "mobile"])
  for (const scenario of scenarios) {
    let result;
    try {
      result = JSON.parse(
        await readFile(path.join(root, device, scenario.id + ".json"), "utf8"),
      );
      if(result.captures)result.captures=result.captures.map(capture=>typeof capture==='string'?{file:capture,position:'Capture'}:capture);
      if (process.env.SEED_ATLAS_RUN_ID && result.run_id !== process.env.SEED_ATLAS_RUN_ID)
        throw Error('Capture belongs to an earlier run.');
    } catch {
      result = { ...scenario, device, status: "missing", file: null };
    }
    records.push(result);
  }
let revision = "unavailable";
let workingTreeDirty = null;
try {
  revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
  workingTreeDirty = Boolean(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      encoding: "utf8",
    }).trim(),
  );
  if (workingTreeDirty) revision += " + working changes";
} catch {}
const sheets = [];
for (const device of ["desktop", "mobile"]) {
  const entries = records.filter((record) => record.device === device),
    columns = device === "desktop" ? 2 : 3,
    rows = 2,
    tileW = device === "desktop" ? 530 : 292,
    tileH = device === "desktop" ? 510 : 730,
    gap = 22,
    perPage = columns * rows;
  for (let offset = 0; offset < entries.length; offset += perPage) {
    const group = entries.slice(offset, offset + perPage),
      width = gap + (tileW + gap) * columns,
      height = 68 + gap + (tileH + gap) * Math.ceil(group.length / columns),
      layers = [];
    const heading = Buffer.from(
      `<svg width="${width}" height="68"><rect width="100%" height="100%" fill="#141914"/><text x="22" y="31" fill="#e4edd8" font-family="Segoe UI,Arial" font-size="20">Seed · ${device} · ${group[0].id}–${group.at(-1).id}</text><text x="22" y="53" fill="#a6b698" font-family="Segoe UI,Arial" font-size="12">Revision ${escape(revision)} · Open index.html for full-size screenshots and test status</text></svg>`,
    );
    layers.push({ input: heading, left: 0, top: 0 });
    for (let index = 0; index < group.length; index++) {
      const record = group[index],
        left = gap + (index % columns) * (tileW + gap),
        top = 68 + gap + Math.floor(index / columns) * (tileH + gap);
      const title =
        record.title.length > 42
          ? record.title.slice(0, 40) + "…"
          : record.title;
      const caption = Buffer.from(
        `<svg width="${tileW}" height="70"><rect width="100%" height="100%" fill="#28331f"/><text x="13" y="26" fill="#e4f1cf" font-family="Segoe UI,Arial" font-size="15" font-weight="600">${escape(record.id + " · " + title)}</text><text x="13" y="49" fill="${record.status === "passed" ? "#aec98b" : "#edb795"}" font-family="Segoe UI,Arial" font-size="12">${escape(record.surface + " · " + record.status)}</text></svg>`,
      );
      layers.push({ input: caption, left, top });
      let screenshot;
      try {
        if (!record.file) throw Error();
        screenshot = await sharp(path.join(root, record.file))
          .resize(tileW, tileH - 70, { fit: "contain", background: "#10140f" })
          .png()
          .toBuffer();
      } catch {
        screenshot = Buffer.from(
          `<svg width="${tileW}" height="${tileH - 70}"><rect width="100%" height="100%" fill="#231d18"/><text x="18" y="48" fill="#e3bd9d" font-family="Segoe UI,Arial" font-size="17">Capture missing — not verified</text></svg>`,
        );
      }
      layers.push({ input: screenshot, left, top: top + 70 });
    }
    const name = `mosaic-${device}-${String(offset / perPage + 1).padStart(2, "0")}.png`;
    await sharp({
      create: { width, height, channels: 3, background: "#141914" },
    })
      .composite(layers)
      .png()
      .toFile(path.join(root, name));
    sheets.push({ device, file: name, from: group[0].id, to: group.at(-1).id });
  }
}
const manifest = {
  revision,
  working_tree_dirty: workingTreeDirty,
  generated_at: new Date().toISOString(),
  coverage: process.env.SEED_ATLAS_COVERAGE ?? `${scenarios.length} representative surface states and critical journeys on desktop and mobile. Secondary provider/count/text combinations use pairwise coverage; this is not exhaustive coverage of every application state.`,
  summary: Object.fromEntries(
    ["passed", "failed", "missing"].map((status) => [
      status,
      records.filter((record) => record.status === status).length,
    ]),
  ),
  scenarios: records,
  mosaics: sheets,
};
await writeFile(
  path.join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const cards = records
  .map(
    (record) =>
      `<article data-device="${record.device}" data-surface="${escape(record.surface)}" data-status="${record.status}"><div><b>${record.id} · ${escape(record.title)}</b><span>${record.device} · ${escape(record.surface)} · assertions ${record.status}</span>${record.captures?.length ? `<nav>${record.captures.map(capture => `<a href="${encodeURI(capture.file)}">${escape(capture.position)}</a>`).join('')}</nav>` : ''}</div>${record.file ? `<a href="${encodeURI(record.file)}"><img loading="lazy" src="${encodeURI(record.file)}" alt="${escape(record.id + " " + record.device + " " + record.title)}"></a>` : "<p>Capture missing. This state has not been verified.</p>"}</article>`,
  )
  .join("");
await writeFile(
  path.join(root, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seed visual review atlas</title><style>body{margin:0;background:#141914;color:#e6edde;font:14px Segoe UI,Arial}header{padding:30px;max-width:1100px;margin:auto}h1{font-size:30px;letter-spacing:-.7px}p{line-height:1.7;color:#aabd9a}a{color:#d3eab1}nav,form{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}select{background:#28331f;color:#e0eccf;padding:10px;border:1px solid #65774e;border-radius:8px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:20px;padding:20px 30px}article{border:1px solid #425436;border-radius:12px;background:#1e2819;overflow:hidden}article[hidden]{display:none}article>div{padding:16px;line-height:1.6}article span{display:block;font-size:12px;color:#a7be92}article img{display:block;width:100%;height:430px;object-fit:contain;object-position:top;background:#10140e}article[data-status=failed],article[data-status=missing]{border-color:#b57449}article>p{padding:20px}nav a{font-size:12px;padding:8px;border:1px solid #485d35;border-radius:6px}</style></head><body><header><h1>Seed · visual review atlas</h1><p>Revision ${escape(revision)}. ${manifest.summary.passed} passed · ${manifest.summary.failed} failed · ${manifest.summary.missing} missing. Reference a screen by number and device, for example “025 mobile”. Click any capture to inspect it at full resolution.</p><p>${escape(manifest.coverage)}</p><details><summary>Numbered contact sheets</summary><nav>${sheets.map((sheet) => `<a href="${sheet.file}">${sheet.device} ${sheet.from}–${sheet.to}</a>`).join("")}</nav></details><form><select name="device"><option value="">All devices</option><option>desktop</option><option>mobile</option></select><select name="surface"><option value="">All surfaces</option>${[...new Set(scenarios.map((record) => record.surface))].map((surface) => `<option>${escape(surface)}</option>`).join("")}</select><select name="status"><option value="">All statuses</option><option>passed</option><option>failed</option><option>missing</option></select></form></header><main>${cards}</main><script>const form=document.querySelector('form');form.addEventListener('change',()=>{for(const card of document.querySelectorAll('article'))card.hidden=[...new FormData(form)].some(([key,value])=>value&&card.dataset[key]!==value);});form.addEventListener('submit',event=>event.preventDefault());</script></body></html>`,
);
console.log(
  `Visual atlas: ${root} (${manifest.summary.passed} passed, ${manifest.summary.failed} failed, ${manifest.summary.missing} missing)`,
);
