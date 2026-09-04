import { env } from "cloudflare:workers";

type TaskRow = {
  id: number;
  article: string;
  campaign_id: string;
  task: string;
  solution: string;
  status: "open" | "done";
  activity_date: string;
  created_at: string;
  updated_at: string;
};

function database() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error("Хранилище задач пока не подключено");
  return binding;
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS campaign_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, article TEXT NOT NULL, campaign_id TEXT NOT NULL DEFAULT '', task TEXT NOT NULL, solution TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', activity_date TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_campaign_tasks_article_status ON campaign_tasks (article, status)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_campaign_tasks_article_date ON campaign_tasks (article, activity_date)",
    ),
  ]);
}

function present(row: TaskRow) {
  return {
    id: row.id,
    article: row.article,
    campaignId: row.campaign_id,
    task: row.task,
    solution: row.solution,
    status: row.status,
    activityDate: row.activity_date || row.created_at.slice(0, 10),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  try {
    const db = database();
    await ensureSchema(db);
    const result = await db
      .prepare("SELECT id, article, campaign_id, task, solution, status, activity_date, created_at, updated_at FROM campaign_tasks ORDER BY activity_date DESC, updated_at DESC LIMIT 250")
      .all<TaskRow>();
    return Response.json({ tasks: (result.results ?? []).map(present) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить задачи" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      article?: string;
      campaignId?: string;
      task?: string;
      solution?: string;
      activityDate?: string;
    };
    const article = payload.article?.trim() ?? "";
    const campaignId = payload.campaignId?.trim() ?? "";
    const task = payload.task?.trim() ?? "";
    const solution = payload.solution?.trim() ?? "";
    const activityDate = payload.activityDate ?? new Date().toISOString().slice(0, 10);
    if (!article || !task) return Response.json({ error: "Укажите артикул и задачу" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) return Response.json({ error: "Укажите корректную дату" }, { status: 400 });

    const db = database();
    await ensureSchema(db);
    const result = await db
      .prepare("INSERT INTO campaign_tasks (article, campaign_id, task, solution, activity_date) VALUES (?, ?, ?, ?, ?)")
      .bind(article, campaignId, task, solution, activityDate)
      .run();

    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось сохранить задачу" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as {
      id?: number;
      status?: "open" | "done";
      task?: string;
      solution?: string;
      activityDate?: string;
    };
    const task = payload.task?.trim();
    const solution = payload.solution?.trim();
    const activityDate = payload.activityDate;
    if (!payload.id || (!payload.status && task === undefined && solution === undefined && activityDate === undefined)) {
      return Response.json({ error: "Некорректное обновление" }, { status: 400 });
    }
    if (payload.status && !["open", "done"].includes(payload.status)) {
      return Response.json({ error: "Некорректный статус" }, { status: 400 });
    }
    if (task !== undefined && !task) return Response.json({ error: "Задача не может быть пустой" }, { status: 400 });
    if (activityDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) return Response.json({ error: "Укажите корректную дату" }, { status: 400 });

    const db = database();
    await ensureSchema(db);
    await db
      .prepare("UPDATE campaign_tasks SET status = COALESCE(?, status), task = COALESCE(?, task), solution = COALESCE(?, solution), activity_date = COALESCE(?, activity_date), campaign_id = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(payload.status ?? null, task ?? null, solution ?? null, activityDate ?? null, payload.id)
      .run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось обновить задачу" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Укажите запись для удаления" }, { status: 400 });
    const db = database();
    await ensureSchema(db);
    await db.prepare("DELETE FROM campaign_tasks WHERE id = ?").bind(id).run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось удалить запись" }, { status: 500 });
  }
}

