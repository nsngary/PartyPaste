# PartyPaste 完整版續作交接

更新日期：2026-08-12（Asia/Taipei）

## 目前 Git 狀態

- Repo：`C:\Users\USER\Documents\Codex\2026-08-12\new-chat`
- Branch：`main`
- HEAD：`5e34154 MVP`
- `main...origin/main`，工作樹乾淨。
- 使用者已將功能分支合併至 main；續作應直接由目前 main 建立新分支／worktree，不要再次合併舊 worktree。

## 來源文件

- 已核准規格：`docs/superpowers/specs/2026-08-12-partypaste-design.md`
- 完整 16-task 計畫：`docs/superpowers/plans/2026-08-12-partypaste-implementation.md`
- 目前完成 Task 1–10；Task 11–16 尚待完成。
- 使用者最新優先級：先完成可長期自用的 Windows 完整版；品質、安全性與 UI 標準不降。公開發布專用的簽章、updater、GitHub Release/CI 可後補。

## 已完成

- Tauri 2 + React + TypeScript + SQLite 基礎、原生命令契約與安全錯誤格式。
- 遊戲／群組／句子 CRUD、搜尋、收藏、排序、移動、複製、10 秒 Undo。
- 模板 parser、遊戲範圍變數定義與使用者可編輯常用預設值。
- Unicode NFKC + full case-fold 唯一性與模板參照重建。
- 記憶體限定的最近複製紀錄（30 筆）與三次剪貼簿重試。
- 可自訂全域快捷鍵、衝突復原、資料變更後 registry rebuild。
- JSON 匯出／預覽／整庫替換、10 MiB 限流讀取、自動安全備份（保留 5 份）。
- zh-TW/en、Warm Adventure Terminal 設計 token、實際 Noto Sans TC／Press Start 2P／IBM Plex Mono 字型與 OFL notice。
- 可及性 primitive：Dialog、Drawer、Toast、SegmentedControl、Field；巢狀 modal inert/focus/Escape 已處理。
- 緊湊遊戲 Overlay：240/300/420px、標題／全文模式、遊戲與群組、收藏合成群組、模板 inline form、預設值、自訂值、預覽、重試、最近紀錄、快捷鍵直達模板。
- Overlay 最後修正 commit：`171c174 fix: harden overlay retries and shortcut flows`；已通過 102 個前端測試、完整 Rust 測試、Clippy、build、axe 與 diff check，但在使用者要求立即交付後未再跑一次獨立增量 reviewer。

## 現有預覽版與限制

- 已成功執行 `tauri build`，release executable 約 16.5 MB。
- 對話輸出副本：`outputs/PartyPaste-0.1.0-preview.exe`。
- 這只是技術預覽：Overlay 已完成，但 `src/app/manager-main.tsx` 仍只有 `PartyPaste Manager` 標題。
- 尚不能透過 Manager UI 新增／修改／排序／刪除遊戲、群組、句子或常用變數，因此目前不適合正式日用。
- Native always-on-top、tray、雙視窗關閉規則、螢幕位置恢復仍未完成。

## 下一步（自用完整版最短路徑）

1. **Task 11：Manager library and variable UI**
   - 這是最高優先，完成後才真正可日用。
   - 依計畫建立管理器：遊戲／群組／句子 CRUD、拖曳排序、搜尋、收藏、Undo、刪除影響確認。
   - 完整模板編輯、解析錯誤、變數改名影響預覽／確認、常用變數預設值 CRUD／排序。
   - 必須接現有真實 API，不要用 mock；保留已核准 UI 與 `uncodixfy` 規則。

2. **Task 12：Settings, tray, two-window lifecycle, monitor recovery**
   - Always-on-top overlay、可調快捷鍵、語言、備份／還原 UI。
   - tray 開啟 Manager／Overlay／退出；關閉 Manager 不退出、關閉 Overlay 隱藏。
   - single-instance、開機與匯入 rebuild、螢幕移除／DPI 後將視窗拉回可見區。

3. **Task 14：Windows acceptance harness**
   - 真實 WebView2／Windows 驗收：100/150/200% DPI、240/300/420 overlay、鍵盤、剪貼簿被占用、全域快捷鍵、雙螢幕復原。
   - 補一次 Task 10 最終 commit `171c174` 的獨立增量 code review。

4. **本機自用打包**
   - 產出可直接執行檔與至少一種 Windows installer；做乾淨安裝／升級／資料路徑 smoke test。
   - 暫不要求數位簽章、signed updater、GitHub release automation。

5. **公開發布（延後）**
   - Task 13 signed updater／installed+portable packaging。
   - Task 15 公開文件、LICENSE、SECURITY、CONTRIBUTING。
   - Task 16 GitHub CI／release workflow／beta candidate。

## 建議續作技能

- `superpowers:using-git-worktrees`：由 main 建立乾淨續作 worktree。
- `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`：續跑既有 Task 11–16；為節省 token，每 task 僅保留 TDD、完整 gates、一次獨立 review。
- `superpowers:test-driven-development`：所有功能修正先 RED 再 GREEN。
- `uncodixfy`：所有 Manager／Settings UI 必須使用，避免泛用 AI dashboard 美術。
- `web-design-guidelines`：Task 11/12 完成後做一次可及性與介面審查。
- `superpowers:verification-before-completion`：產出自用 installer 前跑完整驗證。

## 環境與常用命令

- 系統 Node 22.21.1 太舊；測試請使用 Node 24.15.0：
  - `npx --yes node@24.15.0 C:\Users\USER\node-v22.21.1-win-x64\node_modules\npm\bin\npm-cli.js run verify`
- Cargo：`C:\Users\USER\.cargo\bin\cargo.exe`（Rust 1.97.1）。新子代理常沒有 Cargo PATH，直接用絕對路徑。
- Dev：`npm run tauri -- dev`
- Release build：先把 Cargo 加入 PATH，再執行 `npm run tauri -- build`。
- 已知非阻塞訊息：MSVC release/test linker 會輸出建立 `.dll.lib/.exp` 的 informational `linker_messages`。

## 續作注意事項

- 先讀規格與 Task 11 brief，再動 UI；不要重新做已完成的資料層。
- SQL 只放在 `src-tauri/src/db/repository.rs`。
- 不得在錯誤或日誌中包含使用者句子、變數值或剪貼簿內容。
- 最近複製與模板臨時輸入只能存在記憶體，不得進 SQLite／備份。
- Overlay 點擊只複製，不模擬貼上、Enter 或遊戲輸入。
- 專屬全螢幕不保證置頂；目標為視窗化／無邊框視窗。
- UI 不使用玻璃、漸層、超大圓角、膠囊濫用或過度留白；Press Start 2P 只限品牌／短標籤。
