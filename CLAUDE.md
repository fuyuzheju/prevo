# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Coding Standards

1. **No type assertions in source code** — Do not use `as`, `as any`, `as type`, or non-null assertion (`!`). Use proper type narrowing, Zod validation, or type guards instead. If you believe a type assertion is strictly necessary, explain why and get explicit confirmation before writing it. Tests are excluded and you can freely use type assertions in tests.
2. **English in codebase** — All code, comments, commit messages, and any file contents in this repository must be written in English. Chinese is reserved for conversational communication with the user only.
3. **Comments only when necessary** — Skip comments for obvious or self-documenting code. Only add comments in places where the logic is genuinely complex, uses a non-obvious algorithm, could be misinterpreted, contains a workaround/patch, or is error-prone. When a comment is needed, make it thorough and clear — explain the *why*, not the *what*.

## Project overview

周期化库存管理("prevo"):server 按 (userId, productType) 域维护每周期交易状态机(client/ 为空壳,尚未开发)。领域规则见 `docs/state.md`(状态机公式)与 `docs/struc.md`(server 组件职责)。三者:

- `shared/` — 纯领域类型/日期/位置推算,无运行时依赖,两端直接源码引用
- `server/` — Express + Prisma(SQLite),周期结算由定时任务驱动(客户端无结算入口)
- `client/` — Vite + React + Tailwind v4(blue 主色),与 server 分目录独立运行
- `samples/` — 多商品历史销量 Excel 导入样例

## 常用命令

两个目录各自独立(仓库根没有 workspace package.json),命令必须在其目录内执行:

- server: `npm run dev`(tsx watch)/ `npm start`(tsx)、`npm test`(vitest run)、`npx vitest run tests/<file>.test.ts`(单个文件)、`npm run typecheck`(tsc --noEmit)
- client: `npm run dev`(vite,代理 /api → localhost:3000)、`npm run build`(tsc + vite build)、`npm run typecheck`
- 数据库:server 内 `./node_modules/.bin/prisma migrate dev --name <名>`;schema 改动后**必须**再跑 `prisma generate`(migrate 不一定自动生成;测试库由 vitest globalSetup 的 `migrate deploy` 自动跟上)
- 日常联调:两端 dev server 都要起;验证 API 用 curl 拿 token 走 `/api/auth/login`

## 领域模型(核心,改前必读 docs/state.md)

- 所有数量是**整数**(最小单位 1);金额未建模——将来若加金额,约定存 100 倍整数。SQLite 下 Prisma 不支持 Decimal。
- `StateSnapshot {cycle, inventory, soldTransit, boughtTransit, sent, received, sale, purchase}`;每 (scope, cycle) 一行快照。周期递推:
  `inventory' = inventory + received − sent`;`soldTransit' = soldTransit + sale − sent`;`boughtTransit' = boughtTransit + purchase − received`
- `available = inventory + boughtTransit − soldTransit`(stateMachine.computeAvailable)
- 流水四类记录 `PURCHASE/SELL/SEND/RECEIVE` 是 ledger,**永不删除**;`ScopeRecord.cycle` 为 null = 本周期未结算,非空 = 已并入第 N 周期(防重复折叠)
- 结算(summarize/settlePending*)把未结算记录按 kind 汇总为周期四输入 sale/purchase/sent/received 并推进一周期,随后把记录标上 cycle;空周期不产生快照。**客户端没有结算入口**,由 `settlement.ts` 每日定时(环境变量 SETTLE_TIME,默认 00:05,服务器本地时区)按**记录本地日期**逐日结算;停机错过会按日期分组补算。
- 历史销量导入(`ImportedSale`)是 prediction-only 数据集:不进状态机/流水/实时库存;真实 SELL 记录自动并入预测。
- 预测:**已跨进程边界**——算法是 Python(WMA84:取 `as_of_date` 往前 84 个连续自然日的日销量线性加权,最近一天权重最大;历史不足走冷启动降级阶梯 `FULL_MEAN_FALLBACK`/`MA_28_FALLBACK`/`MA_56_FALLBACK`,全零走 `ALL_ZERO`),安全库存 = 两周预测总量 = 日均水平 ×14;采购建议 = max(0, 安全库存 − available)。
  - 算法在 `server/python/predict_core.py`(自包含,只依赖 numpy/pandas),**替换模型就是替换这个文件**;stdin/stdout 契约在 `server/python/main.py`;`server/src/modules/predictor.ts` 只做子进程传输,不含模型逻辑。
  - 解释器由 `PREDICTOR_PYTHON` 指定(该解释器必须能 import numpy/pandas——裸 `python` 可能是 pandas 已损坏的 conda base 环境);`main.py` 自带自检:`<python> server/python/predict_core.py`。
