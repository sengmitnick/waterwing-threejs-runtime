# 瀑翼水灵 · Three.js Runtime

一套可直接在浏览器运行的 Three.js 水元素角色动作与战斗特效预览工程。仓库保留了“瀑翼水灵”的正式 Blender 动作资产、统一水体材质、动作适配层，以及玩家/怪物水球和凝聚、溃散等可复用特效。

## 在线预览

GitHub Pages 部署完成后可直接打开仓库首页右侧的 `Deployments`，或访问：

`https://sengmitnick.github.io/waterwing-threejs-runtime/`

公开版默认使用程序生成的流动水景，不包含原项目的瀑布视频。你可以在左侧选择任意本地视频作为背景；视频只在当前浏览器读取，不会上传。

## 已收录内容

- 5 个正式 Blender 母动作：推进、悬浮、凝聚登场、侧向闪避、直射施法。
- 11 个战斗状态适配：悬浮、推进、登场、直射/高抛蓄力与释放、扑击、闪避、受击、溃散。
- 玩家水球、怪物直射与高抛水球、命中/未命中、镜头泼水等特效。
- 正面、背面、侧面、俯视和推进视角审阅。
- 单只、两只、三只实例与确定性时间轴拖动。
- Blender 构建、校验脚本和浏览器自动化测试。

## 本地运行

要求：Node.js 22 或更新版本。

```bash
npm ci
npm run dev
```

打开终端给出的地址，或直接进入：

`http://127.0.0.1:5173/waterwing-blender-forward.html`

## 测试与构建

```bash
npm test
npm run build
```

生产文件输出到 `dist/`。Vite 使用相对资源路径，因此构建产物既能放在任意静态服务器，也能部署到 GitHub Pages 的仓库子路径。

浏览器测试默认寻找 Google Chrome。可通过环境变量指定其他 Chromium 路径：

```bash
CHROME_PATH=/path/to/chrome npm test
```

## 目录

```text
assets/blender/       浏览器使用的 GLB 与动作清单
blender/              Blender 构建与资产校验脚本
src/blender-forward/  模型载入、材质和统一审阅页面
src/projectiles/      玩家与怪物水球
src/water-events/     凝聚、命中、溃散和水面事件
src/combat-effects/   完整攻击结果编排
test/                 静态、资产与真实浏览器测试
```

## 授权

- 源代码采用 [MIT License](./LICENSE)。
- `assets/blender/` 下的“瀑翼水灵”模型与视觉资产采用单独的 [资产许可](./ASSET-LICENSE.md)，目前仅允许查看和运行本仓库演示，不自动授予再分发、商用或衍生模型权利。
- Three.js、Vite 等第三方依赖遵循各自许可证。

如果后续要把模型资产也开放为可复用授权，可单独调整 `ASSET-LICENSE.md`，不影响 MIT 代码许可。
