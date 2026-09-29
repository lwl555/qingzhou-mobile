# 轻舟手机版

手机上的轻舟。三种连接自动切换：

1. **局域网**：手机和电脑同一 Wi-Fi → 直连电脑，用电脑上的模型、文件、工具
2. **远程**：电脑端开启「远程操作」后 → 在外面也能操作那台电脑（走云端中继）
3. **云端**：都连不上 → 用云端模型聊天，保证出门不失联

## 目录

- `mobile/` — 手机端网页本体（也部署到 GitHub Pages）
- `capacitor.config.json` — 安卓 App 壳配置
- `.github/workflows/deploy-pages.yml` — 自动部署网页到 GitHub Pages
- `.github/workflows/build-apk.yml` — 用 GitHub Actions 编译安卓 APK（无需本地装 Android Studio）

## 出包

推代码后：网页自动部署；到 Actions 里手动跑一次 `编译安卓 APK`，完成后下载产物里的 APK 装手机。
