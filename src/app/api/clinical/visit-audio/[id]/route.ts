import { apiRequireWorkspace } from "@/core/auth/user";
import { getVisitAudio } from "@/core/clinical/scribe";
import { readFileByKey } from "@/core/integrations/storage";
import { logView } from "@/core/audit/log";
import { report } from "@/core/observability";

const AUDIO_TYPES: Record<string, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
};

/**
 * GET /api/clinical/visit-audio/[id] — plays back the recording a scribe note was
 * written from (owner's call, 2026-10-20), so a doctor can listen when the text looks
 * wrong. Auth + clinic-scoped + `clinical:view`, and only a recording the viewer may
 * READ the note of (core/clinical/scribe.ts#getVisitAudio). `no-store`: a patient's
 * voice is never cached.
 *
 * Honours `Range`, because that is how a browser's player seeks — without it the
 * scrubber cannot jump, and some browsers will not play at all. Listening is logged
 * like opening a record (§10: every look at patient data leaves a trace).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiRequireWorkspace("clinical", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const row = await getVisitAudio(auth.clinicId, id, auth.user.id);
  if (!row) return new Response("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await readFileByKey(row.audioKey);
  } catch (e) {
    // The visit says a recording exists and the bytes are gone: the DB and the file
    // store disagree, which is how data loss looks. Warn, and answer like a 404.
    report(e, { op: "storage.serveVisitAudio", severity: "warn", clinicId: auth.clinicId, ids: { visitId: id } });
    return new Response("Not found", { status: 404 });
  }

  const ext = row.audioKey.split(".").pop()?.toLowerCase() ?? "";
  const type = AUDIO_TYPES[ext] ?? "application/octet-stream";
  const size = data.length;
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (!range || (range[1] === "" && range[2] === "")) {
    void logView("visit", id, "Listened to a dictation");
    return new Response(new Uint8Array(data), { status: 200, headers: { ...base, "Content-Length": String(size) } });
  }
  // `bytes=-500` is the LAST 500 bytes; `bytes=100-` is from 100 to the end.
  const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  // One log per listen, not per chunk the player fetches.
  if (start === 0) void logView("visit", id, "Listened to a dictation");
  return new Response(new Uint8Array(data.subarray(start, end + 1)), {
    status: 206,
    headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
