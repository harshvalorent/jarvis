// ─── Client-safe attachment specs (pure data — importable from anywhere) ─────
// NOTE: this module must NEVER import node built-ins or z-ai-web-dev-sdk so
// client components can share the exact same accept-list and limits as the
// server.

export type UploadKind = "image" | "document" | "audio";

export interface DocSpec {
  ext: string;
  mime: string;
  label: string;
}

/** Image formats the vision subsystem accepts. */
export const IMAGE_SPECS: DocSpec[] = [
  { ext: "png", mime: "image/png", label: "PNG" },
  { ext: "jpg", mime: "image/jpeg", label: "JPEG" },
  { ext: "webp", mime: "image/webp", label: "WebP" },
  { ext: "gif", mime: "image/gif", label: "GIF" },
];

/** Document formats the core can read (extraction → ground-truth context). */
export const DOC_SPECS: DocSpec[] = [
  { ext: "pdf", mime: "application/pdf", label: "PDF" },
  { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word" },
  { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint" },
  { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel" },
  { ext: "odt", mime: "application/vnd.oasis.opendocument.text", label: "OpenDocument" },
  { ext: "ods", mime: "application/vnd.oasis.opendocument.spreadsheet", label: "OpenSheet" },
  { ext: "rtf", mime: "application/rtf", label: "Rich Text" },
  { ext: "epub", mime: "application/epub+zip", label: "EPUB" },
  { ext: "csv", mime: "text/csv", label: "CSV" },
  { ext: "tsv", mime: "text/tab-separated-values", label: "TSV" },
  { ext: "txt", mime: "text/plain", label: "Text" },
  { ext: "md", mime: "text/markdown", label: "Markdown" },
  { ext: "json", mime: "application/json", label: "JSON" },
  { ext: "xml", mime: "application/xml", label: "XML" },
  { ext: "yml", mime: "text/yaml", label: "YAML" },
  { ext: "yaml", mime: "text/yaml", label: "YAML" },
  { ext: "html", mime: "text/html", label: "HTML" },
  { ext: "htm", mime: "text/html", label: "HTML" },
  { ext: "log", mime: "text/plain", label: "Log" },
  { ext: "ini", mime: "text/plain", label: "Config" },
  { ext: "toml", mime: "text/plain", label: "Config" },
  { ext: "env", mime: "text/plain", label: "Config" },
  { ext: "sql", mime: "text/plain", label: "SQL" },
  { ext: "sh", mime: "text/x-shellscript", label: "Shell" },
  // source code
  { ext: "js", mime: "text/javascript", label: "JavaScript" },
  { ext: "jsx", mime: "text/javascript", label: "JSX" },
  { ext: "ts", mime: "text/typescript", label: "TypeScript" },
  { ext: "tsx", mime: "text/typescript", label: "TSX" },
  { ext: "py", mime: "text/x-python", label: "Python" },
  { ext: "java", mime: "text/x-java-source", label: "Java" },
  { ext: "c", mime: "text/x-c", label: "C" },
  { ext: "h", mime: "text/x-c", label: "C header" },
  { ext: "cpp", mime: "text/x-c++", label: "C++" },
  { ext: "cs", mime: "text/x-csharp", label: "C#" },
  { ext: "go", mime: "text/x-go", label: "Go" },
  { ext: "rs", mime: "text/x-rust", label: "Rust" },
  { ext: "rb", mime: "text/x-ruby", label: "Ruby" },
  { ext: "php", mime: "text/x-php", label: "PHP" },
  { ext: "css", mime: "text/css", label: "CSS" },
];

/** Audio formats the core can transcribe via ASR. */
export const AUDIO_SPECS: DocSpec[] = [
  { ext: "mp3", mime: "audio/mpeg", label: "MP3" },
  { ext: "wav", mime: "audio/wav", label: "WAV" },
  { ext: "m4a", mime: "audio/mp4", label: "M4A" },
  { ext: "flac", mime: "audio/flac", label: "FLAC" },
  { ext: "ogg", mime: "audio/ogg", label: "OGG" },
  { ext: "oga", mime: "audio/ogg", label: "OGG" },
  { ext: "aac", mime: "audio/aac", label: "AAC" },
  { ext: "webm", mime: "audio/webm", label: "WebM" },
  { ext: "opus", mime: "audio/ogg", label: "Opus" },
];

export const DOC_MIME_TO_EXT: Record<string, string> = Object.fromEntries(
  DOC_SPECS.map((d) => [d.mime, d.ext])
);
export const AUDIO_MIME_TO_EXT: Record<string, string> = Object.fromEntries(
  AUDIO_SPECS.map((d) => [d.mime, d.ext])
);
export const DOC_EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  DOC_SPECS.map((d) => [d.ext, d.mime])
);
export const AUDIO_EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  AUDIO_SPECS.map((d) => [d.ext, d.mime])
);

/** Per-message attachment limits. */
export const MAX_UPLOAD_IMAGES = 4;
export const MAX_UPLOAD_DOCS = 4;
export const MAX_UPLOAD_AUDIO = 2;
/** Max binary size per document / audio upload (20 MB). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function labelForExt(ext: string): string {
  return (
    DOC_SPECS.find((d) => d.ext === ext)?.label ??
    AUDIO_SPECS.find((d) => d.ext === ext)?.label ??
    ext.toUpperCase()
  );
}

/** accept= string for the composer's + button (images + docs + audio). */
export const ATTACH_ACCEPT = [
  ...IMAGE_SPECS.map((d) => d.mime),
  ...DOC_SPECS.map((d) => `.${d.ext}`),
  ...AUDIO_SPECS.map((d) => `.${d.ext}`),
].join(",");
