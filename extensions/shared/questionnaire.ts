/**
 * questionnaire — a Claude-Code-style AskUserQuestion modal: one tab per question
 * with an answered indicator, an arrow-key option list (label + description), a
 * "Type something." escape, and a Submit tab that refuses until every question has
 * an answer.
 *
 * It is shared because more than one extension needs the same interaction; Pi's own
 * `questionnaire.ts` example is the reference for the layout and key contract. The
 * component is transient: it takes over the interactive area, resolves with the
 * chosen answers, and disposes. Pure helpers stay separate so they can be tested
 * without a terminal.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export interface QuestionnaireOption {
  label: string;
  description?: string;
}

export interface QuestionnaireQuestion {
  id: string;
  /** Short tab label, e.g. "Scope". */
  label: string;
  prompt: string;
  options: QuestionnaireOption[];
  /** Include the "Type something." escape. Defaults to true. */
  allowOther?: boolean;
}

export interface QuestionnaireAnswer {
  id: string;
  value: string;
  label: string;
  wasCustom: boolean;
  /** 1-based option index when the answer came from the list. */
  index?: number;
}

type RenderOption = QuestionnaireOption & { isOther?: boolean };

/**
 * Present `questions` and resolve with the answers, or `undefined` when the human
 * cancels. Returns `undefined` outside TUI mode rather than throwing.
 */
