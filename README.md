# PartyPaste

PartyPaste 是 Windows 專用的本機片語管理與置頂工具。可以整理遊戲、群組、片語與常用變數，從置頂小窗快速複製文字，再貼到遊戲對話窗。

目前版本為 `0.1.1` 自用測試版。預設使用繁體中文，也可以在設定中切換英文並保留語言選擇。

## 分支與已安裝程式

Git 分支決定的是「從哪一版原始碼建置」，不會即時改變已經安裝在 Windows 裡的 PartyPaste。

- 切換或合併分支，不會自動更新已安裝的 EXE。
- 必須重新執行新版本安裝檔，或啟動新建置的 Portable EXE，變更才會反映到應用程式。
- 目前完整自用版位於 `feat/partypaste-complete`；合併進 `main` 後，`main` 才會包含完整功能與 `0.1.1` 修正。

目前 `outputs/` 已被 `.gitignore` 排除。推送 `main` 只會上傳原始碼，不會自動上傳安裝檔或 Portable ZIP。

## 將完整版本合併到 main

先確認兩個工作目錄都沒有未提交變更，再從主要專案目錄執行：

```powershell
cd C:\xampp\htdocs\PartyPaste
git status
git pull --ff-only origin main
git merge --ff-only feat/partypaste-complete
git push origin main
```

完成後可用以下指令確認：

```powershell
git log -1 --oneline
git status
```

預期 `main` 最新紀錄至少包含：

```text
c6f512b fix: support first-run game creation
```

如果 `--ff-only` 拒絕合併，請先停止，不要使用 `reset --hard`；先檢查 `git status` 與分支歷史。

## Windows 安裝

### 安裝版

目前本機產物：

```text
outputs/windows-self-use/PartyPaste_0.1.1_windows-x64-setup-unsigned-local.exe
```

1. 從 PartyPaste 系統匣選單完全退出舊版本。
2. 執行 `PartyPaste_0.1.1_windows-x64-setup-unsigned-local.exe`。
3. 目前是未簽章自用版。若 Windows SmartScreen 顯示警告，先核對 SHA-256，確認是自己的建置後，再選擇「其他資訊」與「仍要執行」。
4. 安裝完成後，從開始功能表啟動 PartyPaste。

安裝版會使用 Windows 應用程式資料目錄保存資料；安裝新版時不應刪除既有片語。重要資料仍建議先從設定頁匯出備份。

### Portable 免安裝版

目前本機產物：

```text
outputs/windows-self-use/PartyPaste_0.1.1_windows-x64-portable-unsigned-local.zip
```

1. 將 ZIP 完整解壓縮到可寫入的資料夾。
2. 執行其中的 `PartyPaste.exe`。
3. 不要刪除 `partypaste.portable`。
4. 資料會保存在解壓目錄的 `data/`，搬移電腦時請一起複製整個資料夾。

請勿直接在 ZIP 壓縮檔內執行 EXE。

## 在另一台電腦取得安裝檔

### 方法 A：GitHub prerelease 附件（最方便）

只有推送原始碼還不夠。若希望在家中直接從 GitHub 下載 EXE，可以在確認要發布自用測試檔後，手動建立 prerelease，並附加以下三個檔案：

```text
PartyPaste_0.1.1_windows-x64-setup-unsigned-local.exe
PartyPaste_0.1.1_windows-x64-portable-unsigned-local.zip
SHA256SUMS.txt
```

若已安裝並登入 GitHub CLI，可在專案根目錄執行：

```powershell
gh release create v0.1.1 `
  outputs/windows-self-use/PartyPaste_0.1.1_windows-x64-setup-unsigned-local.exe `
  outputs/windows-self-use/PartyPaste_0.1.1_windows-x64-portable-unsigned-local.zip `
  outputs/windows-self-use/SHA256SUMS.txt `
  --title "PartyPaste v0.1.1 自用測試版" `
  --notes "未簽章的 Windows 自用測試版；下載後請先核對 SHA-256。" `
  --prerelease
```

這是外部發布動作，執行前請確認 GitHub repository 的公開／私人狀態。完成後，在家中開啟該 repository 的 Releases 頁面，下載 `setup-unsigned-local.exe`，核對雜湊後執行。

### 方法 B：私人雲端或 USB

若暫時不使用 GitHub Release，可以把上述安裝檔與 `SHA256SUMS.txt` 一起放到自己的私人雲端空間或 USB。在家下載後核對雜湊，再執行安裝檔。

### 方法 C：在家從原始碼建置

這個方法只需要推送 `main`，但家中電腦必須先安裝 Git、相容版本的 Node.js、Rust，以及 Windows C++ build tools/WebView2 環境。

```powershell
git clone https://github.com/nsngary/PartyPaste.git
cd PartyPaste
npm ci
npm run verify
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
npm run tauri -- build
```

建置完成後，原始 NSIS 安裝檔位於：

```text
src-tauri/target/release/bundle/nsis/PartyPaste_0.1.1_x64-setup.exe
```

若要產生帶有明確 `unsigned-local` 標示、Portable ZIP 與校驗檔的完整自用產物，再執行：

```powershell
.\scripts\package-portable.ps1
.\scripts\hashes.ps1
.\scripts\verify-artifacts.ps1
```

產物會寫入 `outputs/windows-self-use/`。

## 目前 0.1.1 SHA-256

```text
7935c614ac22b0bfc686c7d0bd2b7cd884d9baa9ae5677bc41376ed6769dd9f4  PartyPaste_0.1.1_windows-x64-setup-unsigned-local.exe
dc9703adc3aa85dd9b8a194d0c4eff64e6ab12498c7a00d3d81262b1152130f8  PartyPaste_0.1.1_windows-x64-portable-unsigned-local.zip
```

可在 PowerShell 重新核對：

```powershell
Get-FileHash -Algorithm SHA256 .\PartyPaste_0.1.1_windows-x64-setup-unsigned-local.exe
```

## 基本使用流程

1. 在內容管理中新增遊戲。
2. 選取遊戲後新增群組與片語。
3. 在設定中配置不衝突的全域快捷鍵。
4. 遊玩時保留 Overlay 置頂小窗，點擊片語即可複製。
5. 切回遊戲對話框，使用遊戲接受的貼上快捷鍵貼入文字。
6. 定期從設定頁匯出 JSON 備份。

部分獨佔全螢幕遊戲可能不允許一般置頂視窗顯示；建議改用無邊框視窗或視窗模式。

## 自用版範圍

目前沒有公開版程式簽章、自動更新、GitHub Release 自動化或 CI 發布流程。請將 `unsigned-local` 產物視為自己驗證與使用的測試版本。