- "实时位置"(当前库存/可用量) = 最新已结算快照 + 未结算流水推算,算法在 `shared/model.ts` 的 `applyPendingToPosition/availableOf`,client(查询页)与 server(decision)共用同一实现,别各写一份。

## server 结构要点

- 模块分层(对应 docs/struc.md):modules/ 下 stateMachine(纯公式+持久化)、stateSummary(ledger+settle 原语)、products、userSystem(JWT+bcrypt)、settlement(定时)、predictor/decision/salesHistory(预测决策)、webApi(路由+守卫);`app.ts` 组装、`index.ts` 启动并注册定时器。
- `python/` 与 `src/` 同级:预测模型的 Python 实现,不参与 tsc/vitest 构建。`predict_core.py` 是 vendored 的算法,`main.py` 是 I/O 适配层。
- 路由:scope 路由形如 `/api/products/:productType/{state,states,records,purchase,sell,send,receive,summarize,predict,sales/import}`;集合路由 `/api/products`(列表/建/删)、`/api/sales/import`(多商品批量,独立 salesRouter);**除 register/login 外全要 Bearer token**;scope 操作先 `requireProduct`(商品不存在 → 404 PRODUCT_NOT_FOUND)。
- Prisma 7 注意:generator `provider="prisma-client"` 输出到 `server/generated/prisma`,源码用 `import ... from "../generated/prisma/client.js"`(.js 后缀是 nodenext 映射到 .ts);datasource url 在 `prisma.config.ts`(DATABASE_URL);相对 `file:` 路径以**项目根**为基准 → dev.db 在 server/dev.db,与运行时代码解析一致。
- SQLite 不强制 FK → `removeUser`/`removeProduct` 都是**显式逐表删除**(scopeRecord→cycleState→importedSale→product→user);schema 加了表记得补。
- 自有代码的相对导入一律写真实 `.ts` 扩展名(`allowImportingTsExtensions`,全仓 noEmit);到 shared 是 `../../../shared/model.ts` 或 `../../shared/date.ts`(视层级)。
- API 错误统一 `ApiError(status, code, message)` → `{error:{code,message}}`;Express 5 自动捕获 async 抛错。

## server 测试约定

- 测试用独立 `test.db`(非 dev.db):`tests/globalSetup.ts` 对其跑 `migrate deploy`,`tests/setupEnv.ts` 在 db 模块首次导入前设 DATABASE_URL;vitest `fileParallelism:false`(共享一个 sqlite 文件)。
- `tests/helpers.ts` 提供 `truncateAll/createUser/createProduct/createScope`;**schema 新增表后要在 truncateAll 和显式删除路径补上**,否则用例互相污染。
- 涉及日期的用例用 `addLocalDays(new Date(), -n)` 构造"过去 N 天",避免时区/边界脆弱。

## client 结构要点

- 页面路由在 `App.tsx`:登录 /login,受保护页共用 RequireAuth 布局(TopBar);查询 /、添加记录 /records、销量预测 /predict、商品管理 /products、资料 /profile、设置 /settings。
- 商品三页(查询/添加/预测)用 `ProductSidebar`(组件)+ `useProducts` hook;商品是服务端实体,不要在客户端存 localStorage 商品列表(历史遗留 storage.ts 只剩 token)。
- 重库按需:`PredictPage` 路由级 lazy(echarts),xlsx 在选文件时才动态 import;导入历史销量功能在**商品管理页**(多商品长表:商品|日期|数量),解析在 client(`lib/excelImport.ts`,raw:false 读显示文本避免时区),确认后走批量接口;不存在的商品会整批拒绝。
- 样式:tailwind v4(`index.css` 一个 `@import "tailwindcss"`),blue-600 主色,统一用 `components/ui.tsx` 的 Button/Card/Field/Input/ConfirmDialog 等。

## 演示数据

dev.db 里有 seed 账号 `demo` / `demo1234`(4 商品 × 30 条跨 12 天流水,部分已按日结算);`samples/` 两个 Excel 文件可用于商品管理页导入测试。需要重置 demo 数据时删除该用户重建(参考历史会话中的种子脚本结构)。
