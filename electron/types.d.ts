// Module declarations for third-party libraries without proper type exports

/**
 * pdf-parse v1.1.1 — direct import of lib/pdf-parse.js to avoid the
 * `!module.parent` check in index.js which triggers test code in ESM context.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  import type pdfParse from 'pdf-parse'
  const fn: typeof pdfParse
  export default fn
}
