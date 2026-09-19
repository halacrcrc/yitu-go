// 个人档案：段位、战绩曲线、设置
import { useEffect, useState } from "react";
import { Icon } from "../components/ui";
import { RatingChart } from "../components/RatingChart";
import { rankProgress, APP_VERSION } from "../content";
import { useStore } from "../store";
import { IS_TAURI } from "../api";

export function ProfileView() {
  const { profile, saveProfile, showToast } = useStore();
  const [name, setName] = useState(profile?.name ?? "");

  useEffect(() => {
    if (profile) setName(profile.name);
  }, [profile?.name]);

  if (!profile) return <div className="profile" />;

  const rp = rankProgress(profile.rating);
  const total = profile.wins + profile.losses + profile.draws;
  const winRate = total ? Math.round((profile.wins / Math.max(1, profile.wins + profile.losses)) * 100) : 0;

  const updateSettings = (patch: Partial<typeof profile.settings>) => {
    void saveProfile({ ...profile, settings: { ...profile.settings, ...patch } });
  };

  const saveName = () => {
    const n = name.trim() || "棋手";
    void saveProfile({ ...profile, name: n });
    showToast("昵称已保存", "success");
  };

  return (
    <div className="profile">
      <div className="profile-grid">
        <section className="card rank-card">
          <div className="rank-label">当前段位</div>
          <div className="rank-value">{rp.rank}</div>
          <div className="rank-rating">等级分 {profile.rating}</div>
          <div className="rank-bar">
            <div style={{ width: `${rp.pct * 100}%` }} />
          </div>
          <div className="rank-next muted small">
            {rp.next ? `距离 ${rp.next} 还需 ${Math.max(0, (rp.nextAt ?? 0) - profile.rating)} 分` : "已达到最高段位！"}
          </div>
          <div className="rank-ladder">
            <span>30级</span>
            <span>1级</span>
            <span>业余段</span>
            <span>职业段</span>
          </div>
          <p className="muted small" style={{ marginTop: 14 }}>
            与 AI 的<b>计段位对局</b>获胜可提升等级分，失利会小幅下降；让子局与双人局不计入。
          </p>
        </section>

        <section className="card">
          <h3><Icon name="trophy" size={18} /> 战绩</h3>
          <div className="stats-row">
            <div className="stat"><b>{profile.wins}</b><span>胜</span></div>
            <div className="stat"><b>{profile.losses}</b><span>负</span></div>
            <div className="stat"><b>{profile.draws}</b><span>和</span></div>
            <div className="stat"><b>{winRate}%</b><span>胜率</span></div>
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>
            解开死活题 {profile.puzzles_solved.length} 道 · 完成教程 {profile.tutorial_done.length} 章
          </div>
        </section>

        <section className="card chart-card">
          <h3><Icon name="play" size={18} /> 战绩曲线</h3>
          <RatingChart history={profile.rating_history} />
        </section>

        <section className="card">
          <h3><Icon name="user" size={18} /> 个人信息</h3>
          <div className="row gap">
            <input className="input" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="棋手昵称" />
            <button className="btn" onClick={saveName}>保存</button>
          </div>
        </section>

        <section className="card">
          <h3><Icon name="settings" size={18} /> 对局设置</h3>
          <div className="setting-row">
            <span>音效</span>
            <Toggle on={profile.settings.sound} onChange={(v) => updateSettings({ sound: v })} />
          </div>
          <div className="setting-row">
            <span>显示坐标</span>
            <Toggle on={profile.settings.show_coords} onChange={(v) => updateSettings({ show_coords: v })} />
          </div>
          <div className="setting-row">
            <span>显示最后一手标记</span>
            <Toggle on={profile.settings.show_last_move} onChange={(v) => updateSettings({ show_last_move: v })} />
          </div>
          <div className="setting-row">
            <span>对局中显示领地（势力范围）</span>
            <Toggle on={profile.settings.show_territory} onChange={(v) => updateSettings({ show_territory: v })} />
          </div>
          <div className="setting-row">
            <span>落子二次确认（防误触）</span>
            <Toggle on={profile.settings.confirm_move} onChange={(v) => updateSettings({ confirm_move: v })} />
          </div>
          <div className="setting-row">
            <span>浅色主题</span>
            <Toggle
              on={profile.settings.theme === "light"}
              onChange={(v) => updateSettings({ theme: v ? "light" : "dark" })}
            />
          </div>
          <div className="setting-row">
            <span>外观预览</span>
            <div className="seg seg-small">
              <button className={profile.settings.theme === "dark" ? "on" : ""} onClick={() => updateSettings({ theme: "dark" })}>🌙 深色</button>
              <button className={profile.settings.theme === "light" ? "on" : ""} onClick={() => updateSettings({ theme: "light" })}>☀️ 浅色</button>
            </div>
          </div>
        </section>

        <section className="card about">
          <h3><Icon name="bulb" size={18} /> 关于</h3>
          <p className="small muted">
            弈途围棋 v{APP_VERSION} · Rust + Tauri 2 + React 构建{IS_TAURI ? "" : "（当前为浏览器演示模式）"}
            <br />
            数据保存在本机：{IS_TAURI ? "系统应用数据目录" : "浏览器 localStorage"}。
          </p>
        </section>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}
