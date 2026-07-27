import { csvLine } from "./csv";
import { BRAND_POWERED_BY } from "./brand";

/**
 * Stream a CSV to the client from an async row source — CORE. Because rows are
 * emitted in chunks as they arrive (never collected into one array or one big
 * string), server memory stays flat regardless of row count, so an export of a
 * million rows costs the same memory as one of a thousand. Writes a UTF-8 BOM (so
 * Excel reads it correctly), the header, each row, then the brand credit footer.
 *
 * The caller supplies `rows` as an async iterable that pages through the database
 * with a keyset cursor (see the `iterate…` helpers), so only one batch is ever in
 * memory at a time.
 */
export function streamCsvResponse(opts: {
  filename: string; // without the .csv extension
  headers: string[];
  rows: AsyncIterable<(string | number | null)[]>;
  footer?: string; // defaults to the brand credit
}): Response {
  const { filename, headers, rows } = opts;
  const footer = opts.footer ?? BRAND_POWERED_BY;
  const encoder = new TextEncoder();
  const FLUSH_AT = 64 * 1024; // flush the text buffer roughly every 64 KB

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let buf = "﻿" + csvLine(headers) + "\r\n";
        for await (const row of rows) {
          buf += csvLine(row) + "\r\n";
          if (buf.length >= FLUSH_AT) {
            controller.enqueue(encoder.encode(buf));
            buf = "";
          }
        }
        buf += `\r\n${footer}\r\n`;
        controller.enqueue(encoder.encode(buf));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
