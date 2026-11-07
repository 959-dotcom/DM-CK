import path from "node:path";

const MAX_SLIP_BYTES = Number(process.env.MAX_SLIP_BYTES || 5 * 1024 * 1024);

const MIME_SNIFF: { mime: string; ext: string; magic: (buf: Buffer) => boolean }[] =
  [
    {
      mime: "image/jpeg",
      ext: ".jpg",
      magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    },
    {
      mime: "image/png",
      ext: ".png",
      magic: (b) =>
        b.length >= 8 &&
        b[0] === 0x89 &&
        b[1] === 0x50 &&
        b[2] === 0x4e &&
        b[3] === 0x47,
    },
    {
      mime: "image/webp",
      ext: ".webp",
      magic: (b) =>
        b.length >= 12 &&
        b.toString("ascii", 0, 4) === "RIFF" &&
        b.toString("ascii", 8, 12) === "WEBP",
    },
    {
      mime: "application/pdf",
      ext: ".pdf",
      magic: (b) => b.length >= 5 && b.toString("ascii", 0, 5) === "%PDF-",
    },
  ];

export type SlipValidation = {
  ok: true;
  mime: string;
  ext: string;
  safeFilename: string;
} | {
  ok: false;
  error: string;
};

/** Validate slip upload: size, magic bytes, and safe filename (no path traversal). */
export function validateSlipUpload(opts: {
  buffer: Buffer;
  originalName: string;
  declaredType?: string;
}): SlipValidation {
  if (opts.buffer.length === 0) {
    return { ok: false, error: "Empty file" };
  }
  if (opts.buffer.length > MAX_SLIP_BYTES) {
    return {
      ok: false,
      error: `File too large (max ${Math.floor(MAX_SLIP_BYTES / 1024 / 1024)}MB)`,
    };
  }

  const sniffed = MIME_SNIFF.find((m) => m.magic(opts.buffer));
  if (!sniffed) {
    return { ok: false, error: "Unsupported file type (JPEG/PNG/WebP/PDF only)" };
  }

  // Block path traversal / absolute paths in original name.
  const base = path.basename(opts.originalName || "slip");
  if (
    base.includes("..") ||
    base.includes("/") ||
    base.includes("\\") ||
    base === "" ||
    base === "." ||
    base === ".."
  ) {
    return { ok: false, error: "Invalid filename" };
  }

  const safeFilename = `${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}${sniffed.ext}`;
  return {
    ok: true,
    mime: sniffed.mime,
    ext: sniffed.ext,
    safeFilename,
  };
}

export function assertSafeUploadDir(uploadDir: string, filePath: string) {
  const resolvedDir = path.resolve(uploadDir);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedDir + path.sep)) {
    throw new Error("Path traversal blocked");
  }
}

export { MAX_SLIP_BYTES };