export async function runQuestionnaire(
  ctx: ExtensionContext,
  questions: QuestionnaireQuestion[],
): Promise<QuestionnaireAnswer[] | undefined> {
  if (ctx.mode !== "tui" || questions.length === 0) return undefined;

  const normalized: QuestionnaireQuestion[] = questions.map((question, index) => ({
    ...question,
    label: question.label.trim() || `Q${index + 1}`,
    allowOther: question.allowOther !== false,
  }));
  const isMulti = normalized.length > 1;
  const totalTabs = normalized.length + 1;

  return ctx.ui.custom<QuestionnaireAnswer[] | undefined>((tui, theme, _keybindings, done) => {
    let tab = 0;
    let optionIndex = 0;
    let inputMode = false;
    let inputQuestionId: string | null = null;
    let cached: string[] | undefined;
    const answers = new Map<string, QuestionnaireAnswer>();

    const editorTheme: EditorTheme = {
      borderColor: (s) => theme.fg("accent", s),
      selectList: {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        scrollInfo: (t) => theme.fg("dim", t),
        noMatch: (t) => theme.fg("warning", t),
      },
    };
    const editor = new Editor(tui, editorTheme);

    const refresh = (): void => {
      cached = undefined;
      tui.requestRender();
    };
    const finish = (): void => done(answers.size > 0 ? Array.from(answers.values()) : undefined);
    const currentQuestion = (): QuestionnaireQuestion | undefined => normalized[tab];
    const currentOptions = (): RenderOption[] => {
      const question = currentQuestion();
      if (!question) return [];
      const options: RenderOption[] = [...question.options];
      if (question.allowOther) options.push({ label: "Type something.", isOther: true });
      return options;
    };
    const allAnswered = (): boolean => normalized.every((question) => answers.has(question.id));

    const advance = (): void => {
      if (!isMulti) {
        finish();
        return;
      }
      tab = tab < normalized.length - 1 ? tab + 1 : normalized.length;
      optionIndex = 0;
      refresh();
    };
    const save = (questionId: string, value: string, label: string, wasCustom: boolean, index?: number): void => {
      answers.set(questionId, { id: questionId, value, label, wasCustom, ...(index === undefined ? {} : { index }) });
    };

    editor.onSubmit = (value) => {
      if (!inputQuestionId) return;
      const answer = value.trim() || "(no response)";
      save(inputQuestionId, answer, answer, true);
      inputMode = false;
      inputQuestionId = null;
      editor.setText("");
      advance();
    };

    const handleInput = (data: string): void => {
      if (inputMode) {
        if (matchesKey(data, Key.escape)) {
          inputMode = false;
          inputQuestionId = null;
          editor.setText("");
          refresh();
          return;
        }
        editor.handleInput(data);
        refresh();
        return;
      }

      const question = currentQuestion();
      const options = currentOptions();

      if (isMulti) {
        if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
          tab = (tab + 1) % totalTabs;
          optionIndex = 0;
          refresh();
          return;
        }
        if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
          tab = (tab - 1 + totalTabs) % totalTabs;
          optionIndex = 0;
          refresh();
          return;
        }
      }

      if (tab === normalized.length) {
        if (matchesKey(data, Key.enter) && allAnswered()) finish();
        else if (matchesKey(data, Key.escape)) done(undefined);
        return;
      }

      if (matchesKey(data, Key.up)) {
        optionIndex = Math.max(0, optionIndex - 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.down)) {
        optionIndex = Math.min(options.length - 1, optionIndex + 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.enter) && question) {
        const option = options[optionIndex];
        if (!option) return;
        if (option.isOther) {
          inputMode = true;
          inputQuestionId = question.id;
          editor.setText("");
          refresh();
          return;
        }
        save(question.id, option.label, option.label, false, optionIndex + 1);
        advance();
        return;
      }
      if (matchesKey(data, Key.escape)) done(undefined);
    };

    const render = (width: number): string[] => {
      if (cached) return cached;
      const lines: string[] = [];
      const renderWidth = Math.max(1, width);
      const question = currentQuestion();
      const options = currentOptions();

      const wrapped = (text: string): void => {
        lines.push(...wrapTextWithAnsi(text, renderWidth));
      };
      const wrappedPrefixed = (prefix: string, text: string): void => {
        const prefixWidth = visibleWidth(prefix);
        if (prefixWidth >= renderWidth) {
          wrapped(prefix + text);
          return;
        }
        const body = wrapTextWithAnsi(text, renderWidth - prefixWidth);
        const continuation = " ".repeat(prefixWidth);
        body.forEach((line, index) => lines.push(`${index === 0 ? prefix : continuation}${line}`));
      };

      lines.push(theme.fg("accent", "─".repeat(renderWidth)));

      if (isMulti) {
        const tabs: string[] = ["← "];
        normalized.forEach((item, index) => {
          const active = index === tab;
          const answered = answers.has(item.id);
          const text = ` ${answered ? "■" : "□"} ${item.label} `;
          tabs.push(`${active ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg(answered ? "success" : "muted", text)} `);
        });
        const submitTab = tab === normalized.length;
        const submitText = " ✓ Submit ";
        tabs.push(`${submitTab ? theme.bg("selectedBg", theme.fg("text", submitText)) : theme.fg(allAnswered() ? "success" : "dim", submitText)} →`);
        wrappedPrefixed(" ", tabs.join(""));
        lines.push("");
      }

      const renderOptions = (): void => {
        options.forEach((option, index) => {
          const selected = index === optionIndex;
          const prefix = selected ? theme.fg("accent", "> ") : "  ";
          const marked = option.isOther && inputMode ? " ✎" : "";
          wrappedPrefixed(prefix, theme.fg(selected || (option.isOther && inputMode) ? "accent" : "text", `${index + 1}. ${option.label}${marked}`));
          if (option.description) wrappedPrefixed("     ", theme.fg("muted", option.description));
        });
      };

      if (inputMode && question) {
        wrappedPrefixed(" ", theme.fg("text", question.prompt));
        lines.push("");
        renderOptions();
        lines.push("");
        wrappedPrefixed(" ", theme.fg("muted", "Your answer:"));
        for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${line}`);
        lines.push("");
        wrappedPrefixed(" ", theme.fg("dim", "Enter to submit • Esc to cancel"));
      } else if (tab === normalized.length) {
        wrappedPrefixed(" ", theme.fg("accent", theme.bold("Ready to submit")));
        lines.push("");
        for (const item of normalized) {
          const answer = answers.get(item.id);
          if (!answer) continue;
          const prefix = answer.wasCustom ? "(wrote) " : "";
          wrappedPrefixed(" ", `${theme.fg("muted", `${item.label}: `)}${theme.fg("text", prefix + answer.label)}`);
        }
        lines.push("");
        if (allAnswered()) wrappedPrefixed(" ", theme.fg("success", "Press Enter to submit"));
        else wrappedPrefixed(" ", theme.fg("warning", `Unanswered: ${normalized.filter((item) => !answers.has(item.id)).map((item) => item.label).join(", ")}`));
      } else if (question) {
        wrappedPrefixed(" ", theme.fg("text", question.prompt));
        lines.push("");
        renderOptions();
      }

      lines.push("");
      if (!inputMode) {
        wrappedPrefixed(" ", theme.fg("dim", isMulti ? "Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel" : "↑↓ navigate • Enter select • Esc cancel"));
      }
      lines.push(theme.fg("accent", "─".repeat(renderWidth)));

      cached = lines;
      return lines;
    };

    return {
      render,
      invalidate: () => {
        cached = undefined;
      },
      handleInput,
    };
  });
}
