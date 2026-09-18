// 新手教程（闯关式互动教学）
import { useEffect, useState } from "react";
import { Board } from "../components/Board";
import { Icon } from "../components/ui";
import { content, type Chapter, type TaskStep } from "../content";
import { makeBoard, handleTaskClick, sideOf } from "../goal";
import { TsEngine } from "../engine";
import { useStore } from "../store";
import { playError, playSuccess, playStone, playCapture } from "../sound";

export function TutorialView() {
  const { profile, markTutorialDone } = useStore();
  const [chapterIdx, setChapterIdx] = useState(() => {
    const done = profile?.tutorial_done ?? [];
    const idx = content.tutorials.findIndex((c) => !done.includes(c.id));
    return idx === -1 ? 0 : idx;
  });
  const [stepIdx, setStepIdx] = useState(0);
  const [taskDone, setTaskDone] = useState(false);

  const chapter: Chapter = content.tutorials[chapterIdx];
  const step = chapter.steps[stepIdx];
  const isLastChapter = chapterIdx === content.tutorials.length - 1;
  const isLastStep = stepIdx === chapter.steps.length - 1;
  const chapterDone = profile?.tutorial_done.includes(chapter.id) ?? false;

  useEffect(() => {
    setStepIdx(0);
    setTaskDone(false);
  }, [chapterIdx]);

  const nextStep = () => {
    if (isLastStep) void markTutorialDone(chapter.id);
    if (!isLastStep) {
      setStepIdx(stepIdx + 1);
      setTaskDone(false);
    } else if (!isLastChapter) {
      setChapterIdx(chapterIdx + 1);
    }
  };

  const prevStep = () => {
    setTaskDone(false);
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
    else if (chapterIdx > 0) setChapterIdx(chapterIdx - 1);
  };

  return (
    <div className="tutorial">
      <aside className="tutorial-list">
        <h2><Icon name="book" size={20} /> 新手教程</h2>
        {content.tutorials.map((c, i) => (
          <button key={c.id} className={`chapter-item${i === chapterIdx ? " on" : ""}`} onClick={() => setChapterIdx(i)}>
            <span className={`chapter-check${(profile?.tutorial_done.includes(c.id)) ? " ok" : ""}`}>
              {profile?.tutorial_done.includes(c.id) ? <Icon name="check" size={13} /> : i + 1}
            </span>
            <span>
              <b>{c.title}</b>
              <small>{c.desc}</small>
            </span>
          </button>
        ))}
      </aside>

      <section className="tutorial-main card">
        <div className="tutorial-progress">
          <span>{chapter.title}</span>
          <span className="muted">
            {stepIdx + 1} / {chapter.steps.length}
            {chapterDone ? " · 本章已完成 ✓" : ""}
          </span>
        </div>

        {step.type === "text" ? (
          <div className="text-step">
            <h3>{step.title}</h3>
            {step.body.split("\n\n").map((p, i) => (
              <p key={i} className="text-body">{p}</p>
            ))}
          </div>
        ) : (
          <TaskStepView
            key={`${chapterIdx}-${stepIdx}`}
            step={step}
            onDone={() => setTaskDone(true)}
          />
        )}

        <div className="tutorial-nav">
          <button className="btn" onClick={prevStep} disabled={chapterIdx === 0 && stepIdx === 0}>
            <Icon name="chevronLeft" size={16} /> 上一步
          </button>
          <button className="btn primary" onClick={nextStep} disabled={step.type === "task" && !taskDone}>
            {isLastStep ? (isLastChapter ? "完成教程 🎉" : "下一章") : "下一步"} <Icon name="chevronRight" size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}

function TaskStepView({ step, onDone }: { step: TaskStep; onDone: () => void }) {
  const { profile } = useStore();
  const size = step.size ?? 9;
  const [engine, setEngine] = useState<TsEngine>(() => makeBoard(size, step.stones ?? { black: [], white: [] }, step.toMove ?? "b"));
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const side = sideOf(step.toMove ?? "b");

  const onClick = (pos: number) => {
    if (done) return;
    const res = handleTaskClick(engine, step, progress, pos);
    if (res.applied) {
      if (profile?.settings.sound) {
        if (res.captured > 0) playCapture();
        else playStone();
      }
      setProgress((p) => p + 1);
      setEngine(engine.shallowCopy());
      setFeedback(null);
      if (res.done) {
        setDone(true);
        setFeedback(step.success);
        if (profile?.settings.sound) playSuccess();
        onDone();
      }
    } else {
      if (profile?.settings.sound) playError();
      setFeedback(res.message ?? "再想想。");
    }
  };

  const resetStep = () => {
    setEngine(makeBoard(size, step.stones ?? { black: [], white: [] }, step.toMove ?? "b"));
    setProgress(0);
    setDone(false);
    setFeedback(null);
  };

  return (
    <div className="task-step">
      <div className="task-info">
        <h3>{step.title}</h3>
        {step.body.split("\n\n").map((p, i) => (
          <p key={i} className="text-body">{p}</p>
        ))}
        <div className={`task-msg${done ? " ok" : feedback ? " err" : ""}`}>
          {done ? `✔ ${step.success}` : feedback ?? "轮到你落子（执" + (side === 1 ? "黑" : "白") + "）"}
        </div>
        {done ? (
          <div className="badge badge-green">任务完成</div>
        ) : (
          <button className="btn ghost small" onClick={resetStep}>
            <Icon name="undo" size={14} /> 重新开始本步
          </button>
        )}
      </div>
      <div className="task-board">
        <Board size={size} board={engine.board} showCoords={false} interactive={!done} playSide={side} onPosClick={onClick} compact />
      </div>
    </div>
  );
}
