import { persona, sceneById } from "./config.mjs";
import { askText, STUDENT_MODEL_ID } from "./claude.mjs";

function systemPrompt(scene) {
  const p = persona.profile;
  return [
    "You are role-playing as a Japanese student in an English conversation school (AEON).",
    "You are NOT an assistant. Never break character, never explain yourself, never use Japanese except where specified below.",
    "",
    `Your name: ${persona.name}.`,
    "Profile:",
    `- English level: ${p.englishLevel.value}`,
    `- Age / job: ${p.age.value}`,
    `- Why you study English: ${p.goal.value}`,
    `- Personality: ${p.personality.value}`,
    `- Thinking time: ${p.thinkingTime.value}`,
    `- Hobbies: ${p.hobby.value}`,
    `- Last lesson you mentioned: ${p.lastLesson.value}`,
    `- Today: ${p.condition.value}`,
    "",
    "How you speak:",
    ...persona.speechStyle.map((s) => `- ${s}`),
    "",
    `Scene you are in: ${scene.name}`,
    `Scene setup: ${scene.studentSetup}`,
    "",
    "Rules:",
    "- Reply with ONE short student utterance only. No stage directions, no quotation marks, no translation.",
    "- 1-3 sentences, each 5-10 words. Beginner grammar with natural mistakes.",
    "- Do not play the teacher's part. Do not ask the teacher to continue the lesson.",
    "- If the teacher gave you the answer instead of letting you think, just repeat their words flatly.",
    "- If the teacher ignored your feelings, become shorter and flatter.",
    "- If the teacher waited for you and asked a good question, open up a little more.",
  ].join("\n");
}

const MOCK_REPLIES = {
  lobby1: ["Ah... I am okay. Just... little tired.", "Work was very busy today.", "Yes... um, I sleep only five hour.", "Okay. I try my best today."],
  lobby2: ["Yes... I remember. Hmm.", "Ah! Yes, Osaka. Next month.", "My favorite singer... concert. I am very excited!", "I go with my friend. Two day."],
  lobby3: ["Not so good... sorry.", "Um... I have headache from morning.", "Thank you... you are kind.", "Yes. A little better now."],
  lobby4: ["I get concert ticket! Very difficult, but I win.", "Who is your favorite?", "Really? I like him too! Which song?", "Ah... I see. Hmm."],
  care1: ["...", "Umm... I think... maybe... because team is important?", "Ah, I don't know how to say...", "Yes... teamwork. It is... good for work."],
  care3: ["Hmm, I want to say... 気圧? What do you say in English?", "Ah... it is... sky? No... weather thing.", "When it change, my head is painful.", "Air... pressure! Yes. Thank you."],
};

/** 生徒役の1ターンを生成する。LLM が使えなければ台本（MOCK）にフォールバック。 */
export async function studentTurn({ sceneId, history, teacherText }) {
  const scene = sceneById(sceneId);
  const messages = [];
  for (const t of history) {
    messages.push({ role: t.role === "teacher" ? "user" : "assistant", content: t.text });
  }
  messages.push({ role: "user", content: teacherText });

  const started = Date.now();
  let text = null;
  try {
    text = await askText({ system: systemPrompt(scene), messages, maxTokens: 300, effort: "low", model: STUDENT_MODEL_ID });
  } catch (err) {
    console.error("[student] LLM 呼び出し失敗、MOCK にフォールバック:", err.message);
  }
  const apiLatencyMs = Date.now() - started;

  let mock = false;
  if (!text) {
    mock = true;
    const bank = MOCK_REPLIES[sceneId] || MOCK_REPLIES.lobby1;
    const n = history.filter((t) => t.role === "student").length;
    text = bank[Math.min(n, bank.length - 1)];
  }

  const [lo, hi] = persona.thinkingSecondsRange;
  const thinkingMs = Math.round((lo + Math.random() * (hi - lo)) * 1000);
  return { text, apiLatencyMs, thinkingMs, mock };
}
