# Lookdev — 雪堡对决 3D 外观样张

独立的 Vite + TypeScript + Three.js + Rapier 页面，用来定 3D 外观，再搬进 `game/`。

```bash
npm install
npm run dev   # http://localhost:5181
```

按键：`C` 崩塌、`R` 重置、`V` 侧视、`P` 暂停（暂停后可用鼠标自由转镜头）、`H` 隐藏 UI。
鼠标拖动 = 环绕，滚轮 = 缩放，右键 = 平移。

## 截图（`shots/`，1920×1080）

| 文件 | 内容 |
|---|---|
| `side.jpg` | 游戏侧视镜头：左边暖色小孩 + 投石车，右边雪堡、雪人国王、冷色小孩 |
| `materials.jpg` | 3/4 近景：雪块（哑光、蓝色阴影）、冰块（半透、透出后面的篱笆）、木板 |
| `collapse-orbit.jpg` | 崩塌中，慢动作，镜头绕到约 45° |
| `collapse-reverse.jpg` | 半圈转完，从堡后往回看（院子另一侧的房子和树） |

## 外观做法

- **卡通 toon**：`src/toon.ts`。`MeshToonMaterial` + 三阶色带（从 `D:\dnf\client\src\three\ink.ts` 改来，
  色带用 fwidth 抗锯齿），不做 tone mapping，颜色保持鲜亮平涂。
- **粗描边**：反向外壳（inverted hull）。外壳几何体焊接顶点后重算法线，硬边不会裂口；
  外推在 instance 矩阵之前做，所以 InstancedMesh 也能用。
- **光**：一个太阳（一张硬阴影，PCF 2048）+ 天蓝色半球光，阴影偏蓝而不是发灰。
- **三种材质一眼可分**：
  - 雪：白、哑光、蓝色团块纹理，圆角大；
  - 冰：青色半透明 + 裂纹 + 硬高光点和磨砂边缘光（注入 shader）。描边用模板缓冲，只画在冰外面，
    所以透过冰看不到外壳的黑背面；
  - 木：暖棕、木纹 + 疤结 + 深色边，薄长板。
- **降雪**：一个 Points draw call，顶点着色器里动，只放在游戏平面后面（z ∈ [-38, -4]），不挡战场。

## 模型

**全部用基本体拼出来的，没有 GLB。** Tripo 两个 key 都返回 2010「积分不足」
（`D:\dnf\design\CHAPTER1.md` 记着 10 月积分 2026-10-24 用完）。
概念图用 Mistral FLUX 生成，prompt 同名 `.txt` 放在 `art/models/`：

- `kid_warm` / `kid_cool` / `snowman_king`：可用，等积分恢复后可直接送 Tripo 做 image-to-3D；
- `reject/catapult`：生成的投石车没有投掷臂，弃用；投石车改成程序化，臂可以转。

拼装方式（`src/kit.ts`）：每个模型把所有零件烘成一个顶点色网格 + 一个描边外壳，即 2 个 draw call。

| 模型 | 三角形（本体，外壳同数） |
|---|---|
| 小孩 ×2 | ≈ 5.3k |
| 雪人国王 | ≈ 4.0k |
| 投石车（底座 + 臂 + 球） | ≈ 3.4k |
| 背景道具（篱笆、松树、雪堆、房子、远山，合并） | ≈ 30.7k |
| 地面 | 17.6k |

## 预算（1920×1080，Intel Arc 核显，Chrome/ANGLE D3D11）

| 场景 | draw calls | 三角形（含阴影 pass） | CPU+GPU 每帧 |
|---|---|---|---|
| 侧视静止 | 42 | 191k | ≈ 0.3 ms |
| 崩塌前 3 秒（物理全 3D 解锁） | 44 | 194k | ≈ 1.2 ms |
| 崩塌后段（镜头转到背面） | 30 | 158k | ≈ 1.8 ms |

每帧时间是用 `gl.finish()` 逐帧同步测的（浏览器窗格在后台时 rAF 被节流，fps 读数没有意义）。
离 16.7 ms 很远，中档笔记本稳 60 fps 没问题。

draw call 构成：天空 1、地面 1、背景道具 2、降雪 1、积木 6（每种材质本体 + 外壳，InstancedMesh）、
每个角色/投石车部件 2、雪沫 1，剩下是阴影 pass。

## 物理

- 游戏状态：Rapier 3D，刚体锁 z 平移和 x/y 旋转（`fort.setLocked(true)`），建好后先跑 1 秒让它落稳。
- 崩塌：解锁全部轴，雪球按抛物线打到堡前，命中处加径向冲量（带一点 z 向散开）+ 雪沫粒子；
  时间缩到 0.3 倍约 5 秒，同时镜头 7 秒内绕堡半圈、拉近、略抬高，然后恢复正常速度。

## 搬进 `game/` 时

- `toon.ts`、`kit.ts`、`textures.ts` 可直接复用；`fort.ts` 的 InstancedMesh + 锁平面写法也可以。
- `window.lookdev`（`advance` / `snapshot`）和 `vite.config.ts` 里的 `/__shot` 只是截图用的开发工具，不用搬。
