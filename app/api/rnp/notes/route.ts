import { env } from "cloudflare:workers";

type NoteRow = {
  article: string;
  note_date: string;
  note: string;
};

function database() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error("Хранилище заметок пока не подключено");
  return binding;
}

function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS article_daily_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, article TEXT NOT NULL, note_date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(article, note_date))"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_article_daily_notes_date ON article_daily_notes (note_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_article_daily_notes_article_date ON article_daily_notes (article, note_date)"),
  ]);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) {
      return Response.json({ error: "Укажите корректный период" }, { status: 400 });
    }
    const db = database();
    await ensureSchema(db);
    const result = await db.prepare("SELECT article, note_date, note FROM article_daily_notes WHERE note_date BETWEEN ? AND ? ORDER BY note_date, article")
      .bind(dateFrom, dateTo)
      .all<NoteRow>();
    return Response.json({ notes: (result.results ?? []).map((row) => ({ article: row.article, noteDate: row.note_date, note: row.note })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить заметки" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json() as { article?: string; noteDate?: string; note?: string };
    const article = payload.article?.trim() ?? "";
    const noteDate = payload.noteDate ?? "";
    const note = payload.note?.trim() ?? "";
    if (!article || !validDate(noteDate)) return Response.json({ error: "Укажите артикул и дату" }, { status: 400 });
    if (note.length > 2_000) return Response.json({ error: "Заметка не должна превышать 2000 символов" }, { status: 400 });
    const db = database();
    await ensureSchema(db);
    if (!note) {
      await db.prepare("DELETE FROM article_daily_notes WHERE article = ? AND note_date = ?").bind(article, noteDate).run();
    } else {
      await db.prepare("INSERT INTO article_daily_notes (article, note_date, note, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(article, note_date) DO UPDATE SET note = excluded.note, updated_at = CURRENT_TIMESTAMP")
        .bind(article, noteDate, note)
        .run();
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось сохранить заметку" }, { status: 500 });
  }
}

