import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { quizAttempts } from "@/lib/db/schema";
import { getLesson } from "@/lib/content";

const bodySchema = z.object({
  quizId: z.string().min(1),
  textbookSlug: z.string().min(1),
  lessonSlug: z.string().min(1),
  answers: z.record(z.string(), z.unknown()),
  score: z.number().int().nonnegative(),
  totalQuestions: z.number().int().positive(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const data = parsed.data;

  if (!getLesson(data.textbookSlug, data.lessonSlug)) {
    return NextResponse.json({ error: "unknown_lesson" }, { status: 404 });
  }

  await db.insert(quizAttempts).values({
    userId: session.user.id,
    quizId: data.quizId,
    textbookSlug: data.textbookSlug,
    lessonSlug: data.lessonSlug,
    answers: data.answers,
    score: data.score,
    totalQuestions: data.totalQuestions,
    passed: data.score === data.totalQuestions,
  });

  return NextResponse.json({ ok: true });
}
